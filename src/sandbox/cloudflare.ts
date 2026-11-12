import { Files, SandboxFileError, SandboxProtocolError } from "@cloudflare/sandbox"
import path from "node:path"
import { WORKSPACE, normalizeWorkspacePath } from "./paths.js"
import {
  clampTimeout,
  MAX_READ_BYTES,
  MAX_READ_LINES,
  DEFAULT_READ_LINES,
  readCapped,
  readLimited,
  resolveWorkspaceCwd,
  shellQuote,
} from "./output.js"
import {
  SandboxError,
  type EditFileResult,
  type EntryType,
  type ExecResult,
  type GlobResult,
  type GrepMatch,
  type GrepResult,
  type ListEntry,
  type ListResult,
  type PatchResult,
  type ReadFileResult,
  type WriteFileResult,
} from "./types.js"
import {
  normalizeKnownHosts,
  normalizePrivateKey,
  SSH_CONFIG,
  SSH_CONFIG_PATH,
  SSH_DIR,
  SSH_KEY_PATH,
  SSH_KNOWN_HOSTS_PATH,
  SSH_PERMISSIONS_COMMAND,
} from "./ssh.js"
import type { ExecOptions, GrepOptions, ReadOptions, Sandbox, SandboxSnapshot, SandboxStatus } from "./backend.js"

const SNAPSHOT_KEY = "sandbox.snapshotId"
const DEFAULT_INACTIVITY_MS = 10 * 60 * 1_000
const MAX_INACTIVITY_MS = 6 * 60 * 60 * 1_000
const MAX_GLOB_RESULTS = 1_000
const MAX_GREP_LIMIT = 500
const DEFAULT_GREP_LIMIT = 100
const MAX_GREP_TEXT = 400

export type SandboxInstance =
  | "lite"
  | "standard-1"
  | "standard-2"
  | "standard-3"
  | "standard-4"

/** The subset of Durable Object storage the adapter needs. */
export interface SnapshotStore {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<unknown>
  delete(key: string): Promise<unknown>
}

/** The subset of `ctx.container` the adapter uses. */
export interface ContainerLike {
  readonly running: boolean
  readonly images: Record<string, string>
  start(options: ContainerStartupOptions): void
  exec(cmd: string[], options?: ContainerExecOptions): Promise<ExecProcess>
  setInactivityTimeout(durationMs: number | bigint): Promise<void>
  snapshotContainer(options?: ContainerSnapshotOptions): Promise<ContainerSnapshot>
  destroy(error?: unknown): Promise<void>
  inspect(): Promise<ContainerInfo | null>
}

export interface FilesLike {
  readFile(path: string, options?: { signal?: AbortSignal }): Promise<Response>
  writeFile(path: string, content: string, options?: { signal?: AbortSignal }): Promise<void>
  stat(path: string, options?: { signal?: AbortSignal }): Promise<{ type: string; size: bigint }>
  readDirectory(path: string, options?: { signal?: AbortSignal }): Promise<{ name: string; type: string }[]>
  mkdir(path: string, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>
  remove(path: string, options?: { force?: boolean; signal?: AbortSignal }): Promise<void>
}

export interface CloudflareSandboxOptions {
  readonly container: ContainerLike | undefined
  readonly storage: SnapshotStore
  readonly instance?: SandboxInstance
  readonly internet?: boolean
  readonly inactivityMs?: number
  readonly image?: string
  readonly files?: FilesLike
  /** PEM/OpenSSH private key installed as the sandbox's git identity. */
  readonly sshPrivateKey?: string
  /** Optional known_hosts contents installed next to the key. */
  readonly sshKnownHosts?: string
}

export function parseInstance(value: string | undefined): SandboxInstance {
  switch (value) {
    case "lite":
    case "standard-1":
    case "standard-2":
    case "standard-3":
    case "standard-4":
      return value
    default:
      return "standard-1"
  }
}

function clampInactivity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_INACTIVITY_MS
  return Math.min(MAX_INACTIVITY_MS, value)
}

function mapEntryType(type: string): EntryType {
  if (type === "directory") return "dir"
  if (type === "symlink") return "symlink"
  return "file"
}

