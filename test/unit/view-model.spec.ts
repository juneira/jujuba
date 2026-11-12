import { describe, expect, it } from "vitest"
import { transcriptText } from "../../src/tui/transcript.js"
import {
  headerDetails,
  initialState,
  reduce,
  statusLine,
  type TuiState,
} from "../../src/tui/view-model.js"

const base: TuiState = { status: "idle", entries: [] }

describe("initialState", () => {
  it("starts connecting", () => {
    expect(initialState()).toEqual({ status: "connecting", entries: [] })
  })
})

describe("reduce basics", () => {
  it("sets status, user input, error and clear", () => {
    expect(reduce(base, { type: "status", status: "busy" }).status).toBe("busy")
    expect(reduce(base, { type: "user", text: "hi" })).toMatchObject({
      status: "busy",
      entries: [{ kind: "user", text: "hi" }],
    })
    expect(reduce(base, { type: "error", message: "boom" })).toMatchObject({
      status: "error",
      error: "boom",
      entries: [{ kind: "error", text: "boom" }],
    })
    expect(reduce({ ...base, entries: [{ id: "1", kind: "user", text: "x" }] }, { type: "clear" }).entries).toEqual([])
  })

  it("switches sessions", () => {
    const previous: TuiState = {
      status: "error",
      error: "boom",
      session: "ses_old",
      entries: [{ id: "1", kind: "user", text: "x" }],
    }
    expect(reduce(previous, { type: "session", session: "ses_new" })).toEqual({
      status: "connecting",
      session: "ses_new",
      entries: [],
    })
    expect(reduce(previous, { type: "session" })).toEqual({ status: "connecting", entries: [] })
  })

  it("tracks and clears the current project", () => {
    const inProject = reduce(base, { type: "session", session: "ses_root", project: "demo" })
    expect(inProject).toEqual({ status: "connecting", entries: [], session: "ses_root", project: "demo" })
    expect(reduce(inProject, { type: "session", session: "ses_other" })).toEqual({
      status: "connecting",
      entries: [],
      session: "ses_other",
    })
  })

  it("drops the session title when switching sessions but keeps the model", () => {
    const state: TuiState = {
      ...base,
      session: "ses_a",
      title: "Old",
      provider: "openrouter",
      model: "deepseek/deepseek-v4.1-flash-1017",
    }
    const next = reduce(state, { type: "session", session: "ses_b" })
    expect(next.title).toBeUndefined()
    expect(next).toMatchObject({ session: "ses_b", provider: "openrouter", model: "deepseek/deepseek-v4.1-flash-1017" })
  })
})

