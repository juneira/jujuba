import { describe, expect, it, vi } from "vitest"
import type { Sandbox } from "../../src/sandbox/backend.js"
import {
  formatExec,
  formatGlob,
  formatGrep,
  formatList,
  formatRead,
  sandboxToolDefinitions,
  sandboxTools,
} from "../../src/plugins/tools.js"

const signal = new AbortController().signal

function fakeClient() {
  return {
    read: vi.fn(async () => ({ path: "/workspace/a", content: "one\ntwo", totalLines: 2, truncated: false })),
    write: vi.fn(async () => ({ path: "/workspace/a", bytes: 1 })),
    edit: vi.fn(async () => ({ path: "/workspace/a", replacements: 2 })),
    patch: vi.fn(async () => ({ output: "applied" })),
    glob: vi.fn(async () => ({ paths: ["/workspace/a"], truncated: false })),
    grep: vi.fn(async () => ({
      matches: [{ path: "/workspace/a", line: 1, text: "one" }],
      truncated: false,
    })),
    list: vi.fn(async () => ({
      path: "/workspace",
      entries: [{ name: "a", type: "file" as const, size: 3 }],
    })),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: "hi\n", stderr: "", truncated: false, durationMs: 1 })),
  }
}

function tools() {
  const client = fakeClient()
  const definitions = sandboxToolDefinitions(client as unknown as Sandbox)
  return { client, definitions, get: (name: string) => definitions.find((tool) => tool.name === name)! }
}

describe("formatters", () => {
  it("formats reads", () => {
    expect(formatRead({ path: "/workspace/a", content: "x\ny", totalLines: 2, truncated: false })).toBe(
      "/workspace/a (lines 1-2 of 2)\n     1| x\n     2| y",
    )
    expect(formatRead({ path: "/workspace/a", content: "", totalLines: 0, truncated: false })).toBe(
      "/workspace/a (lines 1-1 of 0)\n",
    )
    expect(formatRead({ path: "/workspace/a", content: "x", totalLines: 10, truncated: true }, 5)).toContain(
      "[truncated",
    )
  })

  it("formats globs", () => {
    expect(formatGlob({ paths: ["a", "b"], truncated: false })).toBe("a\nb")
    expect(formatGlob({ paths: [], truncated: false })).toBe("No files matched.")
    expect(formatGlob({ paths: ["a"], truncated: true })).toContain("[truncated]")
  })

  it("formats grep results", () => {
    expect(formatGrep({ matches: [{ path: "/workspace/a", line: 2, text: "x" }], truncated: false })).toBe(
      "/workspace/a:2: x",
    )
    expect(formatGrep({ matches: [], truncated: false })).toBe("No matches.")
    expect(
      formatGrep({ matches: [{ path: "/workspace/a", line: 1, text: "x" }], truncated: true }),
    ).toContain("[truncated]")
  })

  it("formats lists", () => {
    expect(
      formatList({
        path: "/workspace",
        entries: [
          { name: "dir", type: "dir", size: 0 },
          { name: "file", type: "file", size: 3 },
          { name: "link", type: "symlink", size: 1 },
        ],
      }),
    ).toBe("dir/\nfile (3 bytes)\nlink@")
    expect(formatList({ path: "/workspace", entries: [] })).toBe("/workspace is empty.")
  })

  it("formats exec output", () => {
    expect(formatExec({ exitCode: 0, stdout: "hi\n", stderr: "", truncated: false, durationMs: 0 })).toBe(
      "exit: 0\nhi",
    )
    expect(
      formatExec({ exitCode: 1, stdout: "", stderr: "bad\n", truncated: false, durationMs: 0 }),
    ).toBe("exit: 1\nstderr:\nbad")
    expect(
      formatExec({ exitCode: 0, stdout: "x", stderr: "", truncated: true, durationMs: 0 }),
    ).toContain("[output truncated]")
  })
})

