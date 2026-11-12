import { describe, expect, it } from "vitest"
import { COMMANDS, matchCommands, parseCommand, topLevelSessions } from "../../src/tui/commands.js"

describe("parseCommand", () => {
  it("recognizes slash commands", () => {
    expect(parseCommand("/new")).toEqual({ type: "new" })
    expect(parseCommand("/sessions")).toEqual({ type: "sessions" })
    expect(parseCommand("/projects")).toEqual({ type: "projects" })
    expect(parseCommand("/root")).toEqual({ type: "root" })
  })

  it("parses new project arguments", () => {
    expect(parseCommand("/new_project demo")).toEqual({ type: "new-project", name: "demo" })
    expect(parseCommand("/new_project demo https://example.com/repo.git")).toEqual({
      type: "new-project",
      name: "demo",
      remote: "https://example.com/repo.git",
    })
    expect(parseCommand("/new_project   demo   git@example.com:org/repo.git  ")).toEqual({
      type: "new-project",
      name: "demo",
      remote: "git@example.com:org/repo.git",
    })
  })

  it("reports usage for an incomplete or oversized new project", () => {
    const usage = "usage: /new_project <name> [git remote origin]"
    expect(parseCommand("/new_project")).toEqual({ type: "usage", message: usage, text: "/new_project" })
    expect(parseCommand("/new_project   ")).toEqual({ type: "usage", message: usage, text: "/new_project   " })
    expect(parseCommand("/new_project a b c")).toEqual({ type: "usage", message: usage, text: "/new_project a b c" })
  })

  it("never treats a leading slash as a prompt", () => {
    expect(parseCommand("/newer")).toEqual({ type: "unknown", text: "/newer" })
    expect(parseCommand("/new_projectx")).toEqual({ type: "unknown", text: "/new_projectx" })
    expect(parseCommand("/NEW")).toEqual({ type: "unknown", text: "/NEW" })
    expect(parseCommand("/")).toEqual({ type: "unknown", text: "/" })
    expect(parseCommand("/usr/bin")).toEqual({ type: "unknown", text: "/usr/bin" })
  })

  it("treats everything else as a prompt", () => {
    expect(parseCommand("hello")).toEqual({ type: "prompt", text: "hello" })
    expect(parseCommand("what is /new?")).toEqual({ type: "prompt", text: "what is /new?" })
  })
})

describe("matchCommands", () => {
  it("filters by prefix, ignoring case and surrounding spaces", () => {
    expect(matchCommands("/")).toEqual(COMMANDS)
    expect(matchCommands("  /se ")).toEqual([{ name: "/sessions", description: "List sessions and pick one" }])
    expect(matchCommands("/NEW")).toEqual([
      { name: "/new", description: "Create a session and switch to it" },
      { name: "/new_project", description: "Create a project and switch to it" },
    ])
    expect(matchCommands("/pro")).toEqual([{ name: "/projects", description: "List projects and pick one" }])
  })

  it("returns nothing for text that is not a command prefix", () => {
    expect(matchCommands("hello")).toEqual([])
    expect(matchCommands("/nope")).toEqual([])
  })
})

describe("topLevelSessions", () => {
  it("drops subagent sessions", () => {
    expect(
      topLevelSessions([
        { id: "ses_root", busy: false },
        { id: "ses_child", busy: true, parent: "ses_root" },
        { id: "ses_other", busy: false, title: "Other" },
      ]),
    ).toEqual([
      { id: "ses_root", busy: false },
      { id: "ses_other", busy: false, title: "Other" },
    ])
  })

  it("keeps scoped fields on the sessions it returns", () => {
    expect(topLevelSessions([{ id: "ses_root", busy: false, agent: "project-1", project: "demo" }])).toEqual([
      { id: "ses_root", busy: false, agent: "project-1", project: "demo" },
    ])
  })
})