function entryRank(type: EntryType): number {
  return type === "dir" ? 0 : 1
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count += 1
    from = at + needle.length
  }
}

function mapError(error: unknown): SandboxError {
  if (error instanceof SandboxError) return error
  if (SandboxFileError.is(error)) {
    const status = error.code === "ENOENT" ? 404 : error.code === "EACCES" || error.code === "EPERM" ? 403 : 400
    return new SandboxError(
      `${error.operation} ${error.path}: ${error.detail}`,
      status,
      error.code === "ENOENT" ? "not_found" : "file_error",
    )
  }
  if (SandboxProtocolError.is(error)) {
    return new SandboxError(`sandbox protocol error: ${error.detail}`, 500, "protocol_error")
  }
  return new SandboxError(error instanceof Error ? error.message : "sandbox error", 500, "sandbox_error")
}

function isSnapshotFailure(error: Error): boolean {
  return /snapshot/i.test(error.message) && /(not found|expired|missing|unable)/i.test(error.message)
}

export class CloudflareSandbox implements Sandbox {
  readonly #container: ContainerLike
  readonly #files: FilesLike
  readonly #storage: SnapshotStore
  readonly #instance: SandboxInstance
  readonly #internet: boolean
  readonly #inactivityMs: number
  readonly #image: string | undefined
  readonly #sshPrivateKey: string | undefined
  readonly #sshKnownHosts: string | undefined
  #sshReady = false
  #cachedSnapshotId: string | undefined
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: CloudflareSandboxOptions) {
    if (options.container === undefined) {
      throw new SandboxError("container binding is not configured", 500, "container_unavailable")
    }
    this.#container = options.container
    this.#files = options.files ?? new Files(options.container)
    this.#storage = options.storage
    this.#instance = options.instance ?? "standard-1"
    this.#internet = options.internet ?? true
    this.#inactivityMs = clampInactivity(options.inactivityMs)
    this.#image = options.image
    this.#sshPrivateKey = options.sshPrivateKey
    this.#sshKnownHosts = options.sshKnownHosts
  }

  get running(): boolean {
    return this.#container.running
  }

  read(path: string, options: ReadOptions = {}, signal?: AbortSignal): Promise<ReadFileResult> {
    return this.#exclusive(() => this.#withRecovery(() => this.#read(path, options, signal)))
  }

  write(path: string, content: string, signal?: AbortSignal): Promise<WriteFileResult> {
    return this.#exclusive(() =>
      this.#withRecovery(async () => {
        if (typeof content !== "string") {
          throw new SandboxError("content must be a string", 400, "invalid_input")
        }
        const target = normalizeWorkspacePath(path)
        await this.#writeText(target, content, signal)
        return { path: target, bytes: new TextEncoder().encode(content).byteLength }
      }),
    )
  }

  edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll = false,
    signal?: AbortSignal,
  ): Promise<EditFileResult> {
    return this.#exclusive(() =>
      this.#withRecovery(async () => {
        if (oldString === "") throw new SandboxError("oldString must not be empty", 400, "invalid_input")
        const target = normalizeWorkspacePath(path)
        const current = await this.#readText(target, signal)
        const count = countOccurrences(current, oldString)
        if (count === 0) throw new SandboxError("oldString not found", 404, "not_found")
        if (count > 1 && !replaceAll) {
          throw new SandboxError(
            `oldString appears ${count} times; provide more context or set replaceAll`,
            409,
            "ambiguous_edit",
          )
        }
        const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString)
        await this.#writeText(target, next, signal)
        return { path: target, replacements: replaceAll ? count : 1 }
      }),
    )
  }

  patch(patch: string, signal?: AbortSignal): Promise<PatchResult> {
    return this.#exclusive(() =>
      this.#withRecovery(async () => {
        if (patch.trim() === "") throw new SandboxError("patch is required", 400, "invalid_input")
        await this.#ensureRunning()
        const temporary = `/tmp/jujuba-${crypto.randomUUID()}.patch`
        try {
          await this.#files.writeFile(temporary, patch, { ...(signal === undefined ? {} : { signal }) })
          let lastError = ""
          for (const strip of ["-p1", "-p0"]) {
            const result = await this.#exec(
              `git apply --whitespace=nowarn ${strip} ${shellQuote(temporary)}`,
              { cwd: WORKSPACE, ...(signal === undefined ? {} : { signal }) },
            )
            if (result.exitCode === 0) {
              return {
                output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "patch applied",
              }
            }
            lastError = result.stderr || result.stdout
          }
          throw new SandboxError(`patch failed: ${lastError.slice(0, 2_000)}`, 409, "patch_failed")
        } finally {
          await this.#files.remove(temporary, { force: true }).catch(() => undefined)
        }
      }),
    )
  }

  glob(pattern: string, cwd?: string, signal?: AbortSignal): Promise<GlobResult> {
    return this.#exclusive(() =>
      this.#withRecovery(async () => {
        if (pattern.trim() === "") throw new SandboxError("pattern is required", 400, "invalid_input")
        const base = resolveWorkspaceCwd(cwd)
        const result = await this.#exec(
          `rg --files --hidden --glob '!.git' --glob '!node_modules' --glob '!coverage' --glob '!dist' --glob '!.wrangler' --glob ${shellQuote(pattern)} . | head -n ${MAX_GLOB_RESULTS + 1}`,
          { cwd: base, ...(signal === undefined ? {} : { signal }) },
        )
        const lines = result.stdout.split("\n").filter((line) => line !== "")
        const truncated = lines.length > MAX_GLOB_RESULTS
        const paths = lines
          .slice(0, MAX_GLOB_RESULTS)
          .map((line) => (line.startsWith("/") ? line : `${base}/${line}`))
          .sort()
        return { paths, truncated }
      }),
    )
  }

  grep(pattern: string, options: GrepOptions = {}, signal?: AbortSignal): Promise<GrepResult> {
    return this.#exclusive(() =>
      this.#withRecovery(async () => {
        if (pattern.trim() === "") throw new SandboxError("pattern is required", 400, "invalid_input")
        const base = normalizeWorkspacePath(options.path ?? WORKSPACE)
        const limit = Math.min(MAX_GREP_LIMIT, Math.max(1, options.limit ?? DEFAULT_GREP_LIMIT))
        const flags = ["-n", "--no-heading", "--color", "never", "--hidden"]
        if (options.ignoreCase === true) flags.push("-i")
        if (options.glob !== undefined) flags.push("--glob", shellQuote(options.glob))
        const result = await this.#exec(
          `rg ${flags.join(" ")} ${shellQuote(pattern)} ${shellQuote(base)} | head -n ${limit + 1}`,
          { cwd: WORKSPACE, ...(signal === undefined ? {} : { signal }) },
        )
        const lines = result.stdout.split("\n").filter((line) => line !== "")
        const truncated = lines.length > limit
        const matches: GrepMatch[] = []
        for (const line of lines.slice(0, limit)) {
          const match = /^(.*?):(\d+):(.*)$/.exec(line)
          if (match === null) continue
          matches.push({
            path: match[1] as string,
            line: Number(match[2]),
            text: (match[3] as string).slice(0, MAX_GREP_TEXT),
          })
        }
        return { matches, truncated }
      }),
    )
  }

  list(path: string, signal?: AbortSignal): Promise<ListResult> {
    return this.#exclusive(() =>
      this.#withRecovery(async () => {
        const target = normalizeWorkspacePath(path)
        await this.#ensureRunning()
        try {
          const entries = await this.#files.readDirectory(target, { ...(signal === undefined ? {} : { signal }) })
          const listed: ListEntry[] = await Promise.all(
            entries.map(async (entry) => {
              const full = target === WORKSPACE ? `${WORKSPACE}/${entry.name}` : `${target}/${entry.name}`
              const stats = await this.#files.stat(full, { ...(signal === undefined ? {} : { signal }) }).catch(() => undefined)
              return {
                name: entry.name,
                type: mapEntryType(entry.type),
                size: stats === undefined ? 0 : Number(stats.size),
              }
            }),
          )
          listed.sort(
            (a, b) => entryRank(a.type) - entryRank(b.type) || a.name.localeCompare(b.name),
          )
          return { path: target, entries: listed }
        } catch (error) {
          throw mapError(error)
        }
      }),
    )
  }

  exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.#exclusive(() => this.#withRecovery(() => this.#exec(command, options)))
  }

  async status(): Promise<SandboxStatus> {
    const info = await this.#container.inspect().catch(() => null)
    return {
      backend: "cloudflare",
      running: this.#container.running,
      image: info?.image ?? null,
      snapshotId: (await this.#snapshotId()) ?? null,
    }
  }

  /** Re-arms the inactivity timeout after a Durable Object restart. */
  async ensureInactivityTimeout(): Promise<void> {
    await this.#container.setInactivityTimeout(this.#inactivityMs)
  }

  save(): Promise<SandboxSnapshot> {
    return this.#exclusive(async () => {
      await this.#ensureRunning()
      try {
        const snapshot = await this.#container.snapshotContainer({ name: "workspace" })
        await this.#storage.put(SNAPSHOT_KEY, snapshot.id)
        this.#cachedSnapshotId = snapshot.id
        return { id: snapshot.id, size: snapshot.size }
      } catch (error) {
        throw mapError(error)
      }
    })
  }

  reset(): Promise<void> {
    return this.#exclusive(async () => {
      if (this.#container.running) await this.#container.destroy()
      await this.#storage.delete(SNAPSHOT_KEY)
      this.#cachedSnapshotId = undefined
      this.#sshReady = false
    })
  }

  async #read(path: string, options: ReadOptions, signal?: AbortSignal): Promise<ReadFileResult> {
    const target = normalizeWorkspacePath(path)
    const text = await this.#readText(target, signal)
    const lines = text.split("\n")
    if (lines.at(-1) === "") lines.pop()
    const offset = Math.max(1, options.offset ?? 1)
    const limit = Math.min(MAX_READ_LINES, Math.max(1, options.limit ?? DEFAULT_READ_LINES))
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    return {
      path: target,
      content: slice.join("\n"),
      totalLines: lines.length,
      truncated: offset - 1 + slice.length < lines.length,
    }
  }

  async #readText(target: string, signal?: AbortSignal): Promise<string> {
    await this.#ensureRunning()
    try {
      const response = await this.#files.readFile(target, { ...(signal === undefined ? {} : { signal }) })
      const bytes = await readLimited(response.body, MAX_READ_BYTES).catch((error: unknown) => {
        if (error instanceof Error && /larger than/.test(error.message)) {
          throw new SandboxError(`${target} is too large`, 413, "too_large")
        }
        throw error
      })
      if (bytes.subarray(0, 8_192).includes(0)) {
        throw new SandboxError(`${target} looks binary`, 400, "binary_file")
      }
      return new TextDecoder().decode(bytes)
    } catch (error) {
      throw mapError(error)
    }
  }

  async #writeText(target: string, content: string, signal?: AbortSignal): Promise<void> {
    await this.#ensureRunning()
    try {
      const directory = path.posix.dirname(target)
      if (directory !== WORKSPACE && directory !== "/") {
        await this.#files.mkdir(directory, { recursive: true, ...(signal === undefined ? {} : { signal }) })
      }
      await this.#files.writeFile(target, content, { ...(signal === undefined ? {} : { signal }) })
    } catch (error) {
      throw mapError(error)
    }
  }

  async #exec(
    command: string,
    options: ExecOptions,
  ): Promise<ExecResult> {
    if (command.trim() === "") throw new SandboxError("command is required", 400, "invalid_input")
    await this.#ensureRunning()
    const timeoutMs = clampTimeout(options.timeoutMs)
    const cwd = resolveWorkspaceCwd(options.cwd)
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    if (options.signal?.aborted === true) {
      controller.abort()
    } else {
      options.signal?.addEventListener("abort", abort, { once: true })
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const startedAt = Date.now()

    try {
      const process = await this.#container.exec(
        ["timeout", "--kill-after=5", String(Math.ceil(timeoutMs / 1_000)), "bash", "-lc", command],
        { cwd, signal: controller.signal },
      )
      const exitCodePromise = process.exitCode.then((code) => {
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", abort)
        return code
      })
      const [stdout, stderr, code] = await Promise.all([
        readCapped(process.stdout),
        readCapped(process.stderr),
        exitCodePromise,
      ])
      const aborted = options.signal?.aborted === true
      const didTimeOut = timedOut || code === 124
      const exitCode = didTimeOut ? 124 : aborted ? 130 : code
      const suffix = didTimeOut
        ? `\n[command timed out after ${timeoutMs}ms]`
        : aborted
          ? "\n[command aborted]"
          : ""
      return {
        exitCode,
        stdout: stdout.value(),
        stderr: `${stderr.value()}${suffix}`.trim(),
        truncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      clearTimeout(timer)
      if (timedOut) {
        return {
          exitCode: 124,
          stdout: "",
          stderr: `[command timed out after ${timeoutMs}ms]`,
          truncated: false,
          durationMs: Date.now() - startedAt,
        }
      }
      if (options.signal?.aborted === true) {
        return {
          exitCode: 130,
          stdout: "",
          stderr: "[command aborted]",
          truncated: false,
          durationMs: Date.now() - startedAt,
        }
      }
      throw mapError(error)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
    }
  }

  async #ensureRunning(): Promise<void> {
    if (!this.#container.running) await this.#start()
    await this.#installSsh()
  }

  async #installSsh(): Promise<void> {
    if (this.#sshReady) return
    if (this.#sshPrivateKey === undefined && this.#sshKnownHosts === undefined) return
    try {
      // exec waits for a starting container; Files does not.
      await this.#runRaw(`mkdir -p ${SSH_DIR}`)
      if (this.#sshPrivateKey !== undefined) {
        await this.#files.writeFile(SSH_KEY_PATH, normalizePrivateKey(this.#sshPrivateKey))
      }
      if (this.#sshKnownHosts !== undefined) {
        await this.#files.writeFile(SSH_KNOWN_HOSTS_PATH, normalizeKnownHosts(this.#sshKnownHosts))
      }
      await this.#files.writeFile(SSH_CONFIG_PATH, SSH_CONFIG)
      await this.#runRaw(SSH_PERMISSIONS_COMMAND)
      this.#sshReady = true
    } catch (error) {
      throw mapError(error)
    }
  }

  async #runRaw(command: string): Promise<void> {
    const process = await this.#container.exec(["bash", "-lc", command])
    const code = await process.exitCode
    if (code !== 0) {
      throw new SandboxError("could not prepare SSH in the sandbox", 500, "ssh_key_install")
    }
  }

  async #start(): Promise<void> {
    this.#sshReady = false
    const snapshotId = await this.#snapshotId()
    const image = this.#container.images.workspace ?? this.#image
    if (image === undefined && snapshotId === undefined) {
      throw new SandboxError("sandbox image is not configured", 500, "image_missing")
    }
    try {
      if (snapshotId !== undefined) {
        this.#container.start({
          containerSnapshot: { id: snapshotId },
          instance: this.#instance,
          enableInternet: this.#internet,
        })
      } else {
        this.#container.start({
          image: image as string,
          instance: this.#instance,
          enableInternet: this.#internet,
        })
      }
    } catch (cause) {
      const error = mapError(cause)
      if (snapshotId === undefined || !isSnapshotFailure(error)) throw error
      await this.#storage.delete(SNAPSHOT_KEY)
      this.#cachedSnapshotId = undefined
      if (image === undefined) throw error
      try {
        this.#container.start({
          image,
          instance: this.#instance,
          enableInternet: this.#internet,
        })
      } catch (fallbackError) {
        throw mapError(fallbackError)
      }
    }
    await this.#container.setInactivityTimeout(this.#inactivityMs)
  }

  async #snapshotId(): Promise<string | undefined> {
    if (this.#cachedSnapshotId !== undefined) return this.#cachedSnapshotId
    const stored = await this.#storage.get<string>(SNAPSHOT_KEY)
    this.#cachedSnapshotId = typeof stored === "string" ? stored : undefined
    return this.#cachedSnapshotId
  }

  async #withRecovery<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (cause) {
      const error = mapError(cause)
      if (!isSnapshotFailure(error)) throw error
      await this.#storage.delete(SNAPSHOT_KEY)
      this.#cachedSnapshotId = undefined
      if (this.#container.running) await this.#container.destroy()
      return await operation()
    }
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
