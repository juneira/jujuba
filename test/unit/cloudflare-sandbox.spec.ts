import { describe, expect, it, vi } from "vitest"

vi.mock("@cloudflare/sandbox", () => ({
  Files: class {
    async readFile(): Promise<Response> {
      return new Response("")
    }
    async writeFile(): Promise<void> {}
    async stat(): Promise<{ type: string; size: bigint }> {
      return { type: "file", size: 0n }
    }
    async readDirectory(): Promise<{ name: string; type: string }[]> {
      return []
    }
    async mkdir(): Promise<void> {}
    async remove(): Promise<void> {}
  },
  SandboxFileError: {
    is: (cause: unknown) =>
      typeof cause === "object" && cause !== null && (cause as { name?: string }).name === "SandboxFileError",
  },
  SandboxProtocolError: {
    is: (cause: unknown) =>
      typeof cause === "object" && cause !== null && (cause as { name?: string }).name === "SandboxProtocolError",
  },
}))

import {
  CloudflareSandbox,
  parseInstance,
  type CloudflareSandboxOptions,
  type ContainerLike,
  type FilesLike,
  type SnapshotStore,
} from "../../src/sandbox/cloudflare.js"

function textStream(text: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function processResult(stdout = "", stderr = "", exitCode = 0): ExecProcess {
  const encoder = new TextEncoder()
  return {
    stdin: null,
    stdout: textStream(stdout),
    stderr: textStream(stderr),
    pid: 1,
    isPty: false,
    exitCode: Promise.resolve(exitCode),
    output: async () => ({
      stdout: encoder.encode(stdout).buffer as ArrayBuffer,
      stderr: encoder.encode(stderr).buffer as ArrayBuffer,
      exitCode,
    }),
    kill: () => undefined,
    resize: () => undefined,
  }
}

function pendingProcess(options?: ContainerExecOptions): ExecProcess {
  let resolveExit: (code: number) => void = () => undefined
  const exitCode = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  const make = (): ReadableStream => {
    let closed = false
    let controller: ReadableStreamDefaultController
    const close = (): void => {
      if (closed) return
      closed = true
      controller.close()
      resolveExit(137)
    }
    const stream = new ReadableStream({
      start(value) {
        controller = value
        if (options?.signal?.aborted === true) close()
        else options?.signal?.addEventListener("abort", close, { once: true })
      },
    })
    return stream
  }
  return {
    stdin: null,
    stdout: make(),
    stderr: make(),
    pid: 1,
    isPty: false,
    exitCode,
    output: async () => ({
      stdout: new ArrayBuffer(0),
      stderr: new ArrayBuffer(0),
      exitCode: await exitCode,
    }),
    kill: () => undefined,
    resize: () => undefined,
  }
}

class FakeContainer implements ContainerLike {
  running = false
  images: Record<string, string> = { workspace: "image:workspace" }
  starts: ContainerStartupOptions[] = []
  inactivity: number[] = []
  destroyed = 0
  info: ContainerInfo | null = { image: "image:workspace", labels: {} }
  startError: Error | undefined
  startErrors: Error[] = []
  execImpl: (cmd: string[], options?: ContainerExecOptions) => Promise<ExecProcess> = async () =>
    processResult()
  snapshots = 0
  snapshotError: Error | undefined

  start(options: ContainerStartupOptions): void {
    if (this.startError !== undefined) {
      const error = this.startError
      this.startError = undefined
      throw error
    }
    const queued = this.startErrors.shift()
    if (queued !== undefined) throw queued
    if (this.running) throw new Error("already running")
    this.starts.push(options)
    this.running = true
  }

  exec(cmd: string[], options?: ContainerExecOptions): Promise<ExecProcess> {
    return this.execImpl(cmd, options)
  }

  async setInactivityTimeout(durationMs: number | bigint): Promise<void> {
    this.inactivity.push(Number(durationMs))
  }

  async snapshotContainer(): Promise<ContainerSnapshot> {
    if (this.snapshotError !== undefined) throw this.snapshotError
    this.snapshots += 1
    return { id: "snap-1", size: 42 }
  }

  async destroy(): Promise<void> {
    this.running = false
    this.destroyed += 1
  }

  async inspect(): Promise<ContainerInfo | null> {
    return this.info
  }
}

function fileError(code: string, operation: string, path: string): Error {
  const error = new Error(`${operation} ${path} failed`)
  Object.assign(error, { name: "SandboxFileError", code, operation, path, detail: "failed" })
  return error
}

class FakeFiles implements FilesLike {
  files = new Map<string, string>()
  directories = new Set<string>(["/workspace"])
  mkdirCalls: string[] = []

  async readFile(path: string): Promise<Response> {
    const content = this.files.get(path)
    if (content === undefined) throw fileError("ENOENT", "readFile", path)
    return new Response(content)
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async stat(path: string): Promise<{ type: string; size: bigint }> {
    if (this.directories.has(path)) return { type: "directory", size: 0n }
    const content = this.files.get(path)
    if (content === undefined) throw fileError("ENOENT", "stat", path)
    return { type: "file", size: BigInt(new TextEncoder().encode(content).byteLength) }
  }

  async readDirectory(path: string): Promise<{ name: string; type: string }[]> {
    if (!this.directories.has(path)) throw fileError("ENOENT", "readDirectory", path)
    const names = new Map<string, string>()
    for (const key of this.files.keys()) {
      if (!key.startsWith(`${path}/`)) continue
      const name = key.slice(path.length + 1).split("/")[0] as string
      names.set(name, "file")
    }
    for (const directory of this.directories) {
      if (directory === path || !directory.startsWith(`${path}/`)) continue
      const name = directory.slice(path.length + 1)
      if (!name.includes("/")) names.set(name, "directory")
    }
    return [...names].map(([name, type]) => ({ name, type }))
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path)
    const parts = path.split("/").filter(Boolean)
    let current = ""
    for (const part of parts) {
      current += `/${part}`
      this.directories.add(current)
    }
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }
}

class FakeStore implements SnapshotStore {
  values = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<unknown> {
    this.values.set(key, value)
    return undefined
  }

  async delete(key: string): Promise<unknown> {
    return this.values.delete(key)
  }
}

function setup(overrides: Partial<CloudflareSandboxOptions> = {}) {
  const container = new FakeContainer()
  const files = new FakeFiles()
  const storage = new FakeStore()
  const sandbox = new CloudflareSandbox({ container, storage, files, ...overrides })
  return { container, files, storage, sandbox }
}

describe("CloudflareSandbox construction and lifecycle", () => {
  it("requires a container binding", () => {
    expect(() => new CloudflareSandbox({ container: undefined, storage: new FakeStore() })).toThrow(
      /container binding/,
    )
  })

  it("constructs the default Files helper", async () => {
    const sandbox = new CloudflareSandbox({ container: new FakeContainer(), storage: new FakeStore() })
    expect(await sandbox.read("/workspace/a")).toMatchObject({ content: "", totalLines: 0 })
  })

  it("parses instance names", () => {
    for (const name of ["lite", "standard-1", "standard-2", "standard-3", "standard-4"] as const) {
      expect(parseInstance(name)).toBe(name)
    }
    expect(parseInstance(undefined)).toBe("standard-1")
    expect(parseInstance("nope")).toBe("standard-1")
  })

  it("starts with the configured image, instance and internet setting", async () => {
    const { container, sandbox } = setup({ instance: "lite", internet: false, inactivityMs: 1_000 })
    container.execImpl = async () => processResult("hi\n")
    expect(await sandbox.exec("echo hi")).toMatchObject({ exitCode: 0, stdout: "hi\n" })
    expect(container.starts).toEqual([
      {
        image: "image:workspace",
        instance: "lite",
        enableInternet: false,
      },
    ])
    expect(container.inactivity).toEqual([1_000])
  })

  it("clamps inactivity timeouts", async () => {
    for (const value of [0, -1, Number.NaN, 99_999_999]) {
      const { container, sandbox } = setup({ inactivityMs: value })
      await sandbox.exec("true")
      expect(container.inactivity[0]).toBe(value === 99_999_999 ? 21_600_000 : 600_000)
    }
  })

  it("uses the explicit image fallback", async () => {
    const { container, sandbox } = setup({ image: "fallback:image" })
    container.images = {}
    await sandbox.exec("true")
    expect(container.starts[0]).toMatchObject({ image: "fallback:image" })
  })

  it("reports a missing image", async () => {
    const { container, sandbox } = setup()
    container.images = {}
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "image_missing", status: 500 })
  })

  it("restores a stored snapshot", async () => {
    const { container, storage, sandbox } = setup()
    await storage.put("sandbox.snapshotId", "snap-9")
    await sandbox.exec("true")
    expect(container.starts[0]).toMatchObject({ containerSnapshot: { id: "snap-9" } })
    expect(container.starts[0]).not.toHaveProperty("image")
  })

  it("falls back to the image when a snapshot cannot start", async () => {
    const { container, storage, sandbox } = setup()
    await storage.put("sandbox.snapshotId", "snap-9")
    container.startError = new Error("Snapshot snap-9 was not found")
    await sandbox.exec("true")
    expect(container.starts[0]).toMatchObject({ image: "image:workspace" })
    expect(storage.values.has("sandbox.snapshotId")).toBe(false)
  })

  it("maps a snapshot start failure when no image is available", async () => {
    const { container, storage, sandbox } = setup()
    container.images = {}
    await storage.put("sandbox.snapshotId", "snap-9")
    container.startError = new Error("Snapshot snap-9 was not found")
    await expect(sandbox.exec("true")).rejects.toMatchObject({ status: 500 })
  })

  it("does not clear a snapshot for an unrelated start failure", async () => {
    const { container, storage, sandbox } = setup()
    await storage.put("sandbox.snapshotId", "snap-9")
    container.startErrors = [new Error("invalid instance")]
    await expect(sandbox.exec("true")).rejects.toMatchObject({ status: 500 })
    expect(storage.values.get("sandbox.snapshotId")).toBe("snap-9")
  })

  it("maps a second start failure after falling back", async () => {
    const { container, storage, sandbox } = setup()
    await storage.put("sandbox.snapshotId", "snap-9")
    container.startErrors = [new Error("Snapshot snap-9 was not found"), new Error("second failure")]
    await expect(sandbox.exec("true")).rejects.toMatchObject({ status: 500 })
  })

  it("does not restart a running container", async () => {
    const { container, sandbox } = setup()
    await sandbox.exec("true")
    await sandbox.exec("true")
    expect(container.starts).toHaveLength(1)
  })

  it("reports status from inspect", async () => {
    const { container, storage, sandbox } = setup()
    expect(await sandbox.status()).toEqual({
      backend: "cloudflare",
      running: false,
      image: "image:workspace",
      snapshotId: null,
    })
    await storage.put("sandbox.snapshotId", "snap-2")
    container.info = null
    expect(await sandbox.status()).toEqual({
      backend: "cloudflare",
      running: false,
      image: null,
      snapshotId: "snap-2",
    })
  })

  it("treats an inspect failure as no image", async () => {
    const { container, sandbox } = setup()
    container.inspect = async () => {
      throw new Error("boom")
    }
    expect((await sandbox.status()).image).toBeNull()
  })

  it("caches the snapshot id", async () => {
    const { storage, sandbox } = setup()
    await storage.put("sandbox.snapshotId", "snap-3")
    expect((await sandbox.status()).snapshotId).toBe("snap-3")
    await storage.delete("sandbox.snapshotId")
    expect((await sandbox.status()).snapshotId).toBe("snap-3")
  })

  it("reports whether the container is running", async () => {
    const { sandbox } = setup()
    expect(sandbox.running).toBe(false)
    await sandbox.exec("true")
    expect(sandbox.running).toBe(true)
  })

  it("re-arms the inactivity timeout", async () => {
    const { container, sandbox } = setup({ inactivityMs: 1_234 })
    await sandbox.ensureInactivityTimeout()
    expect(container.inactivity).toEqual([1_234])
  })

  it("saves and resets the workspace", async () => {
    const { container, storage, sandbox } = setup()
    await expect(sandbox.save()).resolves.toEqual({ id: "snap-1", size: 42 })
    expect(container.snapshots).toBe(1)
    expect(storage.values.get("sandbox.snapshotId")).toBe("snap-1")

    await sandbox.reset()
    expect(container.destroyed).toBe(1)
    expect(storage.values.has("sandbox.snapshotId")).toBe(false)
    expect((await sandbox.status()).snapshotId).toBeNull()
  })

  it("resets without destroying a stopped container", async () => {
    const { container, sandbox } = setup()
    await sandbox.reset()
    expect(container.destroyed).toBe(0)
  })

  it("maps a snapshot failure", async () => {
    const { container, sandbox } = setup()
    container.snapshotError = new Error("snapshot failed")
    await expect(sandbox.save()).rejects.toMatchObject({ code: "sandbox_error", status: 500 })
  })
})

