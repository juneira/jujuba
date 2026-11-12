import { describe, expect, it, vi } from "vitest"
import {
  decodeBase64,
  normalizeKnownHosts,
  normalizePrivateKey,
  SSH_CONFIG,
  SSH_PERMISSIONS_COMMAND,
} from "../../src/sandbox/ssh.js"

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64")
}

describe("decodeBase64", () => {
  it("decodes keys with surrounding whitespace", () => {
    expect(decodeBase64(`  ${encode("hello")}\n`)).toBe("hello")
  })

  it("rejects empty and malformed values", () => {
    expect(() => decodeBase64("")).toThrow(/empty/)
    expect(() => decodeBase64("  \n")).toThrow(/empty/)
    expect(() => decodeBase64("not base64!")).toThrow(/base64/)
  })

  it("turns a decoder failure into a sandbox error", () => {
    const stub = vi.spyOn(globalThis, "atob").mockImplementation(() => {
      throw new Error("bad input")
    })
    try {
      expect(() => decodeBase64("aGVsbG8=")).toThrow(/base64/)
    } finally {
      stub.mockRestore()
    }
  })
})

describe("normalizePrivateKey", () => {
  it("accepts OpenSSH and RSA keys", () => {
    expect(
      normalizePrivateKey("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"),
    ).toBe("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n")
    expect(normalizePrivateKey("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toContain(
      "BEGIN RSA PRIVATE KEY",
    )
  })

  it("rejects keys that are not private keys", () => {
    expect(() => normalizePrivateKey("ssh-ed25519 AAAA")).toThrow(/private key/)
  })
})

describe("sandbox ssh files", () => {
  it("uses an accept-new host key policy and guards permissions", () => {
    expect(SSH_CONFIG).toContain("StrictHostKeyChecking accept-new")
    expect(SSH_CONFIG).toContain("IdentityFile /root/.ssh/id_ed25519")
    expect(SSH_CONFIG).toContain("/root/.ssh/known_hosts")
    expect(SSH_PERMISSIONS_COMMAND).toContain("chmod 700 /root/.ssh")
    expect(SSH_PERMISSIONS_COMMAND).toContain("chmod 600 /root/.ssh/id_ed25519")
    expect(normalizeKnownHosts("github.com ssh-ed25519 AAAA\n\n")).toBe("github.com ssh-ed25519 AAAA\n")
  })
})