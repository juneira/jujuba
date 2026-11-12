/// <reference path="../../node_modules/bun-types/test.d.ts" />
import { describe, expect, mock, test } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createTui, type ProjectChoice, type SessionChoice, type TuiOptions } from "../../src/tui/render.js"
import type { TuiState } from "../../src/tui/view-model.js"

const state: TuiState = {
  status: "busy",
  session: "ses_root",
  entries: [
    { id: "1", kind: "user", text: "write hello.txt" },
    { id: "2", kind: "assistant", text: "done" },
    { id: "3", kind: "tool", text: "shell\nexit: 0" },
  ],
}

function tuiOptions(renderer: CliRenderer, overrides: Partial<TuiOptions> = {}): TuiOptions {
  return {
    renderer,
    now: () => 0,
    onSubmit: () => {},
    onInput: () => {},
    onAbort: () => {},
    onPickSession: () => {},
    onPickProject: () => {},
    onPickCommand: () => {},
    ...overrides,
  }
}

describe("OpenTUI renderer", () => {
  test("renders the transcript, session and status", async () => {
    const setup = await createTestRenderer({ width: 70, height: 20 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render(state)
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("JUJUBA")
      expect(frame).toContain("write hello.txt")
      expect(frame).toContain("done")
      expect(frame).toContain("shell")
      expect(frame).toContain("working")
      expect(frame).toContain("ses_root")
    } finally {
      await setup.dispose()
    }
  })

  test("renders a shell command with its output", async () => {
    const setup = await createTestRenderer({ width: 70, height: 20 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render({
        status: "idle",
        entries: [
          {
            id: "shell:1",
            kind: "shell",
            text: "git status\nexit: 0\nOn branch main",
            shell: { command: "git status", status: "done", output: "exit: 0\nOn branch main" },
          },
        ],
      })
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("$ git status")
      expect(frame).toContain("On branch main")
    } finally {
      await setup.dispose()
    }
  })

  test("shows the project, session, provider and model in the header", async () => {
    const setup = await createTestRenderer({ width: 120, height: 20 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render({
        status: "idle",
        project: "demo",
        session: "ses_root",
        title: "Deploy notes",
        provider: "openrouter",
        model: "deepseek/deepseek-v4.1-flash-1017",
        entries: [],
      })
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("demo · Deploy notes · openrouter · deepseek/deepseek-v4.1-flash-1017")
      expect(frame).toContain("JUJUBA ✢")
    } finally {
      await setup.dispose()
    }
  })

  test("animates the brand and grows the gum ball", async () => {
    const setup = await createTestRenderer({ width: 90, height: 20 })
    try {
      let now = 0
      const tui = await createTui(tuiOptions(setup.renderer, { now: () => now }))
      const draw = async (): Promise<string> => {
        tui.render({ status: "idle", project: "demo", entries: [] })
        await setup.renderOnce()
        return setup.captureCharFrame()
      }

      let frame = await draw()
      expect(frame).toContain("JUJUBA ✢")
      expect(frame).toContain("demo")

      now = 600
      frame = await draw()
      expect(frame).toContain("JUJUBA ✳")

      now = 1800
      frame = await draw()
      expect(frame).toContain("JUJUBA ✻")
      expect(frame).not.toContain("✸")

      now = 2400
      frame = await draw()
      expect(frame).toContain("JUJUBA ✽")

      now = 3000
      frame = await draw()
      expect(frame).toContain("JUJUBA ✢")
      expect(frame).not.toContain("jujuba")
    } finally {
      await setup.dispose()
    }
  })

  test("truncates the identity line so the brand stays on the right", async () => {
    const setup = await createTestRenderer({ width: 50, height: 12 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render({
        status: "idle",
        project: "demo",
        session: "ses_root",
        provider: "openrouter",
        model: "deepseek/deepseek-v4.1-flash-1017",
        entries: [],
      })
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("… JUJUBA ✢")
    } finally {
      await setup.dispose()
    }
  })

  test("keeps the header and status visible with a long transcript", async () => {
    const setup = await createTestRenderer({ width: 100, height: 20 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      const entries = Array.from({ length: 120 }, (_, index) => ({
        id: String(index),
        kind: "assistant" as const,
        text: `line ${index}`,
      }))
      tui.render({
        status: "idle",
        project: "demo",
        session: "ses_root",
        provider: "openrouter",
        model: "deepseek/deepseek-v4.1-flash-1017",
        entries,
      })
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("demo · ses_root · openrouter · deepseek/deepseek-v4.1-flash-1017")
      expect(frame).toContain("JUJUBA ✢")
      expect(frame).toContain("idle")
      expect(frame).toContain("line 119")
    } finally {
      await setup.dispose()
    }
  })

  test("renders a tool call with a diff and highlighted header", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render({
        status: "busy",
        entries: [
          {
            id: "1",
            kind: "tool",
            text: "write",
            tool: {
              name: "write",
              summary: "/workspace/hello.ts",
              status: "done",
              changes: [
                {
                  path: "/workspace/hello.ts",
                  status: "added",
                  lines: [
                    { kind: "hunk", text: "@@ -0,0 +1,2 @@" },
                    { kind: "add", text: "+export const hello = true" },
                    { kind: "add", text: "+export const bye = false" },
                  ],
                  additions: 2,
                  deletions: 0,
                  elided: 0,
                },
              ],
            },
          },
        ],
      })
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("write")
      expect(frame).toContain("/workspace/hello.ts")
      expect(frame).toContain("+export const hello = true")
      expect(frame).toContain("+2 −0")
      expect(frame).toContain("added")
    } finally {
      await setup.dispose()
    }
  })

  test("renders assistant markdown with concealed markers", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render({
        status: "idle",
        entries: [
          {
            id: "1",
            kind: "assistant",
            text: "## Summary\n\n**bold** and *italic*\n\n- item\n\n```ts\nconst x = 1\n```",
          },
        ],
      })
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Summary")
      expect(frame).toContain("bold and italic")
      expect(frame).toContain("• item")
      expect(frame).toContain("const x = 1")
      expect(frame).not.toContain("**")
      expect(frame).not.toContain("##")
      expect(frame).not.toContain("```")
    } finally {
      await setup.dispose()
    }
  })

  test("renders markdown tables as boxes", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render({
        status: "idle",
        entries: [
          { id: "1", kind: "assistant", text: "| name | value |\n| --- | ---: |\n| a | 1 |" },
        ],
      })
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("┌──────┬───────┐")
      expect(frame).toContain("│ name │ value │")
      expect(frame).toContain("│ a    │     1 │")
      expect(frame).toContain("└──────┴───────┘")
      expect(frame).not.toContain("| ---")
    } finally {
      await setup.dispose()
    }
  })

  test("shows a placeholder when there are no messages", async () => {
    const setup = await createTestRenderer({ width: 60, height: 15 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.render({ status: "connecting", entries: [] })
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("No messages yet.")
    } finally {
      await setup.dispose()
    }
  })

  test("submits the input and clears it", async () => {
    const setup = await createTestRenderer({ width: 60, height: 15 })
    try {
      const onSubmit = mock((_text: string) => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onSubmit }))
      tui.render({ status: "idle", entries: [] })
      setup.mockInput.typeText("hello")
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onSubmit).toHaveBeenCalledWith("hello")
    } finally {
      await setup.dispose()
    }
  })

  test("ignores an empty submit and reports escape", async () => {
    const setup = await createTestRenderer({ width: 60, height: 15 })
    try {
      const onSubmit = mock((_text: string) => {})
      const onAbort = mock(() => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onSubmit, onAbort }))
      tui.render({ status: "idle", entries: [] })
      setup.mockInput.pressEnter()
      setup.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await setup.renderOnce()
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onAbort).toHaveBeenCalledTimes(1)
    } finally {
      await setup.dispose()
    }
  })

  test("shows sessions, moves the selection and picks one", async () => {
    const setup = await createTestRenderer({ width: 70, height: 20 })
    try {
      const onPickSession = mock((_session: SessionChoice) => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onPickSession }))
      tui.render({ status: "idle", entries: [] })
      const sessions: SessionChoice[] = [
        { id: "ses_root", busy: false },
        { id: "ses_work", busy: true, title: "Work" },
      ]
      tui.showSessions(sessions, "ses_root")
      // Showing again keeps the picker in place instead of adding a second one.
      tui.showSessions(sessions, "ses_root")
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Sessions")
      expect(frame).toContain("ses_root")
      expect(frame).toContain("Work")
      expect(frame).toContain("running")

      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onPickSession).toHaveBeenCalledWith({ id: "ses_work", busy: true, title: "Work" })
      tui.hideMenu()
    } finally {
      await setup.dispose()
    }
  })

  test("labels sessions with their project and routes the full choice", async () => {
    const setup = await createTestRenderer({ width: 80, height: 20 })
    try {
      const onPickSession = mock((_session: SessionChoice) => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onPickSession }))
      tui.render({ status: "idle", project: "demo", entries: [] })
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("JUJUBA ✢")
      expect(setup.captureCharFrame()).toContain("demo")

      tui.showSessions(
        [
          { id: "ses_root", busy: false, agent: "project-1", project: "demo" },
          { id: "ses_root", busy: true, agent: "project-2", project: "work" },
        ],
        "ses_root",
        "project-2",
      )
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("demo · ses_root")
      expect(frame).toContain("work · ses_root")

      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onPickSession).toHaveBeenCalledWith({
        id: "ses_root",
        busy: true,
        agent: "project-2",
        project: "work",
      })
    } finally {
      await setup.dispose()
    }
  })

  test("shows projects, keeps the current one selected and picks another", async () => {
    const setup = await createTestRenderer({ width: 80, height: 20 })
    try {
      const onPickProject = mock((_project: ProjectChoice) => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onPickProject }))
      tui.showProjects(
        [
          { name: "demo", agent: "project-1", remote: "https://token@example.com/demo.git" },
          { name: "work", agent: "project-2" },
        ],
        "demo",
      )
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Projects")
      expect(frame).toContain("demo")
      expect(frame).toContain("https://***@example.com/demo.git")
      expect(frame).toContain("no git remote")

      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onPickProject).toHaveBeenCalledWith({ name: "work", agent: "project-2" })
    } finally {
      await setup.dispose()
    }
  })

  test("escape closes the session picker instead of aborting", async () => {
    const setup = await createTestRenderer({ width: 60, height: 15 })
    try {
      const onAbort = mock(() => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onAbort }))
      tui.render({ status: "idle", entries: [] })
      tui.showSessions([{ id: "ses_root", busy: false }], "ses_missing")
      await setup.renderOnce()
      setup.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await setup.renderOnce()
      expect(onAbort).not.toHaveBeenCalled()
      expect(setup.captureCharFrame()).not.toContain("Sessions")
    } finally {
      await setup.dispose()
    }
  })

  test("reports typed text and shows a command hint without taking focus", async () => {
    const setup = await createTestRenderer({ width: 70, height: 20 })
    try {
      const onInput = mock((_value: string) => {})
      const onPickCommand = mock((_name: string) => {})
      const onSubmit = mock((_text: string) => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onInput, onPickCommand, onSubmit }))
      tui.render({ status: "idle", entries: [] })
      setup.mockInput.typeText("/se")
      tui.showCommandHint([{ name: "/sessions", description: "List sessions and pick one" }])
      await setup.renderOnce()
      expect(onInput).toHaveBeenLastCalledWith("/se")
      expect(setup.captureCharFrame()).toContain("/sessions")

      // Enter runs the hinted command instead of submitting the typed text.
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onPickCommand).toHaveBeenCalledWith("/sessions")
      expect(onSubmit).not.toHaveBeenCalled()

      tui.showCommandHint([{ name: "/new", description: "Create a new session and switch to it" }])
      tui.hideHint()
      await setup.renderOnce()
      expect(setup.captureCharFrame()).not.toContain("Commands")
    } finally {
      await setup.dispose()
    }
  })

  test("the first Enter runs the highlighted command and arrows move it", async () => {
    const setup = await createTestRenderer({ width: 70, height: 20 })
    try {
      const onInput = mock((_value: string) => {})
      const onPickCommand = mock((_name: string) => {})
      const onSubmit = mock((_text: string) => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onInput, onPickCommand, onSubmit }))
      const commands = [
        { name: "/new", description: "Create a new session and switch to it" },
        { name: "/sessions", description: "List sessions and pick one" },
      ]

      tui.showCommandHint(commands)
      await setup.renderOnce()
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onPickCommand).toHaveBeenLastCalledWith("/new")

      setup.mockInput.typeText("/")
      tui.showCommandHint(commands)
      await setup.renderOnce()
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onPickCommand).toHaveBeenLastCalledWith("/sessions")
      // The hint owns Enter: the input must not also submit the typed text.
      expect(onSubmit).not.toHaveBeenCalled()

      // Picking a command clears the input.
      setup.mockInput.typeText("x")
      expect(onInput).toHaveBeenLastCalledWith("x")
    } finally {
      await setup.dispose()
    }
  })

  test("a focused picker ignores hideHint", async () => {
    const setup = await createTestRenderer({ width: 60, height: 15 })
    try {
      const tui = await createTui(tuiOptions(setup.renderer))
      tui.showSessions([{ id: "ses_root", busy: false }])
      await setup.renderOnce()
      tui.hideHint()
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("Sessions")
    } finally {
      await setup.dispose()
    }
  })

  test("picks a command from the command menu", async () => {
    const setup = await createTestRenderer({ width: 70, height: 20 })
    try {
      const onPickCommand = mock((_name: string) => {})
      const tui = await createTui(tuiOptions(setup.renderer, { onPickCommand }))
      tui.showCommandMenu([
        { name: "/new", description: "Create a new session and switch to it" },
        { name: "/sessions", description: "List sessions and pick one" },
      ])
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Commands")
      expect(frame).toContain("/new")
      expect(frame).toContain("/sessions")

      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(onPickCommand).toHaveBeenCalledWith("/sessions")
    } finally {
      await setup.dispose()
    }
  })

  test("ignores menu calls after shutdown", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    const tui = await createTui(tuiOptions(setup.renderer))
    tui.destroy()
    expect(() => tui.showSessions([{ id: "ses_root", busy: false }])).not.toThrow()
    expect(() => tui.showProjects([{ name: "demo", agent: "project-1" }])).not.toThrow()
    expect(() => tui.showCommandHint([{ name: "/new", description: "New" }])).not.toThrow()
    expect(() => tui.showCommandMenu([{ name: "/new", description: "New" }])).not.toThrow()
    expect(() => tui.hideHint()).not.toThrow()
    expect(() => tui.hideMenu()).not.toThrow()
  })

  test("destroys the renderer", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    const tui = await createTui(tuiOptions(setup.renderer))
    expect(() => tui.destroy()).not.toThrow()
  })

  test("ignores renders and repeated destroys after shutdown", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    const tui = await createTui(tuiOptions(setup.renderer))
    tui.destroy()
    expect(() => tui.destroy()).not.toThrow()
    expect(() => tui.render(state)).not.toThrow()
  })

  test("ignores renders when OpenTUI destroys the renderer", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    const tui = await createTui(tuiOptions(setup.renderer))
    await setup.dispose()
    expect(() => tui.render(state)).not.toThrow()
  })
})
