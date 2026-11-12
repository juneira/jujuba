import type { SessionSummary } from "../agent/types.js"

export interface TuiCommandInfo {
  readonly name: string
  readonly description: string
}

/** Everything the prompt accepts as a slash command. */
export const COMMANDS: readonly TuiCommandInfo[] = [
  { name: "/new", description: "Create a session and switch to it" },
  { name: "/sessions", description: "List sessions and pick one" },
  { name: "/new_project", description: "Create a project and switch to it" },
  { name: "/projects", description: "List projects and pick one" },
  { name: "/root", description: "Return to root mode" },
]

const NEW_PROJECT_USAGE = "usage: /new_project <name> [git remote origin]"

/** A leading `$` runs a shell command in the current agent's `/workspace`. */
export const SHELL_PREFIX = "$"
export const SHELL_USAGE = "usage: $ <command>"

export type TuiCommand =
  | { readonly type: "new" }
  | { readonly type: "sessions" }
  | { readonly type: "projects" }
  | { readonly type: "root" }
  | { readonly type: "new-project"; readonly name: string; readonly remote?: string }
  | { readonly type: "shell"; readonly command: string }
  | { readonly type: "usage"; readonly message: string; readonly text: string }
  | { readonly type: "unknown"; readonly text: string }
  | { readonly type: "prompt"; readonly text: string }

/**
 * A leading `/` always means a command, never a message. A leading `$` always
 * means a shell command in the agent's workspace. Anything the registry does not
 * know comes back as `unknown` so the caller can offer the command list instead
 * of sending it to the model.
 */
export function parseCommand(text: string): TuiCommand {
  const trimmed = text.trimStart()
  if (trimmed.startsWith(SHELL_PREFIX)) {
    const command = trimmed.slice(SHELL_PREFIX.length).trim()
    if (command === "") return { type: "usage", message: SHELL_USAGE, text }
    return { type: "shell", command }
  }
  if (text === "/new") return { type: "new" }
  if (text === "/sessions") return { type: "sessions" }
  if (text === "/projects") return { type: "projects" }
  if (text === "/root") return { type: "root" }
  if (text === "/new_project") return { type: "usage", message: NEW_PROJECT_USAGE, text }
  if (text.startsWith("/new_project ")) {
    const args = text
      .slice("/new_project ".length)
      .trim()
      .split(/\s+/)
      .filter((arg) => arg !== "")
    if (args.length === 0 || args.length > 2) {
      return { type: "usage", message: NEW_PROJECT_USAGE, text }
    }
    const name = args[0] as string
    const remote = args[1]
    return { type: "new-project", name, ...(remote === undefined ? {} : { remote }) }
  }
  if (text.startsWith("/")) return { type: "unknown", text }
  return { type: "prompt", text }
}

/** Commands whose name starts with what the user has typed so far. */
export function matchCommands(text: string): TuiCommandInfo[] {
  const prefix = text.trim().toLowerCase()
  if (!prefix.startsWith("/")) return []
  return COMMANDS.filter((command) => command.name.startsWith(prefix))
}

/** The picker shows top-level sessions only, not subagent sessions. */
export function topLevelSessions<T extends SessionSummary>(sessions: readonly T[]): T[] {
  return sessions.filter((session) => session.parent === undefined)
}
