import type { PromptResult, SessionState, SessionSummary } from "./types.js"

interface HarnessOperationResult {
  readonly status: "done" | "unanswered"
  readonly text?: string
  readonly reason?: string
}

interface HarnessSessionInfo {
  readonly id: string
  readonly title?: string
  readonly busy: boolean
  readonly parent?: string
}

export function toPromptResult(result: HarnessOperationResult): PromptResult {
  return {
    status: result.status,
    ...(result.text === undefined ? {} : { text: result.text }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  }
}

export function toSessionSummary(entry: HarnessSessionInfo): SessionSummary {
  return {
    id: entry.id,
    busy: entry.busy,
    ...(entry.title === undefined ? {} : { title: entry.title }),
    ...(entry.parent === undefined ? {} : { parent: entry.parent }),
  }
}

export function toSessionState(
  messages: readonly unknown[],
  busy: boolean,
  pending: readonly unknown[],
): SessionState {
  return { messages, busy, pending }
}

/** One JSON line per socket frame. Kept here so the wire shape is unit tested. */
export interface SnapshotRuntime {
  readonly provider: string
  readonly model: string
  readonly title?: string
}

export function socketSnapshot(snapshot: unknown, runtime?: SnapshotRuntime): string {
  const payload = runtime === undefined ? snapshot : { ...(snapshot as Record<string, unknown>), ...runtime }
  return JSON.stringify({ type: "snapshot", snapshot: payload })
}

export function socketEvents(events: readonly unknown[]): string {
  return JSON.stringify({ type: "events", events })
}
