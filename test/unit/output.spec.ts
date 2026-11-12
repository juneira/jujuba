import { describe, expect, it } from "vitest"
import { SandboxError } from "../../src/sandbox/types.js"
import {
  CappedText,
  clampTimeout,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  readCapped,
  readLimited,
  resolveWorkspaceCwd,
  shellQuote,
} from "../../src/sandbox/output.js"

function stream(...chunks: string[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe("clampTimeout", () => {
  it("uses the default and clamps the range", () => {
    expect(clampTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS)
    expect(clampTimeout(10)).toBe(1_000)
    expect(clampTimeout(MAX_TIMEOUT_MS + 1)).toBe(MAX_TIMEOUT_MS)
    expect(clampTimeout(5_000)).toBe(5_000)
  })
})

describe("resolveWorkspaceCwd", () => {
  it("maps aliases and relative paths", () => {
    expect(resolveWorkspaceCwd(undefined)).toBe("/workspace")
    expect(resolveWorkspaceCwd("")).toBe("/workspace")
    expect(resolveWorkspaceCwd("/")).toBe("/workspace")
    expect(resolveWorkspaceCwd("/workspace/")).toBe("/workspace")
    expect(resolveWorkspaceCwd("src")).toBe("/workspace/src")
    expect(resolveWorkspaceCwd("/workspace/src")).toBe("/workspace/src")
  })

  it("rejects escapes", () => {
    expect(() => resolveWorkspaceCwd("/workspace/../etc")).toThrow(/inside/)
    expect(() => resolveWorkspaceCwd("/etc")).toThrow(/inside/)
  })
})

describe("shellQuote", () => {
  it("quotes plain and embedded single quotes", () => {
    expect(shellQuote("a b")).toBe("'a b'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

describe("CappedText", () => {
  it("returns short output unchanged", () => {
    const capped = new CappedText()
    capped.push("hello")
    expect(capped.truncated).toBe(false)
    expect(capped.value()).toBe("hello")
  })

  it("keeps the head and tail and reports dropped characters", () => {
    const capped = new CappedText(4, 4)
    capped.push("abcdefghij")
    expect(capped.truncated).toBe(true)
    expect(capped.value()).toContain("… [2 chars truncated] …")
    expect(capped.value().startsWith("abcd")).toBe(true)
    expect(capped.value().endsWith("ghij")).toBe(true)
  })

  it("handles a chunk that exactly fills the head", () => {
    const capped = new CappedText(4, 4)
    capped.push("abcd")
    expect(capped.truncated).toBe(false)
    expect(capped.value()).toBe("abcd")
  })

  it("keeps only the most recent tail", () => {
    const capped = new CappedText(2, 3)
    capped.push("ab")
    capped.push("cdef")
    expect(capped.value()).toContain("cdef".slice(-3))
  })
})

describe("readLimited", () => {
  it("returns empty for a null stream", async () => {
    expect(await readLimited(null, 10)).toEqual(new Uint8Array())
  })

  it("reads within the limit", async () => {
    const bytes = await readLimited(stream("ab", "cd"), 10)
    expect(new TextDecoder().decode(bytes)).toBe("abcd")
  })

  it("rejects a stream over the limit", async () => {
    await expect(readLimited(stream("abcd", "ef"), 5)).rejects.toThrow(/larger than 5/)
  })
})

describe("readCapped", () => {
  it("returns empty for a null stream", async () => {
    const capped = await readCapped(null)
    expect(capped.value()).toBe("")
  })

  it("decodes multi-byte characters split across chunks", async () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode("aé")
    const split = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 2))
        controller.enqueue(bytes.subarray(2))
        controller.close()
      },
    })
    expect((await readCapped(split)).value()).toBe("aé")
  })
})

describe("SandboxError", () => {
  it("uses the default status and code", () => {
    expect(new SandboxError("boom")).toMatchObject({
      name: "SandboxError",
      message: "boom",
      status: 400,
      code: "sandbox_error",
    })
  })
})
