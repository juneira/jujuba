import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { LastSessionStore, lastSessionPath } from "../../src/tui/last-session.js"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "jujuba-last-session-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("LastSessionStore", () => {
  it("round-trips a session id, creating parent directories", () => {
    const store = new LastSessionStore(path.join(dir, "nested", "last.json"))
    expect(store.read()).toBeUndefined()
    store.write("ses_abc-123")
    expect(store.read()).toBe("ses_abc-123")
  })

  it("ignores missing, corrupt and foreign files", () => {
    const file = path.join(dir, "last.json")
    const store = new LastSessionStore(file)

    writeFileSync(file, "{bad")
    expect(store.read()).toBeUndefined()

    writeFileSync(file, "null")
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ session: 5 }))
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ session: "nope" }))
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ other: true }))
    expect(store.read()).toBeUndefined()

    writeFileSync(file, JSON.stringify({ session: "ses_ok" }))
    expect(store.read()).toBe("ses_ok")
  })
})

describe("lastSessionPath", () => {
  it("prefers the explicit state directory", () => {
    expect(lastSessionPath("a", { stateDir: "/state", xdgStateHome: "/xdg", home: "/home/u" })).toBe(
      "/state/last-session-a.json",
    )
  })

  it("uses XDG_STATE_HOME before the home directory", () => {
    expect(lastSessionPath("a", { xdgStateHome: "/xdg", home: "/home/u" })).toBe(
      "/xdg/jujuba/last-session-a.json",
    )
  })

  it("defaults to ~/.local/state", () => {
    expect(lastSessionPath("a", { home: "/home/u" })).toBe("/home/u/.local/state/jujuba/last-session-a.json")
    expect(lastSessionPath("a")).toBe(
      path.join(homedir(), ".local", "state", "jujuba", "last-session-a.json"),
    )
  })
})