describe("snapshots", () => {
  it("rebuilds the transcript", () => {
    const state = reduce(base, {
      type: "snapshot",
      snapshot: {
        session: "ses_root",
        busy: true,
        messages: [
          { id: "u1", type: "user", text: "hello" },
          { id: "a1", type: "assistant", content: [{ type: "reasoning", text: "hmm" }] },
          { id: "a2", type: "assistant", content: [{ type: "text", text: "world" }] },
          { id: "a3", type: "idle" },
          {
            id: "a4",
            type: "assistant",
            content: [
              {
                type: "tool",
                id: "t1",
                name: "shell",
                state: { status: "completed", input: { command: "ls" }, content: [{ type: "text", text: "ok" }] },
              },
              { type: "tool", id: "t2", name: "read", state: { status: "error", error: { message: "nope" } } },
              { type: "tool", id: "t3", name: "list", state: { status: "running" } },
              { type: "tool", name: "nameless", state: { status: "completed", content: [] } },
            ],
          },
          { type: "assistant", content: [{ type: "text", text: "no id" }] },
        ],
      },
    })

    expect(state.session).toBe("ses_root")
    expect(state.status).toBe("busy")
    expect(state.entries.map((entry) => [entry.kind, entry.text])).toEqual([
      ["user", "hello"],
      ["assistant", "world"],
      ["tool", "shell\nok"],
      ["error", "read\nnope"],
      ["tool", "list\nrunning"],
      ["tool", "nameless\ncompleted"],
      ["assistant", "no id"],
    ])
    expect(state.entries[2]?.tool).toMatchObject({
      name: "shell",
      summary: "ls",
      status: "done",
      output: "ok",
    })
  })

  it("defaults to idle when the snapshot is not busy", () => {
    expect(reduce(base, { type: "snapshot", snapshot: { messages: [] } })).toMatchObject({ status: "idle" })
  })

  it("keeps the session name, provider and model from the snapshot", () => {
    const state = reduce(base, {
      type: "snapshot",
      snapshot: {
        session: "ses_root",
        title: "Deploy notes",
        provider: "openrouter",
        model: "deepseek/deepseek-v4.1-flash-1017",
        messages: [],
      },
    })
    expect(state).toMatchObject({
      session: "ses_root",
      title: "Deploy notes",
      provider: "openrouter",
      model: "deepseek/deepseek-v4.1-flash-1017",
    })

    // A later snapshot without metadata keeps what is already known.
    expect(reduce(state, { type: "snapshot", snapshot: { messages: [] } })).toMatchObject({
      title: "Deploy notes",
      provider: "openrouter",
      model: "deepseek/deepseek-v4.1-flash-1017",
    })
  })

  it("handles snapshots without messages and transcript entries without optional fields", () => {
    expect(reduce(base, { type: "snapshot", snapshot: {} }).entries).toEqual([])

    const state = reduce(base, {
      type: "snapshot",
      snapshot: {
        messages: [
          { id: "u1", type: "user" },
          { id: "a1", type: "assistant" },
          { id: "a2", type: "assistant", content: [{ type: "text" }] },
          { id: "a3", type: "assistant", content: [{ type: "tool", id: "t1", state: { content: [{ type: "text" }] } }] },
          { id: "a4", type: "assistant", content: [{ type: "tool", id: "t2" }] },
        ],
      },
    })
    expect(state.entries.map((entry) => [entry.kind, entry.text])).toEqual([
      ["user", ""],
      ["assistant", ""],
      ["tool", "tool"],
      ["tool", "tool"],
    ])
  })
})

