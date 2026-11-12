import { parseAgentName } from "../agent/naming.js"

export const DEFAULT_PORT = 8790
export const DEFAULT_AGENT = "tui"

export type CliCommand = "run" | "start" | "build" | "init" | "doctor" | "help" | "version"

const COMMANDS: readonly CliCommand[] = ["run", "start", "build", "init", "doctor", "help", "version"]

export interface CliOptions {
  readonly command: CliCommand
  readonly port: number
  readonly agent: string
  readonly configFile: string | undefined
  readonly stateDir: string | undefined
  readonly force: boolean
}

export interface CliDefaults {
  readonly port?: number | undefined
  readonly agent?: string | undefined
}

/** A user-facing argument error; `main` prints the message and exits non-zero. */
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CliError"
  }
}

export const USAGE = `jujuba — run the coding agent locally

Usage:
  jujuba [run] [options]    build if needed, start the worker, open the TUI
  jujuba start [options]    start without the build step
  jujuba build              build the worker bundle and the sandbox image
  jujuba init [--force]     create ~/.config/jujuba/env (mode 600)
  jujuba doctor             check Docker, wrangler, config and the port
  jujuba --help | --version

Options:
  --port <n>        worker port (default ${DEFAULT_PORT}; env JUJUBA_PORT)
  --agent <name>    agent name (default ${DEFAULT_AGENT}; env JUJUBA_AGENT)
  --config <path>   config file (default ~/.config/jujuba/env)
  --state <dir>     state directory (default ~/.local/state/jujuba)
  --no-build        skip the build step (same as "jujuba start")
  --force           overwrite the config file (init only)
`

function splitFlag(arg: string): readonly [string, string | undefined] {
  if (!arg.startsWith("--")) return [arg, undefined]
  const separator = arg.indexOf("=")
  if (separator === -1) return [arg, undefined]
  return [arg.slice(0, separator), arg.slice(separator + 1)]
}

function parsePort(raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new CliError(`invalid port: ${raw}`)
  return value
}

export function parseArgs(argv: readonly string[], defaults: CliDefaults = {}): CliOptions {
  let command: CliCommand = "run"
  let port = defaults.port ?? DEFAULT_PORT
  let agent = defaults.agent ?? DEFAULT_AGENT
  let configFile: string | undefined
  let stateDir: string | undefined
  let force = false
  let noBuild = false
  let commandSeen = false

  const finish = (next: CliCommand): CliOptions => ({
    command: next,
    port,
    agent,
    configFile,
    stateDir,
    force,
  })

  const takeValue = (index: number, flag: string, inline: string | undefined): [string, number] => {
    if (inline !== undefined) {
      if (inline === "") throw new CliError(`${flag} needs a value`)
      return [inline, index]
    }
    const value = argv[index + 1]
    if (value === undefined) throw new CliError(`${flag} needs a value`)
    return [value, index + 1]
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === "-h" || arg === "--help") return finish("help")
    if (arg === "-v" || arg === "--version") return finish("version")

    const [flag, inline] = splitFlag(arg)
    if (flag === "--port" || flag === "--agent" || flag === "--config" || flag === "--state") {
      const [value, consumed] = takeValue(index, flag, inline)
      index = consumed
      if (flag === "--port") port = parsePort(value)
      if (flag === "--agent") agent = value
      if (flag === "--config") configFile = value
      if (flag === "--state") stateDir = value
      continue
    }
    if (flag === "--force") {
      force = true
      continue
    }
    if (flag === "--no-build") {
      noBuild = true
      continue
    }
    if (flag.startsWith("-")) throw new CliError(`unknown option: ${arg}`)
    if (commandSeen) throw new CliError(`unexpected argument: ${arg}`)
    if (!COMMANDS.includes(arg as CliCommand)) throw new CliError(`unknown command: ${arg}`)
    command = arg as CliCommand
    commandSeen = true
  }

  if (command === "run" && noBuild) command = "start"
  return finish(command)
}

/** Validate the agent once, before any worker process starts. */
export function validateAgent(agent: string): string {
  return parseAgentName(agent)
}