describe("CloudflareSandbox files", () => {
  it("writes, reads and pages files", async () => {
    const { files, sandbox } = setup()
    await expect(sandbox.write("/workspace/src/a.ts", "one\ntwo\nthree\n")).resolves.toEqual({
      path: "/workspace/src/a.ts",
      bytes: 14,
    })
    expect(files.mkdirCalls).toContain("/workspace/src")
    expect(await sandbox.read("/workspace/src/a.ts")).toEqual({
      path: "/workspace/src/a.ts",
      content: "one\ntwo\nthree",
      totalLines: 3,
      truncated: false,
    })
    expect(await sandbox.read("/workspace/src/a.ts", { offset: 2, limit: 1 })).toMatchObject({
      content: "two",
      truncated: true,
    })
  })

  it("rejects invalid content and paths", async () => {
    const { sandbox } = setup()
    await expect(sandbox.write("/workspace/a", 42 as unknown as string)).rejects.toMatchObject({
      code: "invalid_input",
    })
    await expect(sandbox.write("/etc/passwd", "x")).rejects.toMatchObject({ code: "path_escape" })
    await expect(sandbox.read("/etc/passwd")).rejects.toMatchObject({ code: "path_escape" })
  })

  it("reads an empty body", async () => {
    const { sandbox } = setup({
      files: Object.assign(new FakeFiles(), {
        readFile: async () => new Response(null),
      }),
    })
    expect(await sandbox.read("/workspace/a")).toMatchObject({ content: "", totalLines: 0 })
  })

  it("rejects binary and oversized files", async () => {
    const { files, sandbox } = setup()
    files.files.set("/workspace/bin", "a\0b")
    await expect(sandbox.read("/workspace/bin")).rejects.toMatchObject({ code: "binary_file" })

    files.files.set("/workspace/big", "x".repeat(1_000_001))
    await expect(sandbox.read("/workspace/big")).rejects.toMatchObject({ code: "too_large", status: 413 })
  })

  it("maps a missing file", async () => {
    const { sandbox } = setup()
    await expect(sandbox.read("/workspace/missing")).rejects.toMatchObject({ code: "not_found", status: 404 })
  })

  it("maps a stream failure while reading", async () => {
    const failing = setup({
      files: Object.assign(new FakeFiles(), {
        readFile: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("stream failed"))
              },
            }),
          ),
      }),
    })
    await expect(failing.sandbox.read("/workspace/a")).rejects.toMatchObject({
      code: "sandbox_error",
      status: 500,
    })
  })

  it("maps a write failure", async () => {
    const failing = setup({
      files: Object.assign(new FakeFiles(), {
        writeFile: async () => {
          throw new Error("write failed")
        },
      }),
    })
    await expect(failing.sandbox.write("/workspace/a", "x")).rejects.toMatchObject({
      code: "sandbox_error",
      status: 500,
    })
  })

  it("maps permission and generic file errors", async () => {
    const denied = setup({
      files: Object.assign(new FakeFiles(), {
        readFile: async () => {
          throw fileError("EACCES", "readFile", "/workspace/a")
        },
      }),
    })
    await expect(denied.sandbox.read("/workspace/a")).rejects.toMatchObject({ code: "file_error", status: 403 })

    const invalid = setup({
      files: Object.assign(new FakeFiles(), {
        readFile: async () => {
          throw fileError("EISDIR", "readFile", "/workspace/a")
        },
      }),
    })
    await expect(invalid.sandbox.read("/workspace/a")).rejects.toMatchObject({ code: "file_error", status: 400 })
  })

  it("writes to the workspace root without creating a directory", async () => {
    const { files, sandbox } = setup()
    await sandbox.write("/workspace", "x")
    expect(files.mkdirCalls).toEqual([])
    expect(files.files.get("/workspace")).toBe("x")
  })

  it("reads a file without a trailing newline", async () => {
    const { files, sandbox } = setup()
    files.files.set("/workspace/a", "one\ntwo")
    expect(await sandbox.read("/workspace/a")).toMatchObject({ content: "one\ntwo", totalLines: 2 })
  })

  it("edits with exact strings and replaceAll", async () => {
    const { files, sandbox } = setup()
    files.files.set("/workspace/a", "one two")
    await expect(sandbox.edit("/workspace/a", "one", "three")).resolves.toEqual({
      path: "/workspace/a",
      replacements: 1,
    })
    expect(files.files.get("/workspace/a")).toBe("three two")
    await expect(sandbox.edit("/workspace/a", "two", "four", true)).resolves.toEqual({
      path: "/workspace/a",
      replacements: 1,
    })
    files.files.set("/workspace/a", "x x")
    await expect(sandbox.edit("/workspace/a", "x", "y", true)).resolves.toEqual({
      path: "/workspace/a",
      replacements: 2,
    })
  })

  it("rejects invalid edits", async () => {
    const { files, sandbox } = setup()
    await expect(sandbox.edit("/workspace/a", "", "b")).rejects.toMatchObject({ code: "invalid_input" })
    files.files.set("/workspace/a", "one")
    await expect(sandbox.edit("/workspace/a", "missing", "b")).rejects.toMatchObject({ code: "not_found" })
    files.files.set("/workspace/a", "x x")
    await expect(sandbox.edit("/workspace/a", "x", "y")).rejects.toMatchObject({ code: "ambiguous_edit" })
  })

  it("passes signals through file operations", async () => {
    const { sandbox } = setup()
    const signal = new AbortController().signal
    await sandbox.write("/workspace/src/a", "x", signal)
    expect(await sandbox.read("/workspace/src/a", {}, signal)).toMatchObject({ content: "x" })
    expect(await sandbox.list("/workspace/src", signal)).toMatchObject({ path: "/workspace/src" })
  })

  it("lists directories with sizes and types", async () => {
    const { files, sandbox } = setup()
    files.files.set("/workspace/b.txt", "abc")
    files.files.set("/workspace/a.txt", "z")
    await files.mkdir("/workspace/src")
    const result = await sandbox.list("/workspace")
    expect(result).toEqual({
      path: "/workspace",
      entries: [
        { name: "src", type: "dir", size: 0 },
        { name: "a.txt", type: "file", size: 1 },
        { name: "b.txt", type: "file", size: 3 },
      ],
    })
  })

  it("sorts a directory before a file", async () => {
    const files = new FakeFiles()
    files.files.set("/workspace/a", "x")
    const sandbox = new CloudflareSandbox({
      container: new FakeContainer(),
      storage: new FakeStore(),
      files: Object.assign(files, {
        readDirectory: async () => [
          { name: "a", type: "file" },
          { name: "src", type: "directory" },
        ],
      }),
    })
    expect((await sandbox.list("/workspace")).entries.map((entry) => entry.name)).toEqual(["src", "a"])
  })

  it("maps a missing directory", async () => {
    const { sandbox } = setup()
    await expect(sandbox.list("/workspace/missing")).rejects.toMatchObject({ code: "not_found" })
  })

  it("uses zero for a stat failure", async () => {
    const files = new FakeFiles()
    files.files.set("/workspace/a", "x")
    const sandbox = new CloudflareSandbox({
      container: new FakeContainer(),
      storage: new FakeStore(),
      files: Object.assign(files, {
        readDirectory: async () => [{ name: "a", type: "file" }],
        stat: async () => {
          throw fileError("EACCES", "stat", "/workspace/a")
        },
      }),
    })
    expect(await sandbox.list("/workspace")).toMatchObject({
      entries: [{ name: "a", type: "file", size: 0 }],
    })
  })

  it("maps unknown entry types to files", async () => {
    const files = new FakeFiles()
    const sandbox = new CloudflareSandbox({
      container: new FakeContainer(),
      storage: new FakeStore(),
      files: Object.assign(files, {
        readDirectory: async () => [
          { name: "a", type: "symlink" },
          { name: "b", type: "blockDevice" },
        ],
      }),
    })
    expect((await sandbox.list("/workspace")).entries.map((entry) => entry.type)).toEqual([
      "symlink",
      "file",
    ])
  })
})

