import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

const SHUTDOWN_GRACE_MS = 1_500

export interface SupervisorEvents {
  /** Prefix for failure messages, e.g. `dev` or `jujuba`. */
  readonly label: string
  readonly onMessage: (message: string) => void
  readonly onStop?: (() => void) | undefined
}

export interface StartOptions {
  readonly env?: Readonly<Record<string, string>> | undefined
  /** The TUI owns the terminal; services log to a file instead. */
  readonly inheritStdio?: boolean | undefined
  /** The primary child exits the whole supervisor with its status. */
  readonly primary?: boolean | undefined
}

interface Child {
  readonly name: string
  readonly proc: ChildProcess
  readonly logFile?: string
  readonly primary: boolean
  exited: boolean
  spawnError?: string
}

export function readTail(file: string, lines = 20): Promise<string> {
  return readFile(file, "utf8")
    .then((content) => content.trimEnd().split("\n").filter(Boolean).slice(-lines).join("\n"))
    .catch(() => "")
}

function describeExit(child: Child, code: number | null, signal: NodeJS.Signals | null): string {
  if (child.spawnError !== undefined) return `: ${child.spawnError}`
  if (signal !== null) return ` on ${signal}`
  return code === null ? "" : ` with code ${code}`
}

/**
 * Starts the worker (and the TUI) as children, owns their logs, and turns any
 * premature exit into a full shutdown. Used by `bun run dev` and `jujuba`.
 */
export class Supervisor {
  readonly #stateDir: string
  readonly #events: SupervisorEvents
  readonly #children: Child[] = []
  readonly #messages: string[] = []
  readonly #exited: Promise<number>
  #resolveExited!: (code: number) => void
  #stopping = false
  #failed = false
  #exitCode = 0

  constructor(stateDir: string, events: SupervisorEvents) {
    this.#stateDir = stateDir
    this.#events = events
    this.#exited = new Promise((resolve) => {
      this.#resolveExited = resolve
    })
  }

  get stopping(): boolean {
    return this.#stopping
  }

  get failed(): boolean {
    return this.#failed
  }

  start(name: string, command: string, args: readonly string[], options: StartOptions = {}): void {
    const inheritStdio = options.inheritStdio ?? false
    const logFile = inheritStdio ? undefined : path.join(this.#stateDir, `${name}.log`)
    const fd = logFile === undefined ? undefined : openSync(logFile, "w")

    const proc = spawn(command, [...args], {
      stdio: fd === undefined ? "inherit" : ["ignore", fd, fd],
      env: { ...process.env, ...options.env },
    })

    const child: Child = {
      name,
      proc,
      primary: options.primary ?? false,
      exited: false,
      ...(logFile === undefined ? {} : { logFile }),
    }
    this.#children.push(child)

    proc.on("error", (error) => {
      child.spawnError = error.message
    })

    proc.on("close", (code, signal) => {
      if (fd !== undefined) closeSync(fd)
      if (child.exited) return
      child.exited = true
      if (this.#stopping) return
      void this.#handleExit(child, code, signal)
    })
  }

  /** Record a message and stop everything; used when a startup check fails. */
  fail(message: string, code = 1): void {
    this.#messages.push(message)
    this.shutdown(code)
  }

  shutdown(code = 0): void {
    if (this.#stopping) return
    this.#stopping = true
    this.#exitCode = code
    this.#events.onStop?.()

    for (const child of this.#children) {
      if (!child.exited) child.proc.kill("SIGTERM")
    }

    // Wait for the children to release the terminal (the TUI restores the
    // screen on SIGTERM) before printing anything or exiting.
    const deadline = Date.now() + SHUTDOWN_GRACE_MS
    const waitForExit = (): void => {
      const allExited = this.#children.every((child) => child.exited)
      if (!allExited && Date.now() < deadline) {
        setTimeout(waitForExit, 50)
        return
      }
      for (const child of this.#children) {
        if (!child.exited) child.proc.kill("SIGKILL")
      }
      for (const message of this.#messages) this.#events.onMessage(message)
      this.#resolveExited(this.#exitCode)
    }
    waitForExit()
  }

  /** Resolves once shutdown has finished; the caller owns `process.exit`. */
  wait(): Promise<number> {
    return this.#exited
  }

  async #handleExit(child: Child, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (child.primary) {
      this.shutdown(code ?? 0)
      return
    }

    // Set before awaiting the log tail so a startup health check does not also
    // report a timeout for a process that already exited.
    this.#failed = true
    const tail = child.logFile === undefined ? "" : await readTail(child.logFile)
    this.#messages.push(
      `[${this.#events.label}] ${child.name} exited${describeExit(child, code, signal)}${tail === "" ? "" : `\n${tail}`}`,
    )
    this.shutdown(code === null ? 1 : code)
  }
}
