import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { startSidecarFixer } from "../../scripts/local-sidecar-fix.js"
import { startFakeOpenRouter } from "../support/llm-server.js"

import { E2E_BASE, E2E_LLM_PORT, E2E_PORT } from "./constants.js"

const DEV_VARS = path.resolve(".dev.vars")
const CONTAINER_STATE = path.resolve("test/.tmp/e2e-container.json")

function dockerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
      stdio: ["ignore", "ignore", "ignore"],
    })
    child.on("error", () => resolve(false))
    child.on("close", (code) => resolve(code === 0))
  })
}

async function waitForHealth(worker: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`wrangler dev exited early (${worker.exitCode}):\n${output().slice(-8_000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${E2E_PORT}/health`)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`wrangler dev did not become healthy:\n${output().slice(-8_000)}`)
}

async function probeContainer(): Promise<{ available: boolean; reason?: string }> {
  const post = async (route: string, body: unknown): Promise<{ ok: boolean; body: unknown }> => {
    const response = await fetch(`${E2E_BASE}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    return { ok: response.ok, body: await response.json() }
  }

  try {
    await post("/api/sandbox/reset", { agent: "e2e-probe" })
    const write = await post("/api/sandbox/write", {
      agent: "e2e-probe",
      path: "/workspace/probe.txt",
      content: "ok",
    })
    if (!write.ok) return { available: false, reason: JSON.stringify(write.body) }
    const read = await post("/api/sandbox/read", { agent: "e2e-probe", path: "/workspace/probe.txt" })
    if (!read.ok) return { available: false, reason: JSON.stringify(read.body) }
    const content = (read.body as { content?: string }).content
    if (content !== "ok") return { available: false, reason: `unexpected content: ${String(content)}` }
    return { available: true }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  if (!(await dockerReady())) {
    throw new Error(
      "Docker is required for the e2e suite because the agent runs in a Cloudflare Container. Start Docker and retry.",
    )
  }

  const sidecarFixer =
    process.env.SANDBOX_LOCAL_FIX_EGRESS === "false"
      ? undefined
      : startSidecarFixer((message) => console.warn(`[e2e] ${message}`))

  const llm = await startFakeOpenRouter({ port: E2E_LLM_PORT })

  const previousVars = await readFile(DEV_VARS, "utf8").catch(() => "")
  const testSshKey = Buffer.from(
    "-----BEGIN OPENSSH PRIVATE KEY-----\ne2e-key\n-----END OPENSSH PRIVATE KEY-----\n",
  ).toString("base64")
  const testKnownHosts = Buffer.from("github.com ssh-ed25519 AAAA\n").toString("base64")
  await writeFile(
    DEV_VARS,
    [
      "OPENROUTER_API_KEY=test-key",
      "OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash-1017",
      `OPENROUTER_BASE_URL=http://127.0.0.1:${E2E_LLM_PORT}/v1`,
      "SANDBOX_INSTANCE=standard-1",
      "SANDBOX_INTERNET=true",
      "SANDBOX_INACTIVITY_MS=600000",
      `SSH_KEY_BASE64=${testSshKey}`,
      `SSH_KNOWN_HOSTS_BASE64=${testKnownHosts}`,
      "",
    ].join("\n"),
  )

  const worker = spawn(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "dev", "--port", String(E2E_PORT), "--ip", "127.0.0.1"],
    {
      cwd: process.cwd(),
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let output = ""
  worker.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()))
  worker.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()))

  try {
    await waitForHealth(worker, () => output)
  } catch (error) {
    worker.kill("SIGKILL")
    sidecarFixer?.stop()
    await llm.close()
    await writeFile(DEV_VARS, previousVars)
    throw error
  }

  const probe = await probeContainer()
  await mkdir(path.dirname(CONTAINER_STATE), { recursive: true })
  await writeFile(CONTAINER_STATE, JSON.stringify(probe))
  if (!probe.available) {
    const message = `container probe failed: ${probe.reason ?? "unknown error"}`
    if (process.env.E2E_REQUIRE_CONTAINER === "1") {
      worker.kill("SIGKILL")
      sidecarFixer?.stop()
      await llm.close()
      await writeFile(DEV_VARS, previousVars)
      throw new Error(message)
    }
    console.warn(`[e2e] ${message}; container-dependent tests will be skipped`)
  }

  return async () => {
    worker.kill("SIGTERM")
    await new Promise<void>((resolve) => {
      if (worker.exitCode !== null) return resolve()
      worker.once("exit", () => resolve())
      setTimeout(() => {
        worker.kill("SIGKILL")
        resolve()
      }, 10_000)
    })
    await llm.close()
    sidecarFixer?.stop()
    await writeFile(DEV_VARS, previousVars)
  }
}
