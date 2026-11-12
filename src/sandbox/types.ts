export interface ReadFileResult {
  readonly path: string
  readonly content: string
  readonly totalLines: number
  readonly truncated: boolean
}

export interface WriteFileResult {
  readonly path: string
  readonly bytes: number
}

export interface EditFileResult {
  readonly path: string
  readonly replacements: number
}

export interface PatchResult {
  readonly output: string
}

export interface GlobResult {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

export interface GrepMatch {
  readonly path: string
  readonly line: number
  readonly text: string
}

export interface GrepResult {
  readonly matches: readonly GrepMatch[]
  readonly truncated: boolean
}

export type EntryType = "file" | "dir" | "symlink"

export interface ListEntry {
  readonly name: string
  readonly type: EntryType
  readonly size: number
}

export interface ListResult {
  readonly path: string
  readonly entries: readonly ListEntry[]
}

export interface ExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
  readonly durationMs: number
}

export class SandboxError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 400, code = "sandbox_error") {
    super(message)
    this.name = "SandboxError"
    this.status = status
    this.code = code
  }
}
