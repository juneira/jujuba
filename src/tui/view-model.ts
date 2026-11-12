import { toolChanges, toolSummary, type ToolStatus, type ToolView } from "./tool-view.js"

export type TuiStatus = "connecting" | "idle" | "busy" | "error"

export type EntryKind = "user" | "assistant" | "tool" | "error" | "info"

export interface TuiEntry {
  readonly id: string
  readonly kind: EntryKind
  readonly text: string
  readonly tool?: ToolView
}

export interface TuiState {
  readonly status: TuiStatus
  readonly entries: readonly TuiEntry[]
  readonly session?: string
  readonly project?: string
  readonly title?: string
  readonly provider?: string
  readonly model?: string
  readonly error?: string
}

export interface SessionEvent {
  readonly type: string
  readonly [key: string]: unknown
}

export interface SessionSnapshot {
  readonly session?: string
  readonly title?: string
  readonly provider?: string
  readonly model?: string
  readonly messages?: readonly unknown[]
  readonly busy?: boolean
}

export type TuiAction =
  | { readonly type: "status"; readonly status: TuiStatus }
  | { readonly type: "user"; readonly text: string }
  | { readonly type: "snapshot"; readonly snapshot: SessionSnapshot }
  | { readonly type: "events"; readonly events: readonly SessionEvent[] }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "session"; readonly session?: string; readonly project?: string }
  | { readonly type: "clear" }

export function initialState(): TuiState {
  return { status: "connecting", entries: [] }
}

function upsert(entries: readonly TuiEntry[], entry: TuiEntry): TuiEntry[] {
  const index = entries.findIndex((candidate) => candidate.id === entry.id)
  if (index === -1) return [...entries, entry]
  const next = [...entries]
  next[index] = { ...next[index], ...entry }
  return next
}

function appendText(entries: readonly TuiEntry[], id: string, delta: string): TuiEntry[] {
  const index = entries.findIndex((candidate) => candidate.id === id)
  if (index === -1) {
    return [...entries, { id, kind: "assistant", text: delta }]
  }
  const next = [...entries]
  const current = next[index]!
  next[index] = { ...current, text: current.text + delta }
  return next
}

function textId(messageId: unknown, ordinal: unknown): string {
  return `text:${String(messageId)}:${String(ordinal)}`
}

interface AssistantPart {
  readonly type?: string
  readonly text?: string
  readonly id?: string
  readonly name?: string
  readonly state?: {
    readonly status?: string
    readonly input?: unknown
    readonly content?: readonly { readonly type?: string; readonly text?: string }[]
    readonly error?: { readonly message?: string }
  }
}

interface TranscriptMessage {
  readonly id?: string
  readonly type?: string
  readonly text?: string
  readonly content?: readonly AssistantPart[]
}

