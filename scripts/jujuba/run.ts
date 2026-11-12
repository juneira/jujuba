import { appendFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { CliOptions } from "../../src/jujuba/args.js"
import { serializeEnv, type JujubaPaths } from "../../src/jujuba/config.js"
import { dockerReady } from "../lib/docker.js"
import { waitForHealth } from "../lib/health.js"
import { portAvailable } from "../lib/port.js"
import { readTail, Supervisor } from "../lib/supervisor.js"
import { startSidecarFixer } from "../local-sidecar-fix.js"

/**
 * Start the local worker with the production configuration and hand the
 * terminal to the TUI. Mirrors `bun run dev`, but reads secrets from the
 * generated runtime env file and keeps its state outside the repository.
 */
export async function startLocal(
  options: CliOptions,
  paths: JujubaPaths,
  values: Readonly<Record<string, string>>,
): Promise<never> {
  if (!(await dockerReady())) {
    throw new Error("Docker is required for local Cloudflare Containers. Start Docker and run `jujuba` again.")
  }

  const wrangler = path.join(paths.root, "node_modules", "wrangler", "bin", "wrangler.js")
  if (!existsSync(wrangler)) throw new Error("wrangler is not installed; run `bun install` first")

  if (!(await portAvailable(options.port))) {
    throw new Error(`port ${options.port} is already in use; pass --port <n>`)
  }

  mkdirSync(paths.stateDir, { recursive: true })
  writeFileSync(paths.runtimeEnvFile, serializeEnv(values), { mode: 0o600 })
  chmodSync(paths.runtimeEnvFile, 0o600)

  const url = `http://127.0.0.1:${options.port}`
  let sidecarFixer: { stop(): void } | undefined

  const supervisor = new Supervisor(paths.stateDir, {
    label: "jujuba",
    onMessage: (message) => console.error(message),
    onStop: () => sidecarFixer?.stop(),
  })

  if (process.env.SANDBOX_LOCAL_FIX_EGRESS !== "false") {
    sidecarFixer = startSidecarFixer((message) => {
      try {
        appendFileSync(path.join(paths.stateDir, "sidecar.log"), `${message}\n`)
      } catch {
        // The sidecar log is diagnostic only; never take the run down for it.
      }
    })
  }

  process.on("SIGINT", () => supervisor.shutdown(0))
  process.on("SIGTERM", () => supervisor.shutdown(0))

  console.log(`[jujuba] starting wrangler on ${url}; the sandbox image builds on first use`)
  console.log(`[jujuba] service logs: ${path.join(paths.stateDir, "wrangler.log")}`)

  supervisor.start(
    "wrangler",
    "node",
    [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(options.port),
      "--env-file",
      paths.runtimeEnvFile,
      "--persist-to",
      paths.persistDir,
    ],
    { env: { WRANGLER_SEND_METRICS: "false" } },
  )

  const healthy = await waitForHealth(url, { stopped: () => supervisor.stopping || supervisor.failed })
  if (!healthy && !supervisor.stopping && !supervisor.failed) {
    const tail = await readTail(path.join(paths.stateDir, "wrangler.log"))
    supervisor.fail(`[jujuba] worker did not become healthy at ${url}${tail === "" ? "" : `\n${tail}`}`)
  }

  if (!supervisor.stopping) {
    console.log(`[jujuba] worker ready at ${url}; opening the TUI`)
    supervisor.start("tui", "bun", ["run", "src/tui/main.ts"], {
      env: { TUI_URL: url, TUI_AGENT: options.agent, TUI_STATE_DIR: paths.tuiStateDir },
      inheritStdio: true,
      primary: true,
    })
  }

  process.exit(await supervisor.wait())
}
