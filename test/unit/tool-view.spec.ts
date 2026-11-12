import { describe, expect, it } from "vitest"
import { lineDiff, toolChanges, toolSummary } from "../../src/tui/tool-view.js"

describe("toolSummary", () => {
  it("previews shell commands on one line", () => {
    expect(toolSummary("shell", { command: "bun test --watch" })).toBe("bun test --watch")
    expect(toolSummary("shell", { command: "one\ntwo" })).toBe("one")
    const long = "x".repeat(120)
    expect(toolSummary("shell", { command: long })).toHaveLength(80)
    expect(toolSummary("shell", { command: long }).endsWith("…")).toBe(true)
    expect(toolSummary("shell", {})).toBe("")
    expect(toolSummary("shell", { command: 1 })).toBe("")
    expect(toolSummary("shell", undefined)).toBe("")
  })

  it("previews file paths and search patterns", () => {
    expect(toolSummary("read", { path: "/workspace/a.ts" })).toBe("/workspace/a.ts")
    expect(toolSummary("write", { path: "/workspace/b.ts" })).toBe("/workspace/b.ts")
    expect(toolSummary("edit", { path: "/workspace/c.ts" })).toBe("/workspace/c.ts")
    expect(toolSummary("list", {})).toBe("")
    expect(toolSummary("glob", { pattern: "**/*.ts" })).toBe("**/*.ts")
    expect(toolSummary("grep", { pattern: "TODO" })).toBe("TODO")
    expect(toolSummary("glob", {})).toBe("")
    expect(toolSummary("grep", {})).toBe("")
  })

  it("counts patch files", () => {
    const patch = "diff --git a/a b/a\ndiff --git a/b b/b\n"
    expect(toolSummary("patch", { patch })).toBe("2 files")
    expect(toolSummary("patch", { patch: "--- a/a\n--- a/b\n" })).toBe("2 files")
    expect(toolSummary("patch", { patch: "--- a/a\n" })).toBe("1 file")
    expect(toolSummary("patch", { patch: "not a diff" })).toBe("unified diff")
    expect(toolSummary("patch", {})).toBe("")
  })

  it("falls back to the first string argument", () => {
    expect(toolSummary("custom", { query: "find me", count: 2 })).toBe("find me")
    expect(toolSummary("custom", { count: 2 })).toBe("")
    expect(toolSummary("custom", "plain text")).toBe("plain text")
    expect(toolSummary("custom", 42)).toBe("")
    expect(toolSummary("custom", undefined)).toBe("")
  })
})

describe("lineDiff", () => {
  it("keeps common lines as context", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "context", text: " a" },
      { kind: "del", text: "-b" },
      { kind: "add", text: "+x" },
      { kind: "context", text: " c" },
    ])
  })

  it("walks the LCS when the middle still shares lines", () => {
    expect(lineDiff("A\nB\nC\nD", "A\nX\nC\nY\nD").map((line) => line.kind)).toEqual([
      "context",
      "del",
      "add",
      "context",
      "add",
      "context",
    ])
  })

  it("drains unequal tails after the LCS walk", () => {
    expect(lineDiff("X\nA", "Y\nA\nB").map((line) => line.text)).toEqual(["-X", "+Y", " A", "+B"])
    expect(lineDiff("X\nA\nB", "Y\nA").map((line) => line.text)).toEqual(["-X", "+Y", " A", "-B"])
  })

  it("handles empty and identical blocks", () => {
    expect(lineDiff("", "")).toEqual([])
    expect(lineDiff("", "one\ntwo")).toEqual([
      { kind: "add", text: "+one" },
      { kind: "add", text: "+two" },
    ])
    expect(lineDiff("one\ntwo", "")).toEqual([
      { kind: "del", text: "-one" },
      { kind: "del", text: "-two" },
    ])
    expect(lineDiff("same", "same")).toEqual([{ kind: "context", text: " same" }])
  })

  it("ignores one trailing newline", () => {
    expect(lineDiff("a\n", "b\n")).toEqual([
      { kind: "del", text: "-a" },
      { kind: "add", text: "+b" },
    ])
  })

  it("falls back to a block replacement above the LCS cell cap", () => {
    const before = Array.from({ length: 600 }, (_, index) => `old-${index}`).join("\n")
    const after = Array.from({ length: 600 }, (_, index) => `new-${index}`).join("\n")
    const diff = lineDiff(before, after)
    expect(diff).toHaveLength(1200)
    expect(diff.filter((line) => line.kind === "del")).toHaveLength(600)
    expect(diff.filter((line) => line.kind === "add")).toHaveLength(600)
  })
})

