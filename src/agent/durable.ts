import { DurableObject } from "cloudflare:workers"
import { Lifecycle } from "agents/lifecycle"
import { OpenCodeHarness } from "agents/harness/opencode"
import { OpenCodeWorkerd } from "@opencode/sdk/workerd"
import { buildAgentConfig, CODING_AGENT_ID, OPENROUTER_PROVIDER_ID } from "./config.js"
import type { Env } from "./env.js"
import { socketEvents, socketSnapshot, toPromptResult, toSessionState, toSessionSummary } from "./session.js"
import type { PromptResult, SessionState, SessionSummary } from "./types.js"
import { sandboxTools } from "../plugins/tools.js"
import {
  commandFailure,
  gitCloneCommand,
  gitIdentityCommand,
  gitInitCommand,
  gitOriginCommand,
  PROJECT_CHECK_TIMEOUT_MS,
  PROJECT_INIT_TIMEOUT_MS,
  REPO_CHECK_COMMAND,
} from "../projects/init.js"
import { parseGitRemote, parseProjectName } from "../projects/naming.js"
import { addProject, parseRegistry, sortProjects } from "../projects/registry.js"
import type { AllSessionsResult, ProjectSessionsError, ProjectSummary, ScopedSessionSummary } from "../projects/types.js"
import { CloudflareSandbox, parseInstance } from "../sandbox/cloudflare.js"
import type { SandboxSnapshot, SandboxStatus } from "../sandbox/backend.js"
import { WORKSPACE } from "../sandbox/paths.js"
import { decodeBase64 } from "../sandbox/ssh.js"
import type { ReadFileResult, WriteFileResult } from "../sandbox/types.js"

const PROJECTS_KEY = "projects.registry"

// OpenCode uses process.cwd() as the default session location. Workerd reports
// the bundle root (/bundle), but the only directory the tools expose is
// /workspace. Rebind cwd before OpenCode creates sessions.
if (typeof process !== "undefined") {
  try {
    Object.defineProperty(process, "cwd", { value: () => WORKSPACE, configurable: true })
  } catch {
    // The system prompt still tells the model to stay in /workspace.
  }
}

export class CodeAgent extends DurableObject<Env> {
  readonly #harness: OpenCodeHarness
  readonly #lifecycle: Lifecycle
  readonly #sandbox: CloudflareSandbox
  #projectQueue: Promise<unknown> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    const sshPrivateKey =
      env.SSH_KEY_BASE64 === undefined || env.SSH_KEY_BASE64 === ""
        ? undefined
        : decodeBase64(env.SSH_KEY_BASE64, "SSH_KEY_BASE64")
    const sshKnownHosts =
      env.SSH_KNOWN_HOSTS_BASE64 === undefined || env.SSH_KNOWN_HOSTS_BASE64 === ""
        ? undefined
        : decodeBase64(env.SSH_KNOWN_HOSTS_BASE64, "SSH_KNOWN_HOSTS_BASE64")
    const sandbox = new CloudflareSandbox({
      container: ctx.container,
      storage: ctx.storage,
      instance: parseInstance(env.SANDBOX_INSTANCE),
      internet: env.SANDBOX_INTERNET !== "false",
      inactivityMs: Number(env.SANDBOX_INACTIVITY_MS ?? "600000"),
      ...(sshPrivateKey === undefined ? {} : { sshPrivateKey }),
      ...(sshKnownHosts === undefined ? {} : { sshKnownHosts }),
    })

    const config = buildAgentConfig({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
      ...(env.OPENROUTER_BASE_URL === undefined ? {} : { baseURL: env.OPENROUTER_BASE_URL }),
    })

    const harness = new OpenCodeHarness({
      opencode: ({ storage }) =>
        OpenCodeWorkerd.create({
          storage,
          config: config as unknown as OpenCodeWorkerd.Configuration,
          models: { fetch: false },
          plugins: [sandboxTools(sandbox)],
        }),
      defaults: {
        agent: CODING_AGENT_ID,
        model: { providerID: OPENROUTER_PROVIDER_ID, id: env.OPENROUTER_MODEL },
      },
    })

    this.#sandbox = sandbox
    this.#harness = harness
    this.#lifecycle = Lifecycle.install(this).use(harness)

