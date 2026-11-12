import { describe, expect, it } from "vitest"
import { isInside, normalizeWorkspacePath, relativeWorkspacePath, WORKSPACE } from "../../src/sandbox/paths.js"
import { SandboxError } from "../../src/sandbox/types.js"

describe("normalizeWorkspacePath", () => {
  it("accepts absolute workspace paths", () => {
    expect(normalizeWorkspacePath("/workspace/src/a.ts")).toBe("/workspace/src/a.ts")
  })

  it("turns relative paths into workspace paths", () => {
    expect(normalizeWorkspacePath("src/a.ts")).toBe("/workspace/src/a.ts")
    expect(normalizeWorkspacePath("./src/../a.ts")).toBe("/workspace/a.ts")
  })

  it("normalizes backslashes and the root itself", () => {
    expect(normalizeWorkspacePath("\\workspace\\a.ts")).toBe("/workspace/a.ts")
    expect(normalizeWorkspacePath("/workspace")).toBe(WORKSPACE)
    expect(normalizeWorkspacePath("/workspace/")).toBe(WORKSPACE)
  })

  it("rejects escapes and empty paths", () => {
    expect(() => normalizeWorkspacePath("")).toThrow(SandboxError)
    expect(() => normalizeWorkspacePath("   ")).toThrow(SandboxError)
    expect(() => normalizeWorkspacePath("..")).toThrow(/inside/)
    expect(() => normalizeWorkspacePath("/workspace/../../etc/passwd")).toThrow(/escapes/)
    expect(() => normalizeWorkspacePath("/etc/passwd")).toThrow(/inside/)
    expect(() => normalizeWorkspacePath("a\0b")).toThrow(/null/)
  })

  it("rejects non-strings at runtime", () => {
    expect(() => normalizeWorkspacePath(42 as unknown as string)).toThrow(/required/)
  })
})

describe("relativeWorkspacePath", () => {
  it("strips the workspace prefix", () => {
    expect(relativeWorkspacePath("/workspace/a/b")).toBe("a/b")
    expect(relativeWorkspacePath("/workspace")).toBe("")
    expect(relativeWorkspacePath("a")).toBe("a")
  })
})

describe("isInside", () => {
  it("accepts the root and descendants only", () => {
    expect(isInside("/tmp/root", "/tmp/root")).toBe(true)
    expect(isInside("/tmp/root/", "/tmp/root/a")).toBe(true)
    expect(isInside("/tmp/root", "/tmp/root-evil/a")).toBe(false)
    expect(isInside("/tmp/root", "/tmp")).toBe(false)
  })
})
