import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/**
 * Keys forwarded from `~/.config/jujuba/env` (and the process environment)
 * into the runtime env file that `wrangler dev --env-file` reads.
 */
export const CONFIG_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_BASE_URL",
  "SANDBOX_INSTANCE",
  "SANDBOX_INTERNET",
  "SANDBOX_INACTIVITY_MS",
  "SSH_KEY_BASE64",
  "SSH_KNOWN_HOSTS_BASE64",
  "AUTH_TOKEN",
] as const

export type ConfigKey = (typeof CONFIG_KEYS)[number]

const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const QUOTED = /^(['"])([\s\S]*)\1$/
const PARSE_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
  '"': '"',
  "\\": "\\",
}
const SERIALIZE_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
}

/** Parse the small dotenv subset used by the jujuba config file. */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) continue
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line
    const separator = body.indexOf("=")
    if (separator <= 0) continue
    const key = body.slice(0, separator).trim()
    if (!KEY_NAME.test(key)) continue
    values[key] = parseValue(body.slice(separator + 1))
  }
  return values
}

function parseValue(raw: string): string {
  const value = raw.trim()
  const quoted = QUOTED.exec(value)
  if (quoted !== null) {
    const quote = quoted[1]
    const inner = quoted[2]!
    if (quote === "'") return inner
    return inner.replace(/\\([nrt"\\])/g, (_match, char: string) => PARSE_ESCAPES[char]!)
  }
  const comment = value.indexOf(" #")
  return (comment === -1 ? value : value.slice(0, comment)).trim()
}

function escapeValue(value: string): string {
  return value.replace(/[\\"\n\r\t]/g, (char) => SERIALIZE_ESCAPES[char]!)
}

/** Serialize values as double-quoted dotenv lines, sorted for stable diffs. */
export function serializeEnv(values: Readonly<Record<string, string>>): string {
  const keys = Object.keys(values).sort()
  if (keys.length === 0) return ""
  return `${keys.map((key) => `${key}="${escapeValue(values[key]!)}"`).join("\n")}\n`
}

/** Read a dotenv file; a missing file is an empty configuration, not an error. */
export function loadEnvFile(file: string): Record<string, string> {
  let content: string
  try {
    content = readFileSync(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
  return parseEnvFile(content)
}

export interface ResolveEnvInput {
  readonly file: Readonly<Record<string, string>>
  readonly env: Readonly<Record<string, string | undefined>>
  /** `AUTH_TOKEN` is meaningless until the TUI can send an Authorization header. */
  readonly allowAuthToken?: boolean | undefined
}

export interface ResolvedEnvironment {
  readonly values: Readonly<Record<string, string>>
  readonly droppedAuthToken: boolean
}

function firstValue(...candidates: readonly (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== "") return candidate
  }
  return undefined
}

/**
 * Merge precedence: process environment, then the config file, then nothing
 * (keys that are absent keep the defaults from `wrangler.jsonc`).
 */
export function resolveEnv(input: ResolveEnvInput): ResolvedEnvironment {
  const values: Record<string, string> = {}
  let droppedAuthToken = false
  for (const key of CONFIG_KEYS) {
    const value = firstValue(input.env[key], input.file[key])
    if (value === undefined) continue
    if (key === "AUTH_TOKEN" && input.allowAuthToken !== true) {
      droppedAuthToken = true
      continue
    }
    values[key] = value
  }
  return { values, droppedAuthToken }
}

export interface PathOptions {
  readonly configFile?: string | undefined
  readonly stateDir?: string | undefined
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  readonly home?: string | undefined
}

export interface JujubaPaths {
  readonly root: string
  readonly configFile: string
  readonly stateDir: string
  readonly runtimeEnvFile: string
  readonly persistDir: string
  readonly bundleDir: string
  readonly buildStateFile: string
  readonly tuiStateDir: string
}

function expandTilde(value: string, home: string): string {
  if (value === "~") return home
  if (value.startsWith("~/")) return path.join(home, value.slice(2))
  return value
}

export function resolvePaths(root: string, options: PathOptions = {}): JujubaPaths {
  const env = options.env ?? {}
  const home = options.home ?? env.HOME ?? homedir()
  const configHome = env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  const stateHome = env.XDG_STATE_HOME ?? path.join(home, ".local", "state")
  const stateDir = expandTilde(options.stateDir ?? env.JUJUBA_STATE ?? path.join(stateHome, "jujuba"), home)
  const configFile = expandTilde(
    options.configFile ?? env.JUJUBA_CONFIG ?? path.join(configHome, "jujuba", "env"),
    home,
  )
  return {
    root,
    configFile,
    stateDir,
    runtimeEnvFile: path.join(stateDir, "env"),
    persistDir: path.join(stateDir, "wrangler-state"),
    bundleDir: path.join(stateDir, "dist"),
    buildStateFile: path.join(stateDir, "build.json"),
    tuiStateDir: path.join(stateDir, "tui"),
  }
}
