import type {
  EditFileResult,
  ExecResult,
  GlobResult,
  GrepResult,
  ListResult,
  PatchResult,
  ReadFileResult,
  WriteFileResult,
} from "./types.js"

export interface ReadOptions {
  readonly offset?: number
  readonly limit?: number
}

export interface ExecOptions {
  readonly cwd?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export interface GrepOptions {
  readonly path?: string
  readonly glob?: string
  readonly ignoreCase?: boolean
  readonly limit?: number
}

export interface SandboxStatus {
  readonly backend: "cloudflare"
  readonly running: boolean
  readonly image: string | null
  readonly snapshotId: string | null
}

export interface SandboxSnapshot {
  readonly id: string
  readonly size: number
}

/**
 * The sandbox surface the agent tools use. The implementation lives in a
 * Cloudflare Container; `read`, `write`, `edit`, `patch`, `glob`, `grep`,
 * `list`, and `exec` are the only capabilities the model gets.
 */
export interface Sandbox {
  read(path: string, options?: ReadOptions, signal?: AbortSignal): Promise<ReadFileResult>
  write(path: string, content: string, signal?: AbortSignal): Promise<WriteFileResult>
  edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
    signal?: AbortSignal,
  ): Promise<EditFileResult>
  patch(patch: string, signal?: AbortSignal): Promise<PatchResult>
  glob(pattern: string, cwd?: string, signal?: AbortSignal): Promise<GlobResult>
  grep(pattern: string, options?: GrepOptions, signal?: AbortSignal): Promise<GrepResult>
  list(path: string, signal?: AbortSignal): Promise<ListResult>
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  status(): Promise<SandboxStatus>
  save(): Promise<SandboxSnapshot>
  reset(): Promise<void>
}
