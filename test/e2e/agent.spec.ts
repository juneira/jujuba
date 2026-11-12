import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { E2E_BASE, E2E_LLM } from "./constants.js"

function containerAvailable(): boolean {
  try {
    const state = JSON.parse(readFileSync(path.resolve("test/.tmp/e2e-container.json"), "utf8")) as {
      available?: boolean
    }
    return state.available === true
  } catch {
    return false
  }
}

const containerIt = containerAvailable() ? it : it.skip

interface ScriptedToolCall {
  readonly name: string
  readonly args: Record<string, unknown>
}

interface ScriptedTurn {
  readonly text?: string
  readonly toolCalls?: readonly ScriptedToolCall[]
}

interface ApiResult {
  readonly status: number
  readonly body: unknown
}

async function resetLlm(): Promise<void> {
  await fetch(`${E2E_LLM}/__reset`, { method: "POST" })
}

async function enqueue(turns: ScriptedTurn[]): Promise<void> {
  const response = await fetch(`${E2E_LLM}/__enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turns }),
  })
  expect(response.ok).toBe(true)
}

async function post(pathname: string, body: unknown): Promise<ApiResult> {
  const response = await fetch(`${E2E_BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function get(pathname: string): Promise<ApiResult> {
  const response = await fetch(`${E2E_BASE}${pathname}`)
  return { status: response.status, body: await response.json() }
}

async function prompt(agent: string, text: string): Promise<ApiResult> {
  return post("/api/prompt", { agent, text })
}

async function resetSandbox(agent: string): Promise<void> {
  await post("/api/sandbox/reset", { agent })
}

async function readSandboxFile(agent: string, path: string): Promise<ApiResult> {
  return post("/api/sandbox/read", { agent, path })
}

describe("agent e2e over wrangler dev", () => {
  beforeEach(async () => {
    await resetLlm()
  })

  it("answers /health without touching the agent", async () => {
    const result = await get("/health")
    expect(result).toEqual({ status: 200, body: { ok: true } })
  })

  it("reports an empty state for a new agent", async () => {
    const result = await get("/api/state?agent=e2e-state")
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ busy: false, pending: [], messages: [] })
  })

  it("reports /workspace as the session and project directory", async () => {
    const agent = `e2e-workdir-${Date.now().toString(36)}`
    await enqueue([{ text: "ok" }])
    await prompt(agent, "hello")
    const last = (await (await fetch(`${E2E_LLM}/__last`)).json()) as { body?: string }
    const body = last.body ?? ""
    expect(body).toContain("Working directory: /workspace")
    expect(body).toContain("Workspace root folder: /workspace")
    expect(body).not.toContain("Working directory: /bundle")
  })

  it("answers a prompt with the mocked model", async () => {
    await enqueue([{ text: "Hello from the e2e suite." }])
    const result = await prompt("e2e-text", "Say hello")
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ status: "done", text: "Hello from the e2e suite." })
  })

  containerIt("writes a file inside the sandbox", async () => {
    await resetSandbox("e2e-write")
    await enqueue([
      { toolCalls: [{ name: "write", args: { path: "/workspace/hello.txt", content: "hello\n" } }] },
      { text: "Wrote the file." },
    ])
    const result = await prompt("e2e-write", "Write hello.txt")
    expect(result.body).toMatchObject({ status: "done", text: "Wrote the file." })
    const file = await readSandboxFile("e2e-write", "/workspace/hello.txt")
    expect(file.body).toMatchObject({ content: "hello" })
  })

  containerIt("runs a shell command in the sandbox", async () => {
    await resetSandbox("e2e-shell")
    await enqueue([
      {
        toolCalls: [
          { name: "shell", args: { command: "mkdir -p out && printf built > out/result.txt" } },
        ],
      },
      { text: "Built it." },
    ])
    const result = await prompt("e2e-shell", "Build it")
    expect(result.body).toMatchObject({ status: "done", text: "Built it." })
    const file = await readSandboxFile("e2e-shell", "/workspace/out/result.txt")
    expect(file.body).toMatchObject({ content: "built" })
  })

  containerIt("reports, saves and resets the sandbox", async () => {
    await resetSandbox("e2e-sandbox")
    await enqueue([
      { toolCalls: [{ name: "shell", args: { command: "true" } }] },
      { text: "Ready." },
    ])
    await prompt("e2e-sandbox", "hello")
    const status = await get("/api/sandbox/status?agent=e2e-sandbox")
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({ backend: "cloudflare", running: true })
    const saved = await post("/api/sandbox/save", { agent: "e2e-sandbox" })
    expect(saved.status).toBe(200)
    expect((saved.body as { id: string }).id).toBeTruthy()
    expect((await post("/api/sandbox/reset", { agent: "e2e-sandbox" })).status).toBe(200)
  })

  containerIt("creates a project, initializes git and lists its sessions from root", async () => {
    const root = "e2e-projects"
    const name = `demo-${Date.now().toString(36)}`
    const created = await post("/api/projects/new", { agent: root, name })
    expect(created.status).toBe(200)
    const project = (created.body as { project: { name: string; agent: string } }).project
    expect(project.name).toBe(name)
    expect(project.agent).toMatch(/^project-/)

    const listed = await post("/api/projects", { agent: root })
    expect(listed.status).toBe(200)
    expect((listed.body as { projects: { name: string }[] }).projects.map((entry) => entry.name)).toContain(name)

    const head = await readSandboxFile(project.agent, "/workspace/.git/HEAD")
    expect(head.status).toBe(200)
    expect(String((head.body as { content: string }).content)).toContain("ref: refs/heads/")

    const session = await post("/api/sessions/new", { agent: project.agent })
    expect(session.status).toBe(200)
    const sessionId = (session.body as { session: { id: string } }).session.id

    const all = await post("/api/sessions/all", { agent: root })
    expect(all.status).toBe(200)
    const sessions = (all.body as { sessions: { id: string; agent: string; project?: string }[] }).sessions
    expect(sessions).toContainEqual({ id: sessionId, busy: false, agent: project.agent, project: name })
  })

  containerIt("installs the forwarded SSH identity in the sandbox", async () => {
    await resetSandbox("e2e-ssh")
    await enqueue([
      {
        toolCalls: [
          {
            name: "shell",
            args: { command: "cat /root/.ssh/id_ed25519 && cat /root/.ssh/config" },
          },
        ],
      },
      { text: "Read it." },
    ])
    const result = await prompt("e2e-ssh", "Show the SSH identity")
    expect(result.body).toMatchObject({ status: "done", text: "Read it." })

    const state = await get("/api/state?agent=e2e-ssh")
    const transcript = JSON.stringify(state.body)
    expect(transcript).toContain("BEGIN OPENSSH PRIVATE KEY")
    expect(transcript).toContain("StrictHostKeyChecking accept-new")
  })

  containerIt("surfaces a tool error in the transcript and keeps going", async () => {
    await resetSandbox("e2e-error")
    await enqueue([
      { toolCalls: [{ name: "read", args: { path: "/workspace/missing.txt" } }] },
      { text: "That file does not exist." },
    ])
    const result = await prompt("e2e-error", "Read missing.txt")
    expect(result.body).toMatchObject({ status: "done", text: "That file does not exist." })

    const state = await get("/api/state?agent=e2e-error")
    const messages = (state.body as { messages: unknown[] }).messages as {
      type: string
      content?: { type: string; name?: string; state?: { status: string } }[]
    }[]
    const tool = messages
      .filter((message) => message.type === "assistant")
      .flatMap((message) => message.content ?? [])
      .find((part) => part.type === "tool" && part.name === "read")
    expect(tool?.state?.status).toBe("error")
  })

  containerIt("aborts a running operation", async () => {
    await resetSandbox("e2e-abort")
    await enqueue([
      { toolCalls: [{ name: "shell", args: { command: "sleep 30" } }] },
      { text: "should not get here" },
    ])
    const pending = prompt("e2e-abort", "Sleep")
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const aborted = await post("/api/abort", { agent: "e2e-abort" })
    expect(aborted.body).toEqual({ aborted: true })
    const result = await pending
    expect(result.body).toMatchObject({ status: "unanswered" })
  })

  it("lists sessions", async () => {
    await enqueue([{ text: "one" }])
    await prompt("e2e-sessions", "hello")
    const result = await post("/api/sessions", { agent: "e2e-sessions" })
    expect(result.status).toBe(200)
    expect((result.body as { sessions: unknown[] }).sessions.length).toBeGreaterThan(0)
  })

  it("creates a session and prompts in it", async () => {
    const created = await post("/api/sessions/new", { agent: "e2e-sessions-new" })
    expect(created.status).toBe(200)
    const session = (created.body as { session: { id: string; busy: boolean } }).session
    expect(session.id).toMatch(/^ses/)
    expect(session.busy).toBe(false)

    const listed = (await post("/api/sessions", { agent: "e2e-sessions-new" })).body as {
      sessions: { id: string }[]
    }
    expect(listed.sessions.map((entry) => entry.id)).toContain(session.id)

    await enqueue([{ text: "in the new session" }])
    const result = await post("/api/prompt", {
      agent: "e2e-sessions-new",
      text: "hello",
      session: session.id,
    })
    expect(result.body).toMatchObject({ status: "done", text: "in the new session" })

    const state = await get(`/api/state?agent=e2e-sessions-new&session=${session.id}`)
    expect((state.body as { messages: unknown[] }).messages.length).toBeGreaterThan(0)
  })

  it("falls back to the root session when the requested session is gone", async () => {
    const socket = new WebSocket(`${E2E_BASE.replace("http", "ws")}/api/ws?agent=e2e-stale&session=ses_missing`)
    const frames: { type?: string; snapshot?: { session?: string } }[] = []
    socket.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error("socket failed"))
    })
    await waitFor(() => frames.some((frame) => frame.type === "snapshot"))
    expect(frames.find((frame) => frame.type === "snapshot")?.snapshot?.session).toBe("ses_root")
    socket.close()
  })

  it("streams snapshot and events over a websocket", async () => {
    const socket = new WebSocket(`${E2E_BASE.replace("http", "ws")}/api/ws?agent=e2e-ws`)
    const received: unknown[] = []
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error("socket failed"))
    })
    socket.onmessage = (event) => received.push(JSON.parse(String(event.data)))

    await waitFor(() => received.some((message) => (message as { type?: string }).type === "snapshot"))
    await enqueue([{ text: "Streamed answer." }])
    await prompt("e2e-ws", "hello")
    await waitFor(() => {
      return received.some((message) => {
        const record = message as { type?: string; events?: { type?: string }[] }
        return record.type === "events" && (record.events ?? []).some((entry) => entry.type === "text_delta")
      })
    })
    socket.close()
  })

  it("rejects bad requests", async () => {
    expect((await post("/api/prompt", "{not json")).status).toBe(400)
    expect((await post("/api/prompt", { agent: "../escape", text: "hi" })).status).toBe(400)
    expect((await post("/api/prompt", { agent: "e2e-bad", text: "   " })).status).toBe(400)
    expect((await post("/api/prompt", { agent: "e2e-bad", text: "x".repeat(100_001) })).status).toBe(413)
    expect((await get("/nope")).status).toBe(404)
    expect((await get("/api/ws?agent=e2e-bad")).status).toBe(426)
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("timed out waiting for a websocket message")
}
