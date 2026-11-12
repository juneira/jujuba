import { describe, expect, it } from "vitest"
import { fingerprint } from "../../src/jujuba/fingerprint.js"

describe("fingerprint", () => {
  it("is twelve lowercase hex characters", () => {
    expect(fingerprint([{ path: "a", content: "1" }])).toMatch(/^[0-9a-f]{12}$/)
  })

  it("does not depend on entry order", () => {
    const first = fingerprint([
      { path: "b", content: "2" },
      { path: "a", content: "1" },
    ])
    const second = fingerprint([
      { path: "a", content: "1" },
      { path: "b", content: "2" },
    ])
    expect(first).toBe(second)
  })

  it("changes with content and path", () => {
    const base = fingerprint([{ path: "a", content: "1" }])
    expect(fingerprint([{ path: "a", content: "2" }])).not.toBe(base)
    expect(fingerprint([{ path: "b", content: "1" }])).not.toBe(base)
  })

  it("handles entries that share a path", () => {
    expect(fingerprint([
      { path: "a", content: "1" },
      { path: "a", content: "2" },
    ])).toMatch(/^[0-9a-f]{12}$/)
  })

  it("handles an empty input", () => {
    expect(fingerprint([])).toMatch(/^[0-9a-f]{12}$/)
  })
})
