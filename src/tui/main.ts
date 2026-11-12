import { agentKey } from "../agent/naming.js"
import { parseGitRemote, parseProjectName } from "../projects/naming.js"
import type { ProjectSummary } from "../projects/types.js"
import { TuiClient } from "./api.js"
import { COMMANDS, matchCommands, parseCommand, topLevelSessions, type TuiCommand } from "./commands.js"
import { LastProjectStore, lastProjectPath } from "./last-project.js"
import { LastSessionStore, lastSessionPath } from "./last-session.js"
import { createTui, type ProjectChoice, type SessionChoice } from "./render.js"
import { initialState, reduce, type TuiAction, type TuiState } from "./view-model.js"

const rootAgent = process.env.TUI_AGENT ?? "tui"

const client = new TuiClient({
  baseUrl: process.env.TUI_URL ?? "http://127.0.0.1:8787",
  agent: rootAgent,
})

const stateOptions = {
  stateDir: process.env.TUI_STATE_DIR,
  xdgStateHome: process.env.XDG_STATE_HOME,
}

const modeStore = new LastProjectStore(lastProjectPath(agentKey(rootAgent), stateOptions))

function storeFor(agent: string): LastSessionStore {
  return new LastSessionStore(lastSessionPath(agentKey(agent), stateOptions))
}

let state: TuiState = initialState()
let currentProject: ProjectSummary | undefined
let store = storeFor(rootAgent)
let currentSession = store.read()
let knownProjects: ProjectSummary[] = []
let stopSocket: (() => void) | undefined
let socketGeneration = 0

const tui = await createTui({
  onSubmit: (text) => {
    const command = parseCommand(text)
    if (command.type !== "prompt") {
      executeCommand(command)
      return
    }
    dispatch({ type: "user", text })
    const agent = currentAgent()
    const session = currentSession
    void client
      .prompt(text, session, agent)
      .then((result) => {
        // The user may have switched projects or sessions while this run was in flight.
        if (agent !== currentAgent() || session !== currentSession) return
        if (result.status === "unanswered") {
          dispatch({ type: "error", message: result.reason ?? "run did not finish" })
        }
      })
      .catch((error: unknown) => {
        if (agent !== currentAgent() || session !== currentSession) return
        dispatch({ type: "error", message: messageOf(error) })
      })
  },
  onInput: (value) => {
    handleInput(value)
  },
  onAbort: () => {
    void client.abort(currentSession, currentAgent())
  },
  onPickSession: (session) => {
    openSession(session)
  },
  onPickProject: (project) => {
    void enterProject(project)
  },
  onPickCommand: (name) => {
    executeCommand(parseCommand(name))
  },
})

/** While the input starts with `/`, show the commands it can become. */
function handleInput(value: string): void {
  const matches = matchCommands(value)
  if (matches.length > 0) tui.showCommandHint(matches)
  else tui.hideHint()
}

function executeCommand(command: TuiCommand): void {
  switch (command.type) {
    case "new":
      void newSession()
      return
    case "sessions":
      void chooseSession()
      return
    case "projects":
      void chooseProject()
      return
    case "root":
      enterRoot()
      return
    case "new-project":
      void createProject(command.name, command.remote)
      return
    case "usage":
      dispatch({ type: "error", message: command.message })
      return
    case "unknown":
      chooseCommand(command.text)
      return
    case "prompt":
      return
  }
}

