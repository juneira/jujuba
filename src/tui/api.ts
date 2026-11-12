import type { PromptResult, SessionSummary } from "../agent/types.js"
import type { AllSessionsResult, ProjectSummary, ScopedSessionSummary } from "../projects/types.js"
import type { SessionEvent, SessionSnapshot, TuiStatus } from "./view-model.js"

export interface TuiHandlers {
  readonly onSnapshot: (snapshot: SessionSnapshot) => void
  readonly onEvents: (events: readonly SessionEvent[]) => void
  readonly onStatus: (status: TuiStatus) => void
  readonly onError: (message: string) => void
}

export interface TuiClientOptions {
  readonly baseUrl: string
  readonly agent: string
  readonly fetch?: typeof fetch
  readonly WebSocket?: typeof WebSocket
  readonly reconnectDelayMs?: number
  readonly maxReconnectDelayMs?: number
}

function parseFrame(raw: unknown): { snapshot?: SessionSnapshot; events?: readonly SessionEvent[] } | undefined {
  let parsed: unknown
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== "object") return undefined
  const frame = parsed as { type?: unknown; snapshot?: unknown; events?: unknown }
  if (frame.type === "snapshot" && frame.snapshot !== null && typeof frame.snapshot === "object") {
    return { snapshot: frame.snapshot as SessionSnapshot }
  }
  if (frame.type === "events" && Array.isArray(frame.events)) {
    return { events: frame.events as SessionEvent[] }
  }
  return undefined
}

export class TuiClient {
  readonly #baseUrl: string
  readonly #agent: string
  readonly #fetch: typeof fetch
  readonly #WebSocket: typeof WebSocket
  readonly #reconnectDelayMs: number
  readonly #maxReconnectDelayMs: number

  constructor(options: TuiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "")
    this.#agent = options.agent
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init))
    this.#WebSocket = options.WebSocket ?? WebSocket
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 500
    this.#maxReconnectDelayMs = options.maxReconnectDelayMs ?? 5_000
  }

  async prompt(text: string, session?: string, agent: string = this.#agent): Promise<PromptResult> {
    const response = await this.#fetch(`${this.#baseUrl}/api/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, text, ...(session === undefined ? {} : { session }) }),
    })
    const body = (await response.json().catch(() => ({}))) as { error?: string } & PromptResult
    if (!response.ok) throw new Error(body.error ?? "prompt failed")
    return body
  }

  async abort(session?: string, agent: string = this.#agent): Promise<boolean> {
    const response = await this.#fetch(`${this.#baseUrl}/api/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, ...(session === undefined ? {} : { session }) }),
    })
    const body = (await response.json().catch(() => ({}))) as { aborted?: boolean; error?: string }
    if (!response.ok) throw new Error(body.error ?? "abort failed")
    return body.aborted === true
  }

  async sessions(agent: string = this.#agent): Promise<SessionSummary[]> {
    const response = await this.#fetch(`${this.#baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent }),
    })
    const body = (await response.json().catch(() => ({}))) as { sessions?: SessionSummary[]; error?: string }
    if (!response.ok) throw new Error(body.error ?? "sessions failed")
    return body.sessions ?? []
  }

  async allSessions(): Promise<AllSessionsResult> {
    const response = await this.#fetch(`${this.#baseUrl}/api/sessions/all`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: this.#agent }),
    })
    const body = (await response.json().catch(() => ({}))) as {
      sessions?: ScopedSessionSummary[]
      errors?: AllSessionsResult["errors"]
      error?: string
    }
    if (!response.ok) throw new Error(body.error ?? "sessions failed")
    return { sessions: body.sessions ?? [], errors: body.errors ?? [] }
  }

  async createSession(agent: string = this.#agent): Promise<SessionSummary> {
    const response = await this.#fetch(`${this.#baseUrl}/api/sessions/new`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent }),
    })
    const body = (await response.json().catch(() => ({}))) as { session?: SessionSummary; error?: string }
    if (!response.ok) throw new Error(body.error ?? "create session failed")
    if (body.session === undefined) throw new Error("create session failed")
    return body.session
  }

  async projects(): Promise<ProjectSummary[]> {
    const response = await this.#fetch(`${this.#baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: this.#agent }),
    })
    const body = (await response.json().catch(() => ({}))) as { projects?: ProjectSummary[]; error?: string }
    if (!response.ok) throw new Error(body.error ?? "projects failed")
    return body.projects ?? []
  }

  async createProject(name: string, remote?: string): Promise<ProjectSummary> {
    const response = await this.#fetch(`${this.#baseUrl}/api/projects/new`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: this.#agent, name, ...(remote === undefined ? {} : { remote }) }),
    })
    const body = (await response.json().catch(() => ({}))) as { project?: ProjectSummary; error?: string }
    if (!response.ok) throw new Error(body.error ?? "create project failed")
    if (body.project === undefined) throw new Error("create project failed")
    return body.project
  }

  connect(handlers: TuiHandlers, session?: string, agent: string = this.#agent): () => void {
    let stopped = false
    let socket: WebSocket | undefined
    let delay = this.#reconnectDelayMs
    let reconnecting = false

    const schedule = (): void => {
      if (reconnecting) return
      reconnecting = true
      setTimeout(() => {
        reconnecting = false
        if (stopped) return
        delay = Math.min(this.#maxReconnectDelayMs, delay * 2)
        open()
      }, delay)
    }

    const query = `agent=${encodeURIComponent(agent)}${
      session === undefined ? "" : `&session=${encodeURIComponent(session)}`
    }`

    const open = (): void => {
      handlers.onStatus("connecting")
      const ws = new this.#WebSocket(`${this.#baseUrl.replace(/^http/, "ws")}/api/ws?${query}`)
      socket = ws
      ws.onopen = () => {
        delay = this.#reconnectDelayMs
        handlers.onStatus("idle")
      }
      ws.onmessage = (event: MessageEvent) => {
        const frame = parseFrame(event.data)
        if (frame?.snapshot !== undefined) handlers.onSnapshot(frame.snapshot)
        if (frame?.events !== undefined) handlers.onEvents(frame.events)
      }
      ws.onerror = () => {
        handlers.onError("connection lost")
      }
      ws.onclose = () => {
        if (stopped) return
        handlers.onStatus("connecting")
        schedule()
      }
    }

    open()

    return () => {
      stopped = true
      socket?.close()
    }
  }
}
