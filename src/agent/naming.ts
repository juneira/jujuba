const AGENT_NAME = /^[A-Za-z0-9._-]{1,64}$/

/** Stable, filesystem-safe workspace name for a Durable Object. */
export function agentKey(raw: string | undefined): string {
  const base = (raw ?? "default").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64)
  return base === "" ? "default" : base
}

/** Rejects agent names that could escape a directory or a URL segment. */
export function parseAgentName(value: unknown): string {
  if (typeof value !== "string" || !AGENT_NAME.test(value)) {
    throw new Error("agent must match ^[A-Za-z0-9._-]{1,64}$")
  }
  return value
}

export function parseSessionId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string" || !/^ses[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error("session must be an OpenCode session id")
  }
  return value
}