function summarize(parts: readonly { readonly type?: string; readonly text?: string }[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
}

function toolStatus(status: string | undefined): ToolStatus {
  if (status === "error") return "error"
  return status === "completed" ? "done" : "running"
}

function toolEntry(id: string, name: string, input: unknown, output: string, status: ToolStatus): TuiEntry {
  return {
    id: `tool:${id}`,
    kind: status === "error" ? "error" : "tool",
    text: `${name}${output === "" ? "" : `\n${output}`}`,
    tool: {
      name,
      summary: toolSummary(name, input),
      status,
      changes: toolChanges(name, input),
      ...(output === "" ? {} : { output }),
    },
  }
}

function fromTranscript(messages: readonly unknown[]): TuiEntry[] {
  const entries: TuiEntry[] = []
  for (const raw of messages) {
    const message = raw as TranscriptMessage
    const id = String(message.id ?? `message-${entries.length}`)
    if (message.type === "user") {
      entries.push({ id: `user:${id}`, kind: "user", text: message.text ?? "" })
      continue
    }
    if (message.type !== "assistant") continue

    let textOrdinal = 0
    for (const part of message.content ?? []) {
      if (part.type === "text") {
        entries.push({ id: textId(id, textOrdinal), kind: "assistant", text: part.text ?? "" })
        textOrdinal += 1
      }
      if (part.type === "tool") {
        const state = part.state
        const name = part.name ?? "tool"
        const output = summarize(state?.content) || state?.error?.message || state?.status || ""
        entries.push(
          toolEntry(String(part.id ?? id), name, state?.input, output, toolStatus(state?.status)),
        )
      }
    }
  }
  return entries
}

function applyEvent(state: TuiState, event: SessionEvent): TuiState {
  switch (event.type) {
    case "run_start": {
      const { error: _error, ...rest } = state
      return { ...rest, status: "busy" }
    }
    case "run_end": {
      const outcome = event.outcome
      const failed = outcome === "failed" || outcome === "interrupted"
      return {
        ...state,
        status: failed ? "error" : "idle",
        ...(failed ? { error: typeof event.error === "string" ? event.error : String(outcome) } : {}),
      }
    }
    case "text_delta": {
      const delta = typeof event.delta === "string" ? event.delta : ""
      return {
        ...state,
        status: "busy",
        entries: appendText(state.entries, textId(event.messageId, event.ordinal), delta),
      }
    }
    case "text_end": {
      const text = typeof event.text === "string" ? event.text : ""
      return {
        ...state,
        entries: upsert(state.entries, {
          id: textId(event.messageId, event.ordinal),
          kind: "assistant",
          text,
        }),
      }
    }
    case "tool_start": {
      const name = String(event.name ?? "tool")
      return {
        ...state,
        status: "busy",
        entries: upsert(state.entries, {
          id: `tool:${String(event.toolCallId)}`,
          kind: "tool",
          text: name,
          tool: {
            name,
            summary: toolSummary(name, event.input),
            status: "running",
            changes: toolChanges(name, event.input),
          },
        }),
      }
    }
    case "tool_end": {
      const output = typeof event.output === "string" ? event.output : ""
      const failed = event.error === true
      const id = `tool:${String(event.toolCallId)}`
      const previous = state.entries.find((entry) => entry.id === id)?.tool
      const name = String(event.name ?? previous?.name ?? "tool")
      return {
        ...state,
        entries: upsert(state.entries, {
          id,
          kind: failed ? "error" : "tool",
          text: `${name}${output === "" ? "" : `\n${output}`}`,
          tool: {
            ...(previous ?? { summary: "", changes: [] }),
            name,
            status: failed ? "error" : "done",
            ...(output === "" ? {} : { output }),
          },
        }),
      }
    }
    case "operation_end": {
      const result = event.result as { status?: string; reason?: string } | undefined
      if (result?.status !== "unanswered") return state
      return {
        ...state,
        status: "idle",
        error: result.reason ?? "operation did not finish",
        entries: [
          ...state.entries,
          { id: `error:${state.entries.length}`, kind: "error", text: result.reason ?? "operation did not finish" },
        ],
      }
    }
    case "fault": {
      const message = typeof event.message === "string" ? event.message : "agent fault"
      return {
        ...state,
        status: "error",
        error: message,
        entries: [...state.entries, { id: `fault:${state.entries.length}`, kind: "error", text: message }],
      }
    }
    case "permission_asked": {
      const permission = event.permission as { action?: string; resources?: unknown } | undefined
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            id: `permission:${state.entries.length}`,
            kind: "info",
            text: `permission: ${permission?.action ?? "action"} ${JSON.stringify(permission?.resources ?? [])}`,
          },
        ],
      }
    }
    case "transcript_reset":
      return { ...state, entries: [] }
    default:
      return state
  }
}

export function reduce(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status }
    case "user":
      return {
        ...state,
        status: "busy",
        entries: [...state.entries, { id: `user:${state.entries.length}`, kind: "user", text: action.text }],
      }
    case "snapshot":
      return {
        ...state,
        status: action.snapshot.busy === true ? "busy" : "idle",
        entries: fromTranscript(action.snapshot.messages ?? []),
        ...(action.snapshot.session === undefined ? {} : { session: action.snapshot.session }),
        ...(action.snapshot.title === undefined ? {} : { title: action.snapshot.title }),
        ...(action.snapshot.provider === undefined ? {} : { provider: action.snapshot.provider }),
        ...(action.snapshot.model === undefined ? {} : { model: action.snapshot.model }),
      }
    case "events":
      return action.events.reduce(applyEvent, state)
    case "error":
      return {
        ...state,
        status: "error",
        error: action.message,
        entries: [...state.entries, { id: `error:${state.entries.length}`, kind: "error", text: action.message }],
      }
    case "session": {
      // The next snapshot repopulates the transcript for the chosen session.
      const { error: _error, session: _session, project: _project, title: _title, ...rest } = state
      return {
        ...rest,
        status: "connecting",
        entries: [],
        ...(action.session === undefined ? {} : { session: action.session }),
        ...(action.project === undefined ? {} : { project: action.project }),
      }
    }
    case "clear":
      return { ...state, entries: [] }
  }
}

/** Identity line: project, session name, provider and model. */
export function headerLine(state: TuiState): string {
  const parts = ["jujuba", state.project ?? "root"]
  if (state.session !== undefined) parts.push(state.title ?? state.session)
  if (state.provider !== undefined) parts.push(state.provider)
  if (state.model !== undefined) parts.push(state.model)
  return parts.join(" · ")
}

export function statusLine(state: TuiState): string {
  const status = state.status === "busy" ? "working" : state.status
  const error = state.error === undefined ? "" : `  ${state.error}`
  return `${status}${error}`
}
