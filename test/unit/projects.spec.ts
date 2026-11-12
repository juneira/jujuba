import { describe, expect, it } from "vitest"
import {
  commandFailure,
  gitCloneCommand,
  gitIdentityCommand,
  gitInitCommand,
  gitOriginCommand,
  REPO_CHECK_COMMAND,
} from "../../src/projects/init.js"
import { parseGitRemote, parseProjectName } from "../../src/projects/naming.js"
import {
  addProject,
  displayRemote,
  findProject,
  parseRegistry,
  sortProjects,
} from "../../src/projects/registry.js"
import type { ProjectSummary } from "../../src/projects/types.js"

const demo: ProjectSummary = { name: "demo", agent: "project-1" }

describe("project naming", () => {
  it("accepts safe names", () => {
    expect(parseProjectName("demo")).toBe("demo")
    expect(parseProjectName("a.b_c-1")).toBe("a.b_c-1")
    expect(parseProjectName("x".repeat(40))).toBe("x".repeat(40))
  })

  it("rejects unsafe and reserved names", () => {
    expect(() => parseProjectName("root")).toThrow(/reserved/)
    expect(() => parseProjectName(undefined)).toThrow(/project/)
    expect(() => parseProjectName("")).toThrow(/project/)
    expect(() => parseProjectName("-demo")).toThrow(/project/)
    expect(() => parseProjectName("demo/repo")).toThrow(/project/)
    expect(() => parseProjectName("x".repeat(41))).toThrow(/project/)
    expect(() => parseProjectName(1)).toThrow(/project/)
  })

  it("accepts normal git remotes", () => {
    expect(parseGitRemote(" https://example.com/org/repo.git ")).toBe("https://example.com/org/repo.git")
    expect(parseGitRemote("git@example.com:org/repo.git")).toBe("git@example.com:org/repo.git")
    expect(parseGitRemote("ssh://git@example.com/org/repo.git")).toBe("ssh://git@example.com/org/repo.git")
  })

  it("rejects unsafe remotes", () => {
    expect(() => parseGitRemote(undefined)).toThrow(/remote/)
    expect(() => parseGitRemote(1)).toThrow(/remote/)
    expect(() => parseGitRemote("   ")).toThrow(/remote is required/)
    expect(() => parseGitRemote(`https://example.com/${"x".repeat(2048)}`)).toThrow(/limited/)
    expect(() => parseGitRemote("--upload-pack=bad")).toThrow(/start/)
    expect(() => parseGitRemote("https://example.com/a b")).toThrow(/whitespace/)
    expect(() => parseGitRemote("https://example.com/a\u0000b")).toThrow(/whitespace/)
  })
})

describe("project registry", () => {
  it("reads valid records and ignores malformed ones", () => {
    const raw = [
      { name: "demo", agent: "project-1" },
      { name: "work", agent: "project-2", remote: "https://example.com/work.git" },
      null,
      "nope",
      { name: "", agent: "project-3" },
      { name: "broken", agent: "" },
      { name: "broken", agent: "project-4", remote: 5 },
      { agent: "project-5" },
    ]
    expect(parseRegistry(raw)).toEqual([
      { name: "demo", agent: "project-1" },
      { name: "work", agent: "project-2", remote: "https://example.com/work.git" },
    ])
    expect(parseRegistry(undefined)).toEqual([])
    expect(parseRegistry("nope")).toEqual([])
  })

  it("adds unique projects and rejects duplicates", () => {
    expect(addProject([], demo)).toEqual([demo])
    expect(() => addProject([demo], demo)).toThrow(/already exists/)
    expect(() => addProject([demo], { name: "other", agent: "project-1" })).toThrow(/agent/)
  })

  it("finds and sorts projects", () => {
    const work: ProjectSummary = { name: "work", agent: "project-2" }
    expect(findProject([work, demo], "demo")).toEqual(demo)
    expect(findProject([work], "demo")).toBeUndefined()
    expect(sortProjects([work, demo]).map((project) => project.name)).toEqual(["demo", "work"])
  })

  it("redacts credentials in displayed remotes", () => {
    expect(displayRemote("https://token@example.com/org/repo.git")).toBe("https://***@example.com/org/repo.git")
    expect(displayRemote("https://user:pass@example.com/org/repo.git")).toBe(
      "https://***@example.com/org/repo.git",
    )
    expect(displayRemote("git@example.com:org/repo.git")).toBe("git@example.com:org/repo.git")
  })
})

describe("project init commands", () => {
  it("builds clone and init commands", () => {
    expect(gitInitCommand()).toBe("git init -b main")
    expect(gitCloneCommand("https://example.com/a'b.git")).toContain("git clone --")
    expect(gitCloneCommand("https://example.com/a'b.git")).toContain("'https://example.com/a'\\''b.git'")
    expect(gitCloneCommand("https://example.com/repo.git")).toContain("GIT_TERMINAL_PROMPT=0")
    expect(gitCloneCommand("git@example.com:org/repo.git")).toContain("StrictHostKeyChecking=accept-new")
  })

  it("builds origin and identity commands", () => {
    expect(gitOriginCommand("https://example.com/repo.git")).toContain("git remote add origin")
    expect(gitOriginCommand("https://example.com/repo.git")).toContain("git remote set-url origin")
    expect(gitIdentityCommand()).toContain("git config user.name jujuba")
    expect(gitIdentityCommand()).toContain("git config user.email jujuba@localhost")
    expect(REPO_CHECK_COMMAND).toContain("git rev-parse")
  })

  it("extracts the best failure text", () => {
    expect(
      commandFailure({
        exitCode: 1,
        stdout: "out",
        stderr: "err",
        truncated: false,
        durationMs: 1,
      }),
    ).toBe("err\nout")
    expect(
      commandFailure({
        exitCode: 2,
        stdout: "out",
        stderr: " ",
        truncated: false,
        durationMs: 1,
      }),
    ).toBe("out")
    expect(
      commandFailure({
        exitCode: 3,
        stdout: "",
        stderr: "",
        truncated: false,
        durationMs: 1,
      }),
    ).toBe("command failed with exit code 3")
  })
})