    if (ctx.container?.running === true) {
      void ctx.blockConcurrencyWhile(() => sandbox.ensureInactivityTimeout())
    }
  }

  get lifecycle(): Lifecycle {
    return this.#lifecycle
  }

  async prompt(text: string, session?: string): Promise<PromptResult> {
    const result = toPromptResult(await this.#harness.prompt(text, session === undefined ? undefined : { session }))
    if (result.status === "done" && this.#sandbox.running) {
      // Best effort: keep a snapshot of the workspace for the next container.
      this.ctx.waitUntil(this.#sandbox.save().catch(() => undefined))
    }
    return result
  }

  async abort(session?: string): Promise<boolean> {
    return this.#harness.abort(session === undefined ? undefined : { session })
  }

  async sessions(): Promise<SessionSummary[]> {
    return (await this.#harness.sessions.list()).map(toSessionSummary)
  }

  async createSession(): Promise<SessionSummary> {
    const session = await this.#harness.sessions.create()
    return { id: session.id, busy: false }
  }

  /** Projects registered in this root agent. A project agent has an empty list. */
  async projects(): Promise<ProjectSummary[]> {
    return sortProjects(parseRegistry(await this.ctx.storage.get<unknown>(PROJECTS_KEY)))
  }

  /**
   * Creates a project under this agent. The project gets its own Durable Object
   * and sandbox; the registry lives here so `/projects` and root `/sessions`
   * have one place to ask.
   */
  async createProject(name: string, remote?: string): Promise<ProjectSummary> {
    const projectName = parseProjectName(name)
    const gitRemote = remote === undefined ? undefined : parseGitRemote(remote)
    return this.#exclusiveProject(async () => {
      const projects = parseRegistry(await this.ctx.storage.get<unknown>(PROJECTS_KEY))
      const project: ProjectSummary = {
        name: projectName,
        agent: `project-${crypto.randomUUID()}`,
        ...(gitRemote === undefined ? {} : { remote: gitRemote }),
      }
      // Reject duplicates before starting a container.
      addProject(projects, project)
      await this.env.AGENT.getByName(project.agent).initProject(gitRemote)
      await this.ctx.storage.put(PROJECTS_KEY, addProject(projects, project))
      return project
    })
  }

  /** Root sessions plus every registered project's sessions, labelled by owner. */
  async allSessions(): Promise<AllSessionsResult> {
    const rootAgent = this.ctx.id.name ?? "default"
    const own = await this.sessions()
    const projects = await this.projects()
    const errors: ProjectSessionsError[] = []
    const groups = await Promise.all(
      projects.map(async (project) => {
        try {
          const sessions = await this.env.AGENT.getByName(project.agent).sessions()
          return sessions.map(
            (session): ScopedSessionSummary => ({
              ...session,
              agent: project.agent,
              project: project.name,
            }),
          )
        } catch (cause) {
          errors.push({
            project: project.name,
            message: cause instanceof Error ? cause.message : String(cause),
          })
          return []
        }
      }),
    )
    return {
      sessions: [
        ...own.map((session): ScopedSessionSummary => ({ ...session, agent: rootAgent })),
        ...groups.flat(),
      ],
      errors,
    }
  }

  /**
   * Prepares `/workspace` for a new project. Clone when a remote is given,
   * otherwise initialize an empty repository. Repeated calls keep an existing
   * repository instead of cloning over it.
   */
  async initProject(remote?: string): Promise<void> {
    const gitRemote = remote === undefined ? undefined : parseGitRemote(remote)
    try {
      const check = await this.#sandbox.exec(REPO_CHECK_COMMAND, {
        cwd: WORKSPACE,
        timeoutMs: PROJECT_CHECK_TIMEOUT_MS,
      })
      const initialized = check.exitCode === 0
      if (!initialized) {
        const result = await this.#sandbox.exec(
          gitRemote === undefined ? gitInitCommand() : gitCloneCommand(gitRemote),
          { cwd: WORKSPACE, timeoutMs: PROJECT_INIT_TIMEOUT_MS },
        )
        if (result.exitCode !== 0) throw new Error(commandFailure(result))
      } else if (gitRemote !== undefined) {
        const result = await this.#sandbox.exec(gitOriginCommand(gitRemote), {
          cwd: WORKSPACE,
          timeoutMs: PROJECT_CHECK_TIMEOUT_MS,
        })
        if (result.exitCode !== 0) throw new Error(commandFailure(result))
      }
      const identity = await this.#sandbox.exec(gitIdentityCommand(), {
        cwd: WORKSPACE,
        timeoutMs: PROJECT_CHECK_TIMEOUT_MS,
      })
      if (identity.exitCode !== 0) throw new Error(commandFailure(identity))
      await this.#sandbox.save()
    } catch (error) {
      // A half-initialized project must not make a retry clone into a dirty tree.
      await this.#sandbox.reset().catch(() => undefined)
      throw error
    }
  }

  async state(session?: string): Promise<SessionState> {
    const handle = this.#harness.session(session)
    const [messages, busy, pending] = await Promise.all([
      handle.messages(),
      handle.busy(),
      this.#harness.pending(session === undefined ? undefined : { session }),
    ])
    return toSessionState(messages, busy, pending)
  }

  async sandboxStatus(): Promise<SandboxStatus> {
    return this.#sandbox.status()
  }

  async sandboxSave(): Promise<SandboxSnapshot> {
    return this.#sandbox.save()
  }

  async sandboxReset(): Promise<void> {
    await this.#sandbox.reset()
  }

  async sandboxRead(path: string, offset?: number, limit?: number): Promise<ReadFileResult> {
    return this.#sandbox.read(path, {
      ...(offset === undefined ? {} : { offset }),
      ...(limit === undefined ? {} : { limit }),
    })
  }

  async sandboxWrite(path: string, content: string): Promise<WriteFileResult> {
    return this.#sandbox.write(path, content)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/ws" || url.pathname === "/api/ws") {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 400 })
      }
      return this.#socket(url)
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true })
    }
    return new Response("not found", { status: 404 })
  }

  #exclusiveProject<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#projectQueue.then(operation, operation)
    this.#projectQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #socket(url: URL): Promise<Response> {
    // A stale session id (for example one saved by an older client) falls back
    // to the root session. The snapshot reports the real id, so the client can
    // save it again instead of reconnecting forever.
    const sessions = await this.#harness.sessions.list()
    const requested = url.searchParams.get("session") ?? undefined
    const session =
      requested !== undefined && sessions.some((entry) => entry.id === requested) ? requested : undefined
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    const stream = await this.#harness.session(session).events()
    const title = sessions.find((entry) => entry.id === stream.snapshot.session)?.title
    server.send(
      socketSnapshot(stream.snapshot, {
        provider: OPENROUTER_PROVIDER_ID,
        model: this.env.OPENROUTER_MODEL,
        ...(title === undefined ? {} : { title }),
      }),
    )
    stream.start((events) => {
      try {
        server.send(socketEvents(events))
      } catch {
        // The client went away between the close event and this send.
      }
    })
    const stop = (): void => {
      void stream.stop()
    }
    server.addEventListener("close", stop)
    server.addEventListener("error", stop)

    return new Response(null, { status: 101, webSocket: client })
  }
}