/** An unknown or partial slash command never reaches the model. */
function chooseCommand(text: string): void {
  const matches = matchCommands(text)
  if (matches.length === 0) {
    dispatch({ type: "error", message: `unknown command: ${text}` })
  }
  tui.showCommandMenu(matches.length === 0 ? COMMANDS : matches)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dispatch(action: TuiAction): void {
  state = reduce(state, action)
  tui.render(state)
}

function currentAgent(): string {
  return currentProject?.agent ?? rootAgent
}

function rememberSession(session: string): void {
  currentSession = session
  try {
    store.write(session)
  } catch {
    // Remembering the session is a convenience; a read-only state directory
    // must not take the TUI down.
  }
}

function saveMode(project: string | undefined): void {
  try {
    modeStore.write(project)
  } catch {
    // Same as the last-session pointer: a read-only state directory is not fatal.
  }
}

function showSession(session: string | undefined): void {
  currentSession = session
  if (session !== undefined) rememberSession(session)
  dispatch({
    type: "session",
    ...(session === undefined ? {} : { session }),
    ...(currentProject === undefined ? {} : { project: currentProject.name }),
  })
  connect(session)
}

function connect(session: string | undefined): void {
  const agent = currentAgent()
  const generation = ++socketGeneration
  const current = (): boolean => generation === socketGeneration && agent === currentAgent()
  stopSocket?.()
  stopSocket = client.connect(
    {
      onSnapshot: (snapshot) => {
        if (!current()) return
        dispatch({ type: "snapshot", snapshot })
        if (snapshot.session !== undefined && snapshot.session !== currentSession) {
          rememberSession(snapshot.session)
        }
      },
      onEvents: (events) => {
        if (current()) dispatch({ type: "events", events })
      },
      onStatus: (status) => {
        if (current()) dispatch({ type: "status", status })
      },
      onError: (message) => {
        if (current()) dispatch({ type: "error", message })
      },
    },
    session,
    agent,
  )
}

function enterRoot(session?: string): void {
  currentProject = undefined
  saveMode(undefined)
  store = storeFor(rootAgent)
  showSession(session ?? store.read())
}

async function enterProject(project: ProjectSummary, session?: string): Promise<void> {
  currentProject = project
  saveMode(project.name)
  store = storeFor(project.agent)
  showSession(session ?? store.read())
}

function openSession(session: SessionChoice): void {
  if (session.project === undefined) {
    enterRoot(session.id)
    return
  }
  if (session.agent === undefined) {
    dispatch({ type: "error", message: `project has no agent: ${session.project}` })
    return
  }
  const project =
    knownProjects.find((candidate) => candidate.agent === session.agent) ??
    ({ name: session.project, agent: session.agent } satisfies ProjectSummary)
  void enterProject(project, session.id)
}

async function newSession(): Promise<void> {
  const agent = currentAgent()
  try {
    const created = await client.createSession(agent)
    if (agent !== currentAgent()) return
    showSession(created.id)
  } catch (error) {
    if (agent !== currentAgent()) return
    dispatch({ type: "error", message: messageOf(error) })
  }
}

async function createProject(name: string, remote?: string): Promise<void> {
  try {
    const projectName = parseProjectName(name)
    const gitRemote = remote === undefined ? undefined : parseGitRemote(remote)
    const project = await client.createProject(projectName, gitRemote)
    knownProjects = [...knownProjects.filter((entry) => entry.agent !== project.agent), project].sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    await enterProject(project)
    await newSession()
  } catch (error) {
    dispatch({ type: "error", message: messageOf(error) })
  }
}

async function chooseSession(): Promise<void> {
  const agent = currentAgent()
  try {
    if (currentProject === undefined) {
      const result = await client.allSessions()
      if (agent !== currentAgent()) return
      if (result.errors.length > 0) {
        dispatch({
          type: "error",
          message: result.errors.map((entry) => `${entry.project}: ${entry.message}`).join("; "),
        })
      }
      const sessions: SessionChoice[] = topLevelSessions(result.sessions).map((session) => ({
        id: session.id,
        busy: session.busy,
        ...(session.title === undefined ? {} : { title: session.title }),
        ...(session.project === undefined ? {} : { project: session.project }),
        agent: session.agent,
      }))
      if (sessions.length === 0) {
        dispatch({ type: "error", message: "no sessions yet" })
        return
      }
      tui.showSessions(sessions, currentSession, rootAgent)
      return
    }

    const project = currentProject
    const result = await client.sessions(project.agent)
    if (agent !== currentAgent()) return
    const sessions: SessionChoice[] = topLevelSessions(result).map((session) => ({
      id: session.id,
      busy: session.busy,
      ...(session.title === undefined ? {} : { title: session.title }),
      project: project.name,
      agent: project.agent,
    }))
    if (sessions.length === 0) {
      dispatch({ type: "error", message: "no sessions yet" })
      return
    }
    tui.showSessions(sessions, currentSession, project.agent)
  } catch (error) {
    if (agent !== currentAgent()) return
    dispatch({ type: "error", message: messageOf(error) })
  }
}

async function chooseProject(): Promise<void> {
  try {
    const projects = await client.projects()
    knownProjects = projects
    if (projects.length === 0) {
      dispatch({ type: "error", message: "no projects yet; use /new_project <name>" })
      return
    }
    tui.showProjects(projects satisfies ProjectChoice[], currentProject?.name)
  } catch (error) {
    dispatch({ type: "error", message: messageOf(error) })
  }
}

async function bootstrap(): Promise<void> {
  let projectError: unknown
  try {
    knownProjects = await client.projects()
  } catch (error) {
    projectError = error
  }

  const lastProject = modeStore.read()
  const project =
    lastProject === undefined ? undefined : knownProjects.find((candidate) => candidate.name === lastProject)
  if (project !== undefined) {
    await enterProject(project)
  } else {
    if (lastProject !== undefined) saveMode(undefined)
    enterRoot()
  }
  if (projectError !== undefined) dispatch({ type: "error", message: messageOf(projectError) })
}

tui.render(state)
await bootstrap()