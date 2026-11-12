import type { AllSessionsResult, ProjectSummary } from "../projects/types.js"
import type { SandboxSnapshot, SandboxStatus } from "../sandbox/backend.js"
import type { ReadFileResult, ExecResult, WriteFileResult } from "../sandbox/types.js"

export interface PromptResult {
  readonly status: "done" | "unanswered"
  readonly text?: string
  readonly reason?: string
}

export interface SessionSummary {
  readonly id: string
  readonly title?: string
  readonly busy: boolean
  readonly parent?: string
}

export interface SessionState {
  readonly messages: readonly unknown[]
  readonly busy: boolean
  readonly pending: readonly unknown[]
}

export interface AgentStub {
  prompt(text: string, session?: string): Promise<PromptResult>
  abort(session?: string): Promise<boolean>
  sessions(): Promise<SessionSummary[]>
  allSessions(): Promise<AllSessionsResult>
  createSession(): Promise<SessionSummary>
  projects(): Promise<ProjectSummary[]>
  createProject(name: string, remote?: string): Promise<ProjectSummary>
  state(session?: string): Promise<SessionState>
  sandboxStatus(): Promise<SandboxStatus>
  sandboxSave(): Promise<SandboxSnapshot>
  sandboxReset(): Promise<void>
  sandboxRead(path: string, offset?: number, limit?: number): Promise<ReadFileResult>
  sandboxWrite(path: string, content: string): Promise<WriteFileResult>
  sandboxExec(command: string, cwd?: string, timeoutMs?: number): Promise<ExecResult>
  fetch(request: Request): Promise<Response>
}