describe("CloudflareSandbox patch, glob and grep", () => {
  it("applies a patch and removes the temporary file", async () => {
    const { container, files, sandbox } = setup()
    container.execImpl = async (cmd) => processResult(cmd[5]?.includes("-p1") === true ? "ok\n" : "")
    await expect(sandbox.patch("diff")).resolves.toEqual({ output: "ok" })
    expect([...files.files.keys()].some((path) => path.startsWith("/tmp/"))).toBe(false)
  })

  it("applies an empty patch with a signal and the default output", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => processResult("")
    await expect(sandbox.patch("diff", new AbortController().signal)).resolves.toEqual({
      output: "patch applied",
    })
  })

  it("uses stdout when stderr is empty", async () => {
    const { container, sandbox } = setup()
    let calls = 0
    container.execImpl = async () => {
      calls += 1
      return calls === 1 ? processResult("p1 out", "", 1) : processResult("applied")
    }
    await expect(sandbox.patch("diff")).resolves.toEqual({ output: "applied" })
  })

  it("ignores a temporary-file removal failure", async () => {
    const files = Object.assign(new FakeFiles(), {
      remove: async () => {
        throw new Error("remove failed")
      },
    })
    const container = new FakeContainer()
    container.execImpl = async () => processResult("ok")
    const sandbox = new CloudflareSandbox({ container, storage: new FakeStore(), files })
    await expect(sandbox.patch("diff")).resolves.toEqual({ output: "ok" })
  })

  it("falls back to -p0 and reports a failure", async () => {
    const { container, sandbox } = setup()
    let calls = 0
    container.execImpl = async () => {
      calls += 1
      return calls === 1 ? processResult("", "p1 failed", 1) : processResult("applied")
    }
    await expect(sandbox.patch("diff")).resolves.toEqual({ output: "applied" })

    calls = 0
    container.execImpl = async () => {
      calls += 1
      return processResult("", "nope", 1)
    }
    await expect(sandbox.patch("diff")).rejects.toMatchObject({ code: "patch_failed", status: 409 })
  })

  it("rejects an empty patch", async () => {
    const { sandbox } = setup()
    await expect(sandbox.patch("  ")).rejects.toMatchObject({ code: "invalid_input" })
  })

  it("globs files and truncates", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => processResult("b.ts\nsrc/a.ts\n")
    expect(await sandbox.glob("**/*.ts")).toEqual({
      paths: ["/workspace/b.ts", "/workspace/src/a.ts"],
      truncated: false,
    })

    container.execImpl = async () =>
      processResult(`${Array.from({ length: 1_001 }, (_, index) => `f${index}.ts`).join("\n")}\n`)
    const truncated = await sandbox.glob("*.ts")
    expect(truncated.paths).toHaveLength(1_000)
    expect(truncated.truncated).toBe(true)
  })

  it("handles absolute glob output and a cwd", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => processResult("/workspace/a.ts\n")
    expect((await sandbox.glob("*.ts")).paths).toEqual(["/workspace/a.ts"])
    expect((await sandbox.glob("*.ts", undefined, new AbortController().signal)).paths).toEqual([
      "/workspace/a.ts",
    ])
    container.execImpl = async () => processResult("b.ts\n")
    expect((await sandbox.glob("*.ts", "/workspace/src")).paths).toEqual(["/workspace/src/b.ts"])
  })

  it("rejects an empty glob pattern", async () => {
    const { sandbox } = setup()
    await expect(sandbox.glob("")).rejects.toMatchObject({ code: "invalid_input" })
  })

  it("greps and truncates", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => processResult("/workspace/a.ts:2:hello\n/workspace/b.ts:3:world\n")
    expect(await sandbox.grep("hello", { limit: 1 })).toEqual({
      matches: [{ path: "/workspace/a.ts", line: 2, text: "hello" }],
      truncated: true,
    })
  })

  it("passes grep flags and ignores malformed lines", async () => {
    const { container, sandbox } = setup()
    let command = ""
    container.execImpl = async (cmd) => {
      command = cmd[5] as string
      return processResult("not a match\n/workspace/a.ts:1:x\n")
    }
    const result = await sandbox.grep("x", { ignoreCase: true, glob: "*.ts", limit: 5 })
    expect(command).toContain("-i")
    expect(command).toContain("--glob '*.ts'")
    expect(result.matches).toEqual([{ path: "/workspace/a.ts", line: 1, text: "x" }])
  })

  it("rejects an empty grep pattern", async () => {
    const { sandbox } = setup()
    await expect(sandbox.grep(" ")).rejects.toMatchObject({ code: "invalid_input" })
  })

  it("uses grep defaults and passes a signal", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => processResult("/workspace/a:1:x\n")
    expect((await sandbox.grep("x", {}, new AbortController().signal)).matches).toHaveLength(1)
  })
})