describe("sandboxToolDefinitions", () => {
  it("reads with and without paging", async () => {
    const { client, get } = tools()
    expect(await get("read").run({ path: "/workspace/a" }, signal)).toContain("one")
    expect(client.read).toHaveBeenCalledWith("/workspace/a", {}, signal)
    await get("read").run({ path: "/workspace/a", offset: 2, limit: 3 }, signal)
    expect(client.read).toHaveBeenLastCalledWith("/workspace/a", { offset: 2, limit: 3 }, signal)
  })

  it("writes, edits, patches, globs, greps, lists and runs shell", async () => {
    const { client, get } = tools()

    expect(await get("write").run({ path: "/workspace/a", content: "x" }, signal)).toBe(
      "Wrote 1 bytes to /workspace/a",
    )
    expect(await get("edit").run({ path: "/workspace/a", oldString: "a", newString: "b" }, signal)).toBe(
      "Replaced 2 occurrences in /workspace/a",
    )
    expect(await get("patch").run({ patch: "diff" }, signal)).toBe("applied")
    expect(await get("glob").run({ pattern: "**/*.ts" }, signal)).toBe("/workspace/a")
    expect(await get("glob").run({ pattern: "**/*.ts", cwd: "/workspace/src" }, signal)).toBe("/workspace/a")
    expect(await get("grep").run({ pattern: "one" }, signal)).toBe("/workspace/a:1: one")
    expect(
      await get("grep").run(
        { pattern: "one", path: "/workspace", glob: "*.ts", ignoreCase: true, limit: 2 },
        signal,
      ),
    ).toBe("/workspace/a:1: one")
    expect(await get("list").run({}, signal)).toBe("a (3 bytes)")
    expect(await get("list").run({ path: "/workspace" }, signal)).toBe("a (3 bytes)")
    expect(await get("shell").run({ command: "echo hi" }, signal)).toBe("exit: 0\nhi")
    expect(await get("shell").run({ command: "echo hi", cwd: "/workspace", timeoutMs: 10 }, signal)).toBe(
      "exit: 0\nhi",
    )

    expect(client.glob).toHaveBeenLastCalledWith("**/*.ts", "/workspace/src", signal)
    expect(client.grep).toHaveBeenLastCalledWith(
      "one",
      { path: "/workspace", glob: "*.ts", ignoreCase: true, limit: 2 },
      signal,
    )
    expect(client.exec).toHaveBeenLastCalledWith("echo hi", {
      cwd: "/workspace",
      timeoutMs: 10,
      signal,
    })
    expect(client.write).toHaveBeenCalledWith("/workspace/a", "x", signal)
    expect(client.edit).toHaveBeenCalledWith("/workspace/a", "a", "b", false, signal)
  })

  it("validates tool input", async () => {
    const { get } = tools()
    await expect(get("read").run({}, signal)).rejects.toThrow(/path must be a string/)
    await expect(get("read").run({ path: "a", offset: "x" }, signal)).rejects.toThrow(/offset must be a number/)
    await expect(get("write").run({ path: "a" }, signal)).rejects.toThrow(/content must be a string/)
    await expect(get("edit").run({ path: "a", oldString: "x" }, signal)).rejects.toThrow(
      /newString must be a string/,
    )
  })

  it("registers the tools and removes the local ones", async () => {
    const client = fakeClient()
    const editor = { remove: vi.fn(), add: vi.fn(), list: vi.fn(), get: vi.fn(), namespace: vi.fn(), update: vi.fn() }
    const plugin = sandboxTools(client as unknown as Sandbox)
    await plugin.setup({ tool: { transform: (callback: (value: unknown) => void) => callback(editor) } } as never)

    expect(editor.remove).toHaveBeenCalledTimes(8)
    expect(editor.add).toHaveBeenCalledTimes(8)

    const write = editor.add.mock.calls.find((call) => call[0].name === "write")![0]
    expect(write.options).toEqual({ codemode: false })
    await expect(
      write.execute({ path: "/workspace/a", content: "x" }, { signal }),
    ).resolves.toEqual({ content: "Wrote 1 bytes to /workspace/a" })
    await expect(write.execute(null, { signal })).rejects.toThrow(/object/)
  })
})

describe("tool pluralization", () => {
  it("uses the singular for one replacement", async () => {
    const client = fakeClient()
    client.edit.mockResolvedValue({ path: "/workspace/a", replacements: 1 })
    const def = sandboxToolDefinitions(client as unknown as Sandbox).find((tool) => tool.name === "edit")!
    expect(await def.run({ path: "/workspace/a", oldString: "a", newString: "b" }, signal)).toBe(
      "Replaced 1 occurrence in /workspace/a",
    )
  })
})
