import { SandboxError } from "./types.js"

/** The only directory the agent may address. It maps to a real directory on the host. */
export const WORKSPACE = "/workspace"

function normalizePosix(input: string): string {
  const segments: string[] = []
  for (const raw of input.split("/")) {
    if (raw === "" || raw === ".") continue
    if (raw === "..") {
      const popped = segments.pop()
      if (popped === undefined) {
        throw new SandboxError("path escapes the workspace", 400, "path_escape")
      }
      continue
    }
    segments.push(raw)
  }
  return `/${segments.join("/")}`
}

/**
 * Turns whatever the model wrote into an absolute workspace path.
 * Absolute paths outside `/workspace` are rejected instead of remapped.
 */
export function normalizeWorkspacePath(input: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new SandboxError("path is required", 400, "invalid_path")
  }
  const raw = input.replaceAll("\\", "/").trim()
  if (raw.includes("\0")) {
    throw new SandboxError("path contains a null byte", 400, "invalid_path")
  }
  const absolute = raw.startsWith("/") ? raw : `${WORKSPACE}/${raw}`
  const normalized = normalizePosix(absolute)
  if (normalized !== WORKSPACE && !normalized.startsWith(`${WORKSPACE}/`)) {
    throw new SandboxError("path must be inside /workspace", 400, "path_escape")
  }
  return normalized
}

/** `/workspace/a/b.ts` becomes `a/b.ts`; `/workspace` becomes `""`. */
export function relativeWorkspacePath(input: string): string {
  const normalized = normalizeWorkspacePath(input)
  return normalized === WORKSPACE ? "" : normalized.slice(WORKSPACE.length + 1)
}

/** True when `target` is `root` or lives under it. Both must be normalized. */
export function isInside(root: string, target: string): boolean {
  const base = root.endsWith("/") ? root.slice(0, -1) : root
  return target === base || target.startsWith(`${base}/`)
}
