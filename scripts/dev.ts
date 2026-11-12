import { appendFile, chmod, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { dockerReady } from "./lib/docker.js"
import { waitForHealth } from "./lib/health.js"
import { loadSshEnvironment } from "./lib/ssh.js"
import { readTail, Supervisor } from "./lib/supervisor.js"
import { startSidecarFixer } from "./local-sidecar-fix.js"

const root = process.cwd()
const stateDir = path.join(root, ".dev")
const workerPort = Number(process.env.WORKER_PORT ?? "8787")
const workerUrl = `http://127.0.0.1:${workerPort}`

let sidecarFixer: { stop(): void } | undefined

const supervisor = new Supervisor(stateDir, {
  label: "dev",
  onMessage: (message) => console.error(message),
  onStop: () => sidecarFixer?.stop(),
})

const apiKey = process.env.OPENROUTER_API_KEY ?? ""
if (apiKey === "") throw new Error("OPENROUTER_API_KEY is required")

if (!(await dockerReady())) {
  throw new Error(
    "Docker is required for local Cloudflare Containers. Start Docker and run `bun run dev` again.",
  )
}

await mkdir(stateDir, { recursive: true })

if (process.env.SANDBOX_LOCAL_FIX_EGRESS !== "false") {
  sidecarFixer = startSidecarFixer((message) => {
    void appendFile(path.join(stateDir, "sidecar.log"), `${message}\n`).catch(() => undefined)
  })
}
const ssh = loadSshEnvironment(homedir(), process.env)
const vars = [
  `OPENROUTER_API_KEY=${apiKey}`,
  `OPENROUTER_MODEL=${process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4.1-flash-1017"}`,
  `OPENROUTER_BASE_URL=${process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"}`,
  `SANDBOX_INSTANCE=${process.env.SANDBOX_INSTANCE ?? "standard-1"}`,
  `SANDBOX_INTERNET=${process.env.SANDBOX_INTERNET ?? "true"}`,
  `SANDBOX_INACTIVITY_MS=${process.env.SANDBOX_INACTIVITY_MS ?? "600000"}`,
]
if (ssh.keyBase64 !== undefined) vars.push(`SSH_KEY_BASE64=${ssh.keyBase64}`)
if (ssh.knownHostsBase64 !== undefined) vars.push(`SSH_KNOWN_HOSTS_BASE64=${ssh.knownHostsBase64}`)
vars.push("")

const devVars = path.join(root, ".dev.vars")
await writeFile(devVars, vars.join("\n"), { mode: 0o600 })
await chmod(devVars, 0o600)
if (ssh.keyBase64 !== undefined) {
  console.log(`[dev] forwarding SSH key ${ssh.keyPath ?? "from SSH_KEY_BASE64"} to sandboxes`)
} else {
  console.log("[dev] no SSH key found; git over SSH will need a key inside the sandbox")
}

process.on("SIGINT", () => supervisor.shutdown(0))
process.on("SIGTERM", () => supervisor.shutdown(0))

console.log(`[dev] starting wrangler on 127.0.0.1:${workerPort}; the sandbox image builds on first use`)
console.log(`[dev] service logs: ${path.relative(root, stateDir)}/wrangler.log`)

supervisor.start("wrangler", "node", ["node_modules/wrangler/bin/wrangler.js", "dev", "--port", String(workerPort), "--ip", "127.0.0.1"], {
  env: { WRANGLER_SEND_METRICS: "false" },
})

const healthy = await waitForHealth(workerUrl, { stopped: () => supervisor.stopping || supervisor.failed })
if (!healthy && !supervisor.stopping && !supervisor.failed) {
  const tail = await readTail(path.join(stateDir, "wrangler.log"))
  supervisor.fail(`[dev] worker did not become healthy at ${workerUrl}${tail === "" ? "" : `\n${tail}`}`)
}

if (!supervisor.stopping) {
  console.log(`[dev] worker ready at ${workerUrl}; opening TUI`)
  supervisor.start("tui", "bun", ["run", "src/tui/main.ts"], { env: { TUI_URL: workerUrl }, inheritStdio: true, primary: true })
}

process.exit(await supervisor.wait())
