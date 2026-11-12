import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { CliError, parseArgs, USAGE, validateAgent, type CliOptions } from "../../src/jujuba/args.js"
import {
  loadEnvFile,
  resolveEnv,
  resolvePaths,
  serializeEnv,
  type JujubaPaths,
} from "../../src/jujuba/config.js"
import { dockerReady } from "../lib/docker.js"
import { portAvailable } from "../lib/port.js"
import { runCommand } from "../lib/command.js"
import { loadSshEnvironment } from "../lib/ssh.js"
import { buildProject } from "./build.js"
import { startLocal } from "./run.js"

export interface MainOptions {
  readonly root: string
  readonly argv: readonly string[]
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
}

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017"
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"

type Environment = Readonly<Record<string, string | undefined>>

function numberFromEnv(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === "") return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new CliError(`invalid ${name}: ${raw}`)
  return value
}

interface LocalSsh {
  readonly values: Record<string, string>
  readonly keyPath?: string
}

/** Fills in the host SSH key for local runs without overriding explicit config. */
function withLocalSsh(values: Readonly<Record<string, string>>, env: Environment): LocalSsh {
  const ssh = loadSshEnvironment(env.HOME ?? homedir(), env)
  const next: Record<string, string> = { ...values }
  if (next.SSH_KEY_BASE64 === undefined && ssh.keyBase64 !== undefined) next.SSH_KEY_BASE64 = ssh.keyBase64
  if (next.SSH_KNOWN_HOSTS_BASE64 === undefined && ssh.knownHostsBase64 !== undefined) {
    next.SSH_KNOWN_HOSTS_BASE64 = ssh.knownHostsBase64
  }
  return {
    values: next,
    ...(values.SSH_KEY_BASE64 === undefined && ssh.keyPath !== undefined ? { keyPath: ssh.keyPath } : {}),
  }
}

function version(root: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    if (parsed !== null && typeof parsed === "object") {
      const value = (parsed as { version?: unknown }).version
      if (typeof value === "string") return value
    }
  } catch {
    // A missing or malformed package.json must not break `jujuba --version`.
  }
  return "unknown"
}

function initConfig(paths: JujubaPaths, options: CliOptions, env: Environment): number {
  if (existsSync(paths.configFile) && !options.force) {
    console.log(`[jujuba] config already exists: ${paths.configFile}`)
    console.log("[jujuba] pass --force to overwrite it")
    return 0
  }

  const values = {
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ?? "",
    OPENROUTER_MODEL: env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
    OPENROUTER_BASE_URL: env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL,
    SANDBOX_INSTANCE: env.SANDBOX_INSTANCE ?? "standard-1",
    SANDBOX_INTERNET: env.SANDBOX_INTERNET ?? "true",
    SANDBOX_INACTIVITY_MS: env.SANDBOX_INACTIVITY_MS ?? "600000",
  }

  mkdirSync(path.dirname(paths.configFile), { recursive: true })
  const header = [
    "# jujuba configuration — keep this file private (mode 600).",
    "# Get an API key at https://openrouter.ai/keys",
    "",
  ].join("\n")
  writeFileSync(paths.configFile, header + serializeEnv(values), { mode: 0o600 })
  chmodSync(paths.configFile, 0o600)

  console.log(`[jujuba] wrote ${paths.configFile} (mode 600)`)
  if (values.OPENROUTER_API_KEY === "") {
    console.log("[jujuba] set OPENROUTER_API_KEY in that file before running `jujuba`")
  }
  return 0
}

async function doctor(paths: JujubaPaths, options: CliOptions, env: Environment): Promise<number> {
  let failures = 0
  const report = (ok: boolean, label: string, detail?: string): void => {
    console.log(`${ok ? "✓" : "✗"} ${label}${detail === undefined || detail === "" ? "" : ` — ${detail}`}`)
    if (!ok) failures += 1
  }

  const bun = (process.versions as Record<string, string | undefined>).bun
  report(bun !== undefined, "bun", bun)

  try {
    const node = await runCommand("node", ["--version"])
    report(node.code === 0, "node", node.stdout.trim())
  } catch {
    report(false, "node", "not found on PATH")
  }

  report(await dockerReady(), "docker daemon", "needed for local containers")

  const wrangler = path.join(paths.root, "node_modules", "wrangler", "bin", "wrangler.js")
  const wranglerExists = existsSync(wrangler)
  report(wranglerExists, "wrangler", wranglerExists ? undefined : "run `bun install`")

  const resolved = resolveEnv({ file: loadEnvFile(paths.configFile), env })
  const apiKey = resolved.values.OPENROUTER_API_KEY
  report(
    apiKey !== undefined,
    "OPENROUTER_API_KEY",
    apiKey === undefined ? `run \`jujuba init\` (${paths.configFile})` : paths.configFile,
  )

  const localSsh = withLocalSsh(resolved.values, env)
  const hasSsh = localSsh.values.SSH_KEY_BASE64 !== undefined
  console.log(`${hasSsh ? "✓" : "–"} ssh key${localSsh.keyPath === undefined ? "" : ` — ${localSsh.keyPath}`}`)

  if (resolved.droppedAuthToken) {
    console.log("[jujuba] note: AUTH_TOKEN is ignored in local mode")
  }

  const free = await portAvailable(options.port)
  report(free, `port ${options.port}`, free ? undefined : "in use; pass --port")

  return failures === 0 ? 0 : 1
}

export async function main(options: MainOptions): Promise<number> {
  const env = options.env ?? process.env

  let parsed: CliOptions
  try {
    parsed = parseArgs(options.argv, {
      port: numberFromEnv(env.JUJUBA_PORT, "JUJUBA_PORT"),
      agent: env.JUJUBA_AGENT,
    })
    validateAgent(parsed.agent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`jujuba: ${message}`)
    console.error(`\n${USAGE}`)
    return 2
  }

  if (parsed.command === "help") {
    console.log(USAGE)
    return 0
  }
  if (parsed.command === "version") {
    console.log(`JUJUBA ${version(options.root)}`)
    return 0
  }

  const paths = resolvePaths(options.root, {
    configFile: parsed.configFile,
    stateDir: parsed.stateDir,
    env,
  })

  if (parsed.command === "init") return initConfig(paths, parsed, env)
  if (parsed.command === "doctor") return doctor(paths, parsed, env)

  if (parsed.command === "build") {
    try {
      await buildProject(options.root, paths, console.log)
    } catch (error) {
      return failure(error)
    }
    return 0
  }

  const resolved = resolveEnv({ file: loadEnvFile(paths.configFile), env })
  if (resolved.droppedAuthToken) {
    console.warn("[jujuba] AUTH_TOKEN is ignored in local mode (the TUI does not send an Authorization header yet)")
  }

  const localSsh = withLocalSsh(resolved.values, env)
  if (localSsh.keyPath !== undefined) {
    console.log(`[jujuba] forwarding SSH key ${localSsh.keyPath} to sandboxes`)
  }

  if (resolved.values.OPENROUTER_API_KEY === undefined) {
    console.error(
      `jujuba: OPENROUTER_API_KEY is not set.\nRun \`jujuba init\` to create ${paths.configFile}, or export it in your shell.`,
    )
    return 1
  }

  if (parsed.command === "run") {
    try {
      await buildProject(options.root, paths, console.log)
    } catch (error) {
      return failure(error)
    }
  }

  try {
    await startLocal(parsed, paths, localSsh.values)
  } catch (error) {
    return failure(error)
  }
  return 0
}

function failure(error: unknown): number {
  console.error(`jujuba: ${error instanceof Error ? error.message : String(error)}`)
  return 1
}
