import { shellQuote } from "../sandbox/output.js"
import type { ExecResult } from "../sandbox/types.js"

export const PROJECT_INIT_TIMEOUT_MS = 300_000
export const PROJECT_CHECK_TIMEOUT_MS = 30_000

const GIT_ENV = `GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND=${shellQuote(
  "ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new",
)}`

/** Exit code 0 means /workspace is already a git work tree. */
export const REPO_CHECK_COMMAND = "test -d .git && git rev-parse --is-inside-work-tree >/dev/null 2>&1"

export function gitInitCommand(): string {
  return "git init -b main"
}

export function gitCloneCommand(remote: string): string {
  return `${GIT_ENV} git clone -- ${shellQuote(remote)} .`
}

/** Idempotently points origin at the requested remote. */
export function gitOriginCommand(remote: string): string {
  return `git remote get-url origin >/dev/null 2>&1 && git remote set-url origin ${shellQuote(remote)} || git remote add origin ${shellQuote(remote)}`
}

/** Sets a local identity only when git does not already have one. */
export function gitIdentityCommand(): string {
  return "git config --get user.name >/dev/null 2>&1 || git config user.name jujuba; git config --get user.email >/dev/null 2>&1 || git config user.email jujuba@localhost"
}

/** The best error text from a failed git command. */
export function commandFailure(result: ExecResult): string {
  const detail = [result.stderr, result.stdout]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n")
  return detail === "" ? `command failed with exit code ${result.exitCode}` : detail
}