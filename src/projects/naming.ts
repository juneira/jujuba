const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
const MAX_REMOTE_CHARS = 2_048
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** Rejects project names that would be confusing or unsafe in a URL or file name. */
export function parseProjectName(value: unknown): string {
  if (typeof value !== "string" || !PROJECT_NAME.test(value)) {
    throw new Error("project must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$")
  }
  if (value === "root") throw new Error("project name 'root' is reserved")
  return value
}

/**
 * Validates the optional git remote. Shell quoting happens later; this only
 * keeps values that git can receive as one argument from becoming options or
 * shell fragments.
 */
export function parseGitRemote(value: unknown): string {
  if (typeof value !== "string") throw new Error("remote must be a string")
  const remote = value.trim()
  if (remote === "") throw new Error("remote is required")
  if (remote.length > MAX_REMOTE_CHARS) throw new Error(`remote is limited to ${MAX_REMOTE_CHARS} characters`)
  if (remote.startsWith("-")) throw new Error("remote must not start with '-'")
  if (/\s/.test(remote) || CONTROL_CHARS.test(remote)) {
    throw new Error("remote must not contain whitespace or control characters")
  }
  return remote
}