describe("CloudflareSandbox exec", () => {
  it("captures stdout, stderr and the exit code", async () => {
    const { container, sandbox } = setup()
    let seen: ContainerExecOptions | undefined
    container.execImpl = async (_cmd, options) => {
      seen = options
      return processResult("hi\n", "bad\n", 7)
    }
    const result = await sandbox.exec("echo hi", { cwd: "/workspace/src", timeoutMs: 5_000 })
    expect(result).toMatchObject({ exitCode: 7, stdout: "hi\n", stderr: "bad", truncated: false })
    expect(seen?.cwd).toBe("/workspace/src")
  })

  it("rejects an empty command", async () => {
    const { sandbox } = setup()
    await expect(sandbox.exec("  ")).rejects.toMatchObject({ code: "invalid_input" })
  })

  it("times out", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async (_cmd, options) => pendingProcess(options)
    const result = await sandbox.exec("sleep 10", { timeoutMs: 1_000 })
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain("timed out")
  })

  it("aborts", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async (_cmd, options) => pendingProcess(options)
    const controller = new AbortController()
    const pending = sandbox.exec("sleep 10", { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    const result = await pending
    expect(result.exitCode).toBe(130)
    expect(result.stderr).toContain("aborted")
  })

  it("returns 130 when the signal is already aborted", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async (_cmd, options) => pendingProcess(options)
    const controller = new AbortController()
    controller.abort()
    const result = await sandbox.exec("sleep 10", { signal: controller.signal })
    expect(result.exitCode).toBe(130)
  })

  it("handles missing streams and truncated output", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => ({
      ...processResult(),
      stdout: null,
      stderr: null,
    })
    expect(await sandbox.exec("true")).toMatchObject({ stdout: "", stderr: "", truncated: false })

    container.execImpl = async () => processResult("x".repeat(30_000))
    expect((await sandbox.exec("true")).truncated).toBe(true)
  })

  it("maps execution errors", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => {
      throw new Error("boom")
    }
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "sandbox_error", status: 500 })
  })

  it("maps a non-Error failure", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => {
      throw "boom"
    }
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "sandbox_error", status: 500 })
  })

  it("maps protocol errors", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => {
      const error = new Error("bad protocol")
      Object.assign(error, { name: "SandboxProtocolError", code: "SANDBOX_PROTOCOL_ERROR", detail: "bad" })
      throw error
    }
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "protocol_error" })
  })

  it("recovers from a snapshot failure on the first operation", async () => {
    const { container, storage, sandbox } = setup()
    await storage.put("sandbox.snapshotId", "snap-1")
    let calls = 0
    container.execImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error('Snapshot "snap-1" was not found')
      return processResult("recovered\n")
    }
    expect((await sandbox.exec("true")).stdout).toBe("recovered\n")
    expect(container.destroyed).toBe(1)
    expect(storage.values.has("sandbox.snapshotId")).toBe(false)
  })

  it("does not retry unrelated failures", async () => {
    const { container, sandbox } = setup()
    let calls = 0
    container.execImpl = async () => {
      calls += 1
      throw new Error("ordinary failure")
    }
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "sandbox_error" })
    expect(calls).toBe(1)
  })

  it("reports the timeout command's own 124 exit", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => processResult("", "", 124)
    const result = await sandbox.exec("true")
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain("timed out")
  })

  it("maps a timeout that rejects before returning a process", async () => {
    const { container, sandbox } = setup()
    container.execImpl = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100))
      throw new Error("late")
    }
    expect((await sandbox.exec("true", { timeoutMs: 1_000 })).exitCode).toBe(124)
  })

  it("maps an abort that rejects before returning a process", async () => {
    const { container, sandbox } = setup()
    const controller = new AbortController()
    container.execImpl = async () => {
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(), { once: true })
      })
      throw new Error("aborted")
    }
    const pending = sandbox.exec("true", { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    expect((await pending).exitCode).toBe(130)
  })

  it("continues after a failed operation", async () => {
    const { container, sandbox } = setup()
    let calls = 0
    container.execImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error("boom")
      return processResult("ok\n")
    }
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "sandbox_error" })
    expect((await sandbox.exec("true")).stdout).toBe("ok\n")
  })

  it("recovers without destroying a stopped container", async () => {
    const { container, storage, sandbox } = setup()
    await storage.put("sandbox.snapshotId", "snap-1")
    let calls = 0
    container.execImpl = async () => {
      calls += 1
      if (calls === 1) {
        container.running = false
        throw new Error('Snapshot "snap-1" was not found')
      }
      return processResult("ok\n")
    }
    expect((await sandbox.exec("true")).stdout).toBe("ok\n")
    expect(container.destroyed).toBe(0)
  })
})

