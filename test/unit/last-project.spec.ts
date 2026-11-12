import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { LastProjectStore, lastProjectPath } from "../../src/tui/last-project.js"
import { jujubaStateDir } from "../../src/tui/last-session.js"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "jujuba-last-project-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("LastProjectStore", () => {
  it("round-trips a project and root mode", () => {
    const store = new LastProjectStore(path.join(dir, "nested", "mode.json"))
    expect(store.read()).toBeUndefined()
    store.write("demo")
    expect(store.read()).toBe("demo")
    store.write(undefined)
    expect(store.read()).toBeUndefined()
  })

  it("ignores missing, corrupt and invalid files", () => {
    const file = path.join(dir, "mode.json")
    const store = new LastProjectStore(file)

    writeFileSync(file, "{bad")
    expect(store.read()).toBeUndefined()

    writeFileSync(file, "null")
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ project: 5 }))
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ project: "root" }))
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ other: true }))
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ project: "demo" }))
    expect(store.read()).toBe("demo")
  })
})

describe("lastProjectPath", () => {
  it("keeps one mode file per root agent", () => {
    expect(lastProjectPath("tui", { stateDir: "/state" })).toBe("/state/last-project-tui.json")
  })

  it("uses the shared state directory defaults", () => {
    expect(lastProjectPath("tui")).toBe(
      path.join(homedir(), ".local", "state", "jujuba", "last-project-tui.json"),
    )
    expect(jujubaStateDir()).toBe(path.join(homedir(), ".local", "state", "jujuba"))
  })
})