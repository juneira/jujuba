import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseProjectName } from "../projects/naming.js"
import { jujubaStateDir, type StatePathOptions } from "./last-session.js"

/**
 * The last mode the TUI was in: a project name, or root. Missing, corrupt and
 * unknown names all read as root so the client never reconnects to a project
 * that no longer exists.
 */
export class LastProjectStore {
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
      const project = (parsed as { project?: unknown }).project
      if (typeof project !== "string") return undefined
      try {
        return parseProjectName(project)
      } catch {
        return undefined
      }
    } catch {
      return undefined
    }
  }

  write(project: string | undefined): void {
    mkdirSync(path.dirname(this.#file), { recursive: true })
    writeFileSync(this.#file, `${JSON.stringify({ project: project ?? null })}\n`)
  }
}

/** One mode file per root agent, next to the per-agent last-session files. */
export function lastProjectPath(agent: string, options: StatePathOptions = {}): string {
  return path.join(jujubaStateDir(options), `last-project-${agent}.json`)
}