describe("events", () => {
  it("tracks runs", () => {
    expect(reduce(base, { type: "events", events: [{ type: "run_start" }] }).status).toBe("busy")
    expect(reduce({ ...base, error: "x" }, { type: "events", events: [{ type: "run_start" }] }).error).toBeUndefined()
    expect(reduce(base, { type: "events", events: [{ type: "run_end", outcome: "succeeded" }] })).toMatchObject({
      status: "idle",
    })
    expect(
      reduce(base, { type: "events", events: [{ type: "run_end", outcome: "failed", error: "bad" }] }),
    ).toMatchObject({ status: "error", error: "bad" })
    expect(reduce(base, { type: "events", events: [{ type: "run_end", outcome: "interrupted" }] })).toMatchObject({
      status: "error",
      error: "interrupted",
    })
  })

  it("appends and finalizes text", () => {
    const first = reduce(base, {
      type: "events",
      events: [{ type: "text_delta", messageId: "m", ordinal: 0, delta: "he" }],
    })
    const second = reduce(first, {
      type: "events",
      events: [{ type: "text_delta", messageId: "m", ordinal: 0, delta: "llo" }],
    })
    expect(second.entries).toEqual([{ id: "text:m:0", kind: "assistant", text: "hello" }])
    expect(
      reduce(second, {
        type: "events",
        events: [{ type: "text_end", messageId: "m", ordinal: 0, text: "hello!" }],
      }).entries,
    ).toEqual([{ id: "text:m:0", kind: "assistant", text: "hello!" }])
    expect(
      reduce(base, {
        type: "events",
        events: [{ type: "text_delta", messageId: "m", ordinal: 0, delta: 1 }],
      }).entries,
    ).toEqual([{ id: "text:m:0", kind: "assistant", text: "" }])
    expect(
      reduce(base, { type: "events", events: [{ type: "text_end", messageId: "m", ordinal: 1 }] }).entries,
    ).toEqual([{ id: "text:m:1", kind: "assistant", text: "" }])
  })

  it("tracks tool calls", () => {
    const started = reduce(base, {
      type: "events",
      events: [{ type: "tool_start", toolCallId: "c1", name: "shell", input: { command: "ls" } }],
    })
    expect(started.entries[0]).toMatchObject({
      kind: "tool",
      text: "shell",
      tool: { name: "shell", summary: "ls", status: "running", changes: [] },
    })
    expect(
      reduce(started, {
        type: "events",
        events: [{ type: "tool_end", toolCallId: "c1", name: "shell", output: "ok", error: false }],
      }).entries[0],
    ).toMatchObject({ kind: "tool", text: "shell\nok", tool: { status: "done", output: "ok" } })
    expect(
      reduce(base, {
        type: "events",
        events: [{ type: "tool_end", toolCallId: "c2", name: "read", output: "bad", error: true }],
      }).entries[0],
    ).toMatchObject({ kind: "error", text: "read\nbad", tool: { status: "error" } })
    expect(
      reduce(base, {
        type: "events",
        events: [{ type: "tool_start", toolCallId: "c3", name: "list" }],
      }).entries[0],
    ).toEqual({
      id: "tool:c3",
      kind: "tool",
      text: "list",
      tool: { name: "list", summary: "", status: "running", changes: [] },
    })
    expect(
      reduce(base, { type: "events", events: [{ type: "tool_end", toolCallId: "c4" }] }).entries[0],
    ).toEqual({
      id: "tool:c4",
      kind: "tool",
      text: "tool",
      tool: { name: "tool", summary: "", status: "done", changes: [] },
    })
    expect(
      reduce(base, { type: "events", events: [{ type: "tool_start", toolCallId: "c5" }] }).entries[0],
    ).toEqual({
      id: "tool:c5",
      kind: "tool",
      text: "tool",
      tool: { name: "tool", summary: "", status: "running", changes: [] },
    })
  })

  it("derives diffs for file tools and keeps them after the call ends", () => {
    const started = reduce(base, {
      type: "events",
      events: [
        {
          type: "tool_start",
          toolCallId: "c1",
          name: "edit",
          input: { path: "/workspace/a.ts", oldString: "one\ntwo", newString: "one\nthree" },
        },
      ],
    })
    expect(started.entries[0]?.tool?.changes[0]).toMatchObject({
      path: "/workspace/a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
    })
    const ended = reduce(started, {
      type: "events",
      events: [{ type: "tool_end", toolCallId: "c1", name: "edit", output: "Replaced 1 occurrence", error: false }],
    })
    expect(ended.entries[0]?.tool).toMatchObject({ status: "done", output: "Replaced 1 occurrence" })
    expect(ended.entries[0]?.tool?.changes[0]?.additions).toBe(1)
  })

  it("reports failed operations, faults and permissions", () => {
    expect(
      reduce(base, {
        type: "events",
        events: [{ type: "operation_end", result: { status: "done" } }],
      }),
    ).toBe(base)
    expect(
      reduce(base, {
        type: "events",
        events: [{ type: "operation_end", result: { status: "unanswered", reason: "interrupted" } }],
      }),
    ).toMatchObject({ error: "interrupted", entries: [{ kind: "error", text: "interrupted" }] })
    expect(
      reduce(base, {
        type: "events",
        events: [{ type: "operation_end", result: { status: "unanswered" } }],
      }),
    ).toMatchObject({ error: "operation did not finish" })
    expect(
      reduce(base, { type: "events", events: [{ type: "fault", message: "bad" }] }),
    ).toMatchObject({ status: "error", error: "bad" })
    expect(reduce(base, { type: "events", events: [{ type: "fault" }] })).toMatchObject({
      error: "agent fault",
    })
    expect(
      reduce(base, {
        type: "events",
        events: [{ type: "permission_asked", permission: { action: "edit", resources: ["a"] } }],
      }).entries[0],
    ).toMatchObject({ kind: "info", text: 'permission: edit ["a"]' })
    expect(reduce(base, { type: "events", events: [{ type: "permission_asked" }] }).entries[0]).toMatchObject({
      text: "permission: action []",
    })
  })

  it("resets the transcript and ignores unknown events", () => {
    const withEntry: TuiState = { ...base, entries: [{ id: "1", kind: "user", text: "x" }] }
    expect(reduce(withEntry, { type: "events", events: [{ type: "transcript_reset" }] }).entries).toEqual([])
    expect(reduce(base, { type: "events", events: [{ type: "unknown" }] })).toBe(base)
    expect(reduce(base, { type: "events", events: [] })).toBe(base)
  })
})

