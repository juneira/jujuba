import { describe, expect, it } from "vitest"
import { transcriptText, viewLines, viewLineText } from "../../src/tui/transcript.js"
import type { ToolChange, ToolView } from "../../src/tui/tool-view.js"
import type { TuiState } from "../../src/tui/view-model.js"

function stateWith(...entries: TuiState["entries"]): TuiState {
  return { status: "idle", entries }
}

function change(overrides: Partial<ToolChange> = {}): ToolChange {
  return {
    path: "/workspace/a.ts",
    status: "modified",
    lines: [
      { kind: "hunk", text: "@@ -1,2 +1,2 @@" },
      { kind: "del", text: "-old" },
      { kind: "add", text: "+new" },
      { kind: "context", text: " same" },
    ],
    additions: 1,
    deletions: 1,
    elided: 0,
    ...overrides,
  }
}

function tool(overrides: Partial<ToolView> = {}): ToolView {
  return { name: "edit", summary: "/workspace/a.ts", status: "done", changes: [change()], ...overrides }
}

describe("plain entries", () => {
  it("styles user, assistant, info and error lines", () => {
    const state = stateWith(
      { id: "1", kind: "user", text: "ask\ntwo" },
      { id: "2", kind: "assistant", text: "answer\nmore" },
      { id: "3", kind: "info", text: "permission" },
      { id: "4", kind: "error", text: "boom\nbad" },
    )
    expect(transcriptText(state)).toEqual(["> ask", "  two", "answer", "more", "· permission", "! boom", "  bad"])
    expect(viewLines(state)[0]?.segments).toEqual([
      { text: "> ", style: "user" },
      { text: "ask", style: "user" },
    ])
    expect(viewLines(state)[2]?.segments).toEqual([{ text: "answer", style: "assistant" }])
  })

  it("renders assistant text as markdown", () => {
    const state = stateWith({ id: "1", kind: "assistant", text: "## Title\n**bold** and `code`" })
    expect(transcriptText(state)).toEqual(["Title", "bold and code"])
    expect(viewLines(state)[1]?.segments).toEqual([
      { text: "bold", style: "strong" },
      { text: " and ", style: "assistant" },
      { text: "code", style: "inline-code" },
    ])
  })

  it("leaves user, info and error text unparsed", () => {
    const state = stateWith(
      { id: "1", kind: "user", text: "**raw**" },
      { id: "2", kind: "info", text: "`raw`" },
      { id: "3", kind: "error", text: "# raw" },
    )
    expect(transcriptText(state)).toEqual(["> **raw**", "· `raw`", "! # raw"])
  })

  it("strips terminal escapes from assistant text", () => {
    const state = stateWith({ id: "1", kind: "assistant", text: "\u001B[1m**bold**\u001B[0m" })
    expect(transcriptText(state)).toEqual(["bold"])
  })
})

describe("terminal escapes", () => {
  it("strips escapes from tool output", () => {
    const state = stateWith({
      id: "1",
      kind: "tool",
      text: "shell",
      tool: {
        name: "shell",
        summary: "bun test",
        status: "done",
        changes: [],
        output: "\u001B[32mok\u001B[0m\n\u001B[31mfail\u001B[0m",
      },
    })
    expect(transcriptText(state)).toEqual(["▌ shell  bun test  ✔", "  ok", "  fail"])
  })

  it("strips escapes from tool text without a tool view", () => {
    const state = stateWith({ id: "1", kind: "tool", text: "\u001B[32mshell\u001B[0m" })
    expect(transcriptText(state)).toEqual(["  shell"])
  })
})

