import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { JujubaPaths } from "../../src/jujuba/config.js"
import { fingerprint, type FingerprintEntry } from "../../src/jujuba/fingerprint.js"
import { dockerImageExists, dockerReady } from "../lib/docker.js"
import { runCommand } from "../lib/command.js"

/** Files outside `src/` that change the worker bundle or the sandbox image. */
const BUILD_INPUTS = ["wrangler.jsonc", "package.json", "bun.lock", "tsconfig.json", "docker/sandbox/Dockerfile"]

export interface BuildState {
  readonly fingerprint: string
  readonly imageTag: string
  readonly builtAt: string
}

export interface BuildOutcome {
  readonly state: BuildState
  readonly skipped: boolean
}

function listFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** Every input that can change the worker bundle or the sandbox image. */
export function collectBuildEntries(root: string): FingerprintEntry[] {
  const relative = (file: string): string => path.relative(root, file).split(path.sep).join("/")
  const files = [
    ...listFiles(path.join(root, "src")).filter((file) => file.endsWith(".ts")),
    ...BUILD_INPUTS.map((file) => path.join(root, file)).filter((file) => existsSync(file)),
  ]
  return files.map((file) => ({ path: relative(file), content: readFileSync(file, "utf8") }))
}

export function readBuildState(file: string): BuildState | undefined {
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object") return undefined
    const state = parsed as { fingerprint?: unknown; imageTag?: unknown; builtAt?: unknown }
    if (typeof state.fingerprint !== "string" || typeof state.imageTag !== "string") return undefined
    return {
      fingerprint: state.fingerprint,
      imageTag: state.imageTag,
      builtAt: typeof state.builtAt === "string" ? state.builtAt : "",
    }
  } catch {
    return undefined
  }
}

/**
 * Compile the worker with the production bundler and build the sandbox image.
 * Both steps are incremental: Docker reuses layers and the fingerprint lets a
 * repeated `jujuba` skip the work entirely.
 */
export async function buildProject(
  root: string,
  paths: JujubaPaths,
  log: (message: string) => void,
  options: { force?: boolean } = {},
): Promise<BuildOutcome> {
  const current = fingerprint(collectBuildEntries(root))
  const imageTag = `jujuba-sandbox:${current}`

  const previous = readBuildState(paths.buildStateFile)
  if (
    options.force !== true &&
    previous !== undefined &&
    previous.fingerprint === current &&
    existsSync(paths.bundleDir) &&
    (await dockerImageExists(imageTag))
  ) {
    log(`[jujuba] build is up to date (${imageTag})`)
    return { state: previous, skipped: true }
  }

  if (!(await dockerReady())) {
    throw new Error("Docker is required for local Cloudflare Containers. Start Docker and run `jujuba` again.")
  }

  const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js")
  if (!existsSync(wrangler)) throw new Error("wrangler is not installed; run `bun install` first")

  log("[jujuba] building the worker bundle…")
  const bundle = await runCommand(
    "node",
    [wrangler, "deploy", "--dry-run", "--outdir", paths.bundleDir, "--containers-rollout", "none"],
    { cwd: root, inheritStdio: true },
  )
  if (bundle.code !== 0) throw new Error("the worker build failed (see the output above)")

  log(`[jujuba] building the sandbox image ${imageTag}…`)
  if (await dockerImageExists(imageTag)) {
    log("[jujuba] sandbox image already exists; reusing it")
  } else {
    const image = await runCommand(
      "docker",
      ["build", "-t", imageTag, "-f", path.join(root, "docker/sandbox/Dockerfile"), path.join(root, "docker/sandbox")],
      { cwd: root, inheritStdio: true },
    )
    if (image.code !== 0) throw new Error("the sandbox image build failed (see the output above)")
  }

  const state: BuildState = { fingerprint: current, imageTag, builtAt: new Date().toISOString() }
  mkdirSync(paths.stateDir, { recursive: true })
  writeFileSync(paths.buildStateFile, `${JSON.stringify(state, null, 2)}\n`)
  return { state, skipped: false }
}