describe("tool changes", () => {
  it("treats a write as added lines", () => {
    const [change] = toolChanges("write", { path: "a.txt", content: "one\ntwo\n" })
    expect(change).toEqual({
      path: "a.txt",
      status: "added",
      lines: [
        { kind: "hunk", text: "@@ -0,0 +1,2 @@" },
        { kind: "add", text: "+one" },
        { kind: "add", text: "+two" },
      ],
      additions: 2,
      deletions: 0,
      elided: 0,
    })
  })

  it("handles empty writes and missing arguments", () => {
    expect(toolChanges("write", { content: "x" })).toEqual([])
    expect(toolChanges("write", { path: "/p" })).toEqual([])
    const [change] = toolChanges("write", { path: "/p", content: "" })
    expect(change).toEqual({
      path: "/p",
      status: "added",
      lines: [{ kind: "hunk", text: "@@ -0,0 +1,0 @@" }],
      additions: 0,
      deletions: 0,
      elided: 0,
    })
  })

  it("diffs edits and truncates long diffs", () => {
    const [change] = toolChanges("edit", { path: "/p", oldString: "a", newString: "b" })
    expect(change).toMatchObject({ path: "/p", status: "modified", additions: 1, deletions: 1 })
    expect(toolChanges("edit", { path: "/p", oldString: "a" })).toEqual([])
    const [big] = toolChanges("edit", {
      path: "/p",
      oldString: Array.from({ length: 500 }, (_, index) => `old${index}`).join("\n"),
      newString: Array.from({ length: 500 }, (_, index) => `new${index}`).join("\n"),
    })
    expect(big?.lines).toHaveLength(400)
    expect(big?.additions).toBe(500)
    expect(big?.deletions).toBe(500)
    expect(big?.elided).toBe(600)
  })

  it("parses modified, added and deleted patch files", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts\t2020-01-01",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " same",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1 @@",
      "+hello",
      "--- a/old.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\r\n")
    const changes = toolChanges("patch", { patch })
    expect(changes).toHaveLength(3)
    expect(changes[0]).toMatchObject({ path: "src/a.ts", status: "modified", additions: 1, deletions: 1 })
    expect(changes[0]?.lines[0]).toEqual({ kind: "hunk", text: "@@ -1,2 +1,2 @@" })
    expect(changes[1]).toMatchObject({ path: "new.txt", status: "added", additions: 1, deletions: 0 })
    expect(changes[2]).toMatchObject({ path: "old.txt", status: "deleted", additions: 0, deletions: 1 })
  })

  it("does not mistake hunk content for a file header", () => {
    const patch = ["--- a/x", "+++ b/x", "@@ -1 +1 @@", "--- old comment", "+++ new comment"].join("\n")
    const [change] = toolChanges("patch", { patch })
    expect(change).toMatchObject({ path: "x", status: "modified", additions: 1, deletions: 1 })
    expect(change?.lines.map((line) => line.text)).toEqual([
      "@@ -1 +1 @@",
      "--- old comment",
      "+++ new comment",
    ])
  })

  it("falls back to a plain patch change and skips empty input", () => {
    expect(toolChanges("patch", {})).toEqual([])
    expect(toolChanges("patch", { patch: "" })).toEqual([])
    expect(toolChanges("patch", { patch: "+++ /dev/null" })).toEqual([])
    const [change] = toolChanges("patch", { patch: "@@ -1 +1 @@\n-a\n+b\nnot a diff\n" })
    expect(change).toMatchObject({ path: "patch", status: "modified", additions: 1, deletions: 1 })
    expect(change?.lines).toHaveLength(3)

    const [withContext] = toolChanges("patch", { patch: "@@ -1,2 +1,2 @@\n keep\n-a\n+b\n" })
    expect(withContext?.lines.map((line) => line.kind)).toEqual(["hunk", "context", "del", "add"])

    const [hint] = toolChanges("patch", { patch: "diff --git weird\n" })
    expect(hint).toMatchObject({ path: "weird", additions: 0, deletions: 0 })
  })

  it("accepts an empty context line inside a hunk", () => {
    const patch = ["--- a/x", "+++ b/x", "@@ -1,3 +1,3 @@", " keep", "", "-a", "+b"].join("\n")
    const [change] = toolChanges("patch", { patch })
    expect(change?.lines.map((line) => line.kind)).toEqual(["hunk", "context", "context", "del", "add"])
  })

  it("skips the no-newline marker", () => {
    const patch = ["--- a/x", "+++ b/x", "@@ -1,2 +1,2 @@", "-a", "+b", "\\ No newline at end of file"].join("\n")
    const [change] = toolChanges("patch", { patch })
    expect(change?.lines.map((line) => line.kind)).toEqual(["hunk", "del", "add"])
  })

  it("ignores tools without file changes", () => {
    expect(toolChanges("shell", { command: "rm a" })).toEqual([])
    expect(toolChanges("read", { path: "a" })).toEqual([])
  })
})