describe("tool entries", () => {
  it("renders a tool call with its diff", () => {
    const entry = { kind: "assistant" as const, id: "1", text: "ignored", tool: tool() }
    const state = stateWith(entry)
    expect(transcriptText(state)).toEqual([
      "▌ edit  /workspace/a.ts  +1 −1  ✔",
      "  ┌ modified /workspace/a.ts",
      "  │ @@ -1,2 +1,2 @@",
      "  │ -old",
      "  │ +new",
      "  │  same",
      "  └",
    ])
    const header = viewLines(state)[0]
    expect(header?.segments[0]).toEqual({ text: "▌ ", style: "tool-name" })
    expect(header?.segments[1]).toEqual({ text: "edit", style: "tool-name" })
    expect(header?.segments[2]).toEqual({ text: "  ", style: "tool-args" })
    const diffLine = viewLines(state)[3]
    expect(diffLine?.segments).toEqual([
      { text: "  │ ", style: "tool-meta" },
      { text: "-old", style: "diff-removed" },
    ])
  })

  it("marks running and failed calls", () => {
    const running = stateWith({
      id: "1",
      kind: "tool",
      text: "shell",
      tool: { name: "shell", summary: "bun test", status: "running", changes: [] },
    })
    expect(viewLineText(viewLines(running)[0]!)).toBe("▌ shell  bun test  ○")

    const failed = stateWith({
      id: "2",
      kind: "error",
      text: "shell",
      tool: { name: "shell", summary: "bun test", status: "error", changes: [], output: "boom" },
    })
    expect(viewLineText(viewLines(failed)[0]!)).toBe("▌ shell  bun test  ✖")
    expect(viewLines(failed)[0]?.segments[0]).toEqual({ text: "▌ ", style: "error" })
    expect(transcriptText(failed)).toEqual(["▌ shell  bun test  ✖", "  boom"])
  })

  it("hides diff lines above the display cap", () => {
    const lines = Array.from({ length: 31 }, (_, index) => ({ kind: "add" as const, text: `+${index}` }))
    for (const elided of [0, 2]) {
      const state = stateWith({
        id: "1",
        kind: "tool",
        text: "write",
        tool: tool({ name: "write", summary: "/p", changes: [change({ lines, additions: 31, deletions: 0, elided })] }),
      })
      const text = transcriptText(state)
      expect(text.some((line) => line.startsWith(`  │ … ${elided + 1} more line`))).toBe(true)
      expect(text.filter((line) => line.startsWith("  │ +"))).toHaveLength(30)
    }
  })

  it("previews output at the head, except for shell", () => {
    const body = Array.from({ length: 17 }, (_, index) => `line ${index}`).join("\n")
    const read = stateWith({
      id: "1",
      kind: "tool",
      text: "read",
      tool: { name: "read", summary: "/p", status: "done", changes: [], output: body },
    })
    const readLines = transcriptText(read)
    expect(readLines).toHaveLength(17)
    expect(readLines[1]).toBe("  line 0")
    expect(readLines.at(-1)).toBe("  … 2 more lines")

    const shell = stateWith({
      id: "2",
      kind: "tool",
      text: "shell",
      tool: { name: "shell", summary: "run", status: "done", changes: [], output: body },
    })
    const shellLines = transcriptText(shell)
    expect(shellLines[1]).toBe("  … 2 more lines")
    expect(shellLines.at(-1)).toBe("  line 16")
  })

  it("handles one hidden line and no output", () => {
    const one = stateWith({
      id: "1",
      kind: "tool",
      text: "read",
      tool: {
        name: "read",
        summary: "/p",
        status: "running",
        changes: [],
        output: Array.from({ length: 16 }, () => "x").join("\n"),
      },
    })
    expect(transcriptText(one).at(-1)).toBe("  … 1 more line")
    expect(
      transcriptText(
        stateWith({
          id: "2",
          kind: "tool",
          text: "read",
          tool: { name: "read", summary: "/p", status: "running", changes: [] },
        }),
      ),
    ).toEqual(["▌ read  /p  ○"])
  })

  it("does not print the output of a file tool", () => {
    const state = stateWith({
      id: "1",
      kind: "tool",
      text: "write",
      tool: tool({ name: "write", output: "Wrote 4 bytes" }),
    })
    expect(transcriptText(state).some((line) => line.includes("Wrote"))).toBe(false)
  })

  it("falls back when an entry has no structured tool", () => {
    const state = stateWith({ id: "1", kind: "tool", text: "shell\nexit: 0" })
    expect(transcriptText(state)).toEqual(["  shell", "  exit: 0"])
    expect(viewLines(state)[0]?.segments[0]?.style).toBe("tool-name")
    expect(viewLines(state)[1]?.segments[0]?.style).toBe("output")
  })

  it("omits stats for a call without changes", () => {
    const state = stateWith({
      id: "1",
      kind: "tool",
      text: "read",
      tool: { name: "read", summary: "/p", status: "done", changes: [] },
    })
    expect(transcriptText(state)[0]).toBe("▌ read  /p  ✔")

    const bare = stateWith({
      id: "2",
      kind: "tool",
      text: "read",
      tool: { name: "read", summary: "", status: "done", changes: [] },
    })
    expect(transcriptText(bare)[0]).toBe("▌ read  ✔")
  })
})
