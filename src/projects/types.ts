import type { SessionSummary } from "../agent/types.js"

/** A project as the root agent remembers it. */
export interface ProjectSummary {
  readonly name: string
  /** The Durable Object / sandbox that hosts this project. */
  readonly agent: string
  /** The git remote the project was created from, if any. */
  readonly remote?: string
}

/** A session summary that also says which agent (project or root) owns it. */
export interface ScopedSessionSummary extends SessionSummary {
  readonly agent: string
  readonly project?: string
}

export interface ProjectSessionsError {
  readonly project: string
  readonly message: string
}

export interface AllSessionsResult {
  readonly sessions: readonly ScopedSessionSummary[]
  readonly errors: readonly ProjectSessionsError[]
}