describe("shell actions", () => {
  it("adds a running shell entry", () => {
    const state = reduce(base, { type: "shell-start", id: "shell:1", command: "ls -la" })
    expect(state.entries).toEqual([
      {
        id: "shell:1",
        kind: "shell",
        text: "ls -la",
        shell: { command: "ls -la", status: "running" },
      },
    ])
    expect(state.status).toBe("idle")
  })

  it("updates a shell entry with its result", () => {
    const started = reduce(base, { type: "shell-start", id: "shell:1", command: "ls -la" })
    const state = reduce(started, {
      type: "shell-end",
      id: "shell:1",
      result: { exitCode: 0, stdout: "hi\n", stderr: "", truncated: false, durationMs: 1 },
    })
    expect(state.entries).toEqual([
      {
        id: "shell:1",
        kind: "shell",
        text: "ls -la\nexit: 0\nhi",
        shell: { command: "ls -la", status: "done", output: "exit: 0\nhi" },
      },
    ])
  })

  it("marks a failed shell command as an error", () => {
    const started = reduce(base, { type: "shell-start", id: "shell:1", command: "ls" })
    const state = reduce(started, {
      type: "shell-end",
      id: "shell:1",
      result: { exitCode: 1, stdout: "", stderr: "boom\n", truncated: false, durationMs: 1 },
    })
    expect(state.entries[0]).toMatchObject({
      kind: "shell",
      shell: { command: "ls", status: "error", output: "exit: 1\nstderr:\nboom" },
    })
  })

  it("records a shell error", () => {
    const started = reduce(base, { type: "shell-start", id: "shell:1", command: "ls" })
    const state = reduce(started, { type: "shell-error", id: "shell:1", message: "boom" })
    expect(state.entries[0]).toMatchObject({
      kind: "shell",
      shell: { command: "ls", status: "error", output: "boom" },
    })
  })

  it("creates a shell entry for an unknown id", () => {
    const state = reduce(base, {
      type: "shell-end",
      id: "shell:9",
      result: { exitCode: 0, stdout: "", stderr: "", truncated: false, durationMs: 0 },
    })
    expect(state.entries[0]).toMatchObject({ id: "shell:9", kind: "shell", shell: { status: "done" } })
  })
})

describe("rendering helpers", () => {
  it("prefixes transcript entries and indents continuation lines", () => {
    const state: TuiState = {
      status: "busy",
      session: "ses_root",
      error: "bad",
      entries: [
        { id: "1", kind: "user", text: "ask\ntwo" },
        { id: "2", kind: "assistant", text: "answer" },
        { id: "3", kind: "tool", text: "shell\nout" },
        { id: "4", kind: "error", text: "oops" },
      ],
    }
    expect(transcriptText(state)).toEqual(["> ask", "  two", "answer", "  shell", "  out", "! oops"])
    expect(statusLine(state)).toBe("working  bad")
    expect(statusLine({ status: "idle", entries: [] })).toBe("idle")
  })

  it("shows the project, session, provider and model in the header", () => {
    expect(headerDetails({ status: "idle", entries: [] })).toEqual(["root"])
    expect(
      headerDetails({
        status: "idle",
        entries: [],
        project: "demo",
        session: "ses_root",
        provider: "openrouter",
        model: "deepseek/deepseek-v4.1-flash-1017",
      }),
    ).toEqual(["demo", "ses_root", "openrouter", "deepseek/deepseek-v4.1-flash-1017"])
  })

  it("prefers the session title over its id", () => {
    expect(headerDetails({ status: "idle", entries: [], session: "ses_root", title: "Deploy notes" })).toEqual([
      "root",
      "Deploy notes",
    ])
  })
})
