import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadSshEnvironment } from "../../scripts/lib/ssh.js"

const dirs: string[] = []
const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----"

function home(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "jujuba-ssh-"))
  dirs.push(dir)
  mkdirSync(path.join(dir, ".ssh"), { recursive: true })
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("loadSshEnvironment", () => {
  it("returns nothing when there is no key", () => {
    expect(loadSshEnvironment(home(), {})).toEqual({})
  })

  it("finds the usual identity files in order", () => {
    const root = home()
    writeFileSync(path.join(root, ".ssh", "id_rsa"), KEY)
    expect(loadSshEnvironment(root, {}).keyPath).toBe(path.join(root, ".ssh", "id_rsa"))

    writeFileSync(path.join(root, ".ssh", "id_ed25519"), KEY)
    const found = loadSshEnvironment(root, {})
    expect(found.keyPath).toBe(path.join(root, ".ssh", "id_ed25519"))
    expect(found.keyBase64).toBe(Buffer.from(KEY).toString("base64"))
  })

  it("honours SSH_KEY_PATH and ignores non-private files", () => {
    const root = home()
    const custom = path.join(root, "custom-key")
    writeFileSync(custom, KEY)
    expect(loadSshEnvironment(root, { SSH_KEY_PATH: custom }).keyPath).toBe(custom)

    writeFileSync(path.join(root, ".ssh", "id_ed25519"), "ssh-ed25519 AAAA")
    expect(loadSshEnvironment(root, {}).keyBase64).toBeUndefined()
  })

  it("lets an explicit key win and still loads known_hosts", () => {
    const root = home()
    writeFileSync(path.join(root, ".ssh", "known_hosts"), "github.com ssh-ed25519 AAAA\n")
    const found = loadSshEnvironment(root, { SSH_KEY_BASE64: "explicit" })
    expect(found.keyBase64).toBe("explicit")
    expect(found.keyPath).toBeUndefined()
    expect(found.knownHostsBase64).toBe(
      Buffer.from("github.com ssh-ed25519 AAAA\n").toString("base64"),
    )
  })

  it("uses an explicit known_hosts value", () => {
    const root = home()
    writeFileSync(path.join(root, ".ssh", "known_hosts"), "old")
    expect(loadSshEnvironment(root, { SSH_KNOWN_HOSTS_BASE64: "explicit" }).knownHostsBase64).toBe("explicit")
    expect(loadSshEnvironment(root, { SSH_KNOWN_HOSTS_PATH: path.join(root, "missing") }).knownHostsBase64).toBe(
      undefined,
    )
  })
})