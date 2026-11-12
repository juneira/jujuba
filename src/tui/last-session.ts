import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const SESSION_ID = /^ses[A-Za-z0-9_-]{1,80}$/

/**
 * The session the TUI reopens at startup. Stored next to the user's state so a
 * prompt from an older run can never be mistaken for a live session: readers
 * validate the id and ignore a missing or corrupt file.
 */
export class LastSessionStore {
  readonly #file: string

  constructor(file: string) {
    this.#file = file
  }

  read(): string | undefined {
    let raw: string
    try {
      raw = readFileSync(this.#file, "utf8")
    } catch {
      return undefined
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== "object") return undefined
      const session = (parsed as { session?: unknown }).session
      return typeof session === "string" && SESSION_ID.test(session) ? session : undefined
    } catch {
      return undefined
    }
  }

  write(session: string): void {
    mkdirSync(path.dirname(this.#file), { recursive: true })
    writeFileSync(this.#file, `${JSON.stringify({ session })}\n`)
  }
}

export interface StatePathOptions {
  /** `TUI_STATE_DIR`: overrides the whole jujuba state directory. */
  readonly stateDir?: string | undefined
  /** `XDG_STATE_HOME`; defaults to `~/.local/state`. */
  readonly xdgStateHome?: string | undefined
  readonly home?: string | undefined
}

/** The directory the TUI keeps its own state in. */
export function jujubaStateDir(options: StatePathOptions = {}): string {
  return (
    options.stateDir ??
    path.join(options.xdgStateHome ?? path.join(options.home ?? homedir(), ".local", "state"), "jujuba")
  )
}

/** Per-agent file so two agents keep independent "last session" pointers. */
export function lastSessionPath(agent: string, options: StatePathOptions = {}): string {
  return path.join(jujubaStateDir(options), `last-session-${agent}.json`)
}