const SSH_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nkey-data\n-----END OPENSSH PRIVATE KEY-----"

describe("CloudflareSandbox SSH identity", () => {
  it("installs the key, known hosts and config before the first command", async () => {
    const container = new FakeContainer()
    const files = new FakeFiles()
    const commands: string[] = []
    container.execImpl = async (cmd) => {
      commands.push(cmd.join(" "))
      return processResult()
    }
    const sandbox = new CloudflareSandbox({
      container,
      storage: new FakeStore(),
      files,
      sshPrivateKey: SSH_KEY,
      sshKnownHosts: "github.com ssh-ed25519 AAAA",
    })

    await sandbox.exec("true")

    expect(files.files.get("/root/.ssh/id_ed25519")).toBe(`${SSH_KEY}\n`)
    expect(files.files.get("/root/.ssh/known_hosts")).toBe("github.com ssh-ed25519 AAAA\n")
    expect(files.files.get("/root/.ssh/config")).toContain("StrictHostKeyChecking accept-new")
    expect(commands[0]).toContain("mkdir -p /root/.ssh")
    expect(commands[1]).toContain("chmod 700 /root/.ssh")
    expect(commands[2]).toContain("bash -lc true")
  })

  it("installs only once until the container is reset", async () => {
    const container = new FakeContainer()
    const files = new FakeFiles()
    const commands: string[] = []
    container.execImpl = async (cmd) => {
      commands.push(cmd.join(" "))
      return processResult()
    }
    const sandbox = new CloudflareSandbox({
      container,
      storage: new FakeStore(),
      files,
      sshPrivateKey: SSH_KEY,
    })

    await sandbox.exec("true")
    await sandbox.exec("true")
    expect(commands.filter((command) => command.includes("mkdir -p /root/.ssh"))).toHaveLength(1)

    files.files.delete("/root/.ssh/id_ed25519")
    await sandbox.reset()
    await sandbox.exec("true")
    expect(files.files.get("/root/.ssh/id_ed25519")).toBe(`${SSH_KEY}\n`)
    expect(commands.filter((command) => command.includes("mkdir -p /root/.ssh"))).toHaveLength(2)
  })

  it("installs known hosts without a key", async () => {
    const container = new FakeContainer()
    const files = new FakeFiles()
    const sandbox = new CloudflareSandbox({
      container,
      storage: new FakeStore(),
      files,
      sshKnownHosts: "github.com ssh-ed25519 AAAA",
    })
    await sandbox.exec("true")
    expect(files.files.has("/root/.ssh/id_ed25519")).toBe(false)
    expect(files.files.get("/root/.ssh/known_hosts")).toBe("github.com ssh-ed25519 AAAA\n")
    expect(files.files.get("/root/.ssh/config")).toContain("StrictHostKeyChecking")
  })

  it("leaves the sandbox alone when no SSH material is configured", async () => {
    const { container, files, sandbox } = setup()
    const commands: string[] = []
    container.execImpl = async (cmd) => {
      commands.push(cmd.join(" "))
      return processResult()
    }
    await sandbox.exec("true")
    expect(files.files.size).toBe(0)
    expect(commands.some((command) => command.includes("/root/.ssh"))).toBe(false)
  })

  it("rejects a malformed private key", async () => {
    const { sandbox } = setup({ sshPrivateKey: "not a key" })
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "ssh_key_invalid" })
  })

  it("reports a failed permission change", async () => {
    const container = new FakeContainer()
    container.execImpl = async (cmd) =>
      cmd.join(" ").includes("chmod 700") ? processResult("", "bad", 1) : processResult()
    const sandbox = new CloudflareSandbox({
      container,
      storage: new FakeStore(),
      files: new FakeFiles(),
      sshPrivateKey: SSH_KEY,
    })
    await expect(sandbox.exec("true")).rejects.toMatchObject({ code: "ssh_key_install" })
  })
})
