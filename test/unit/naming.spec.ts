import { describe, expect, it } from "vitest"
import { agentKey, parseAgentName, parseSessionId } from "../../src/agent/naming.js"

describe("agentKey", () => {
  it("keeps safe names", () => {
    expect(agentKey("e2e-write")).toBe("e2e-write")
    expect(agentKey("a.b_c-1")).toBe("a.b_c-1")
  })

  it("falls back and sanitizes", () => {
    expect(agentKey(undefined)).toBe("default")
    expect(agentKey("../../etc")).toBe("..-..-etc")
    expect(agentKey("!!!")).toBe("---")
    expect(agentKey("x".repeat(100))).toHaveLength(64)
  })
})

describe("parseAgentName", () => {
  it("accepts safe names", () => {
    expect(parseAgentName("agent-1")).toBe("agent-1")
  })

  it("rejects everything else", () => {
    expect(() => parseAgentName(undefined)).toThrow(/agent/)
    expect(() => parseAgentName("")).toThrow(/agent/)
    expect(() => parseAgentName("../x")).toThrow(/agent/)
    expect(() => parseAgentName("x".repeat(65))).toThrow(/agent/)
    expect(() => parseAgentName(1)).toThrow(/agent/)
  })
})

describe("parseSessionId", () => {
  it("accepts an OpenCode session id", () => {
    expect(parseSessionId("ses_root")).toBe("ses_root")
    expect(parseSessionId("ses_abc-123")).toBe("ses_abc-123")
  })

  it("treats empty values as absent", () => {
    expect(parseSessionId(undefined)).toBeUndefined()
    expect(parseSessionId(null)).toBeUndefined()
    expect(parseSessionId("")).toBeUndefined()
  })

  it("rejects other values", () => {
    expect(() => parseSessionId("root")).toThrow(/session/)
    expect(() => parseSessionId(7)).toThrow(/session/)
  })
})

describe("agentKey empty", () => {
  it("falls back when everything is stripped", () => {
    expect(agentKey("")).toBe("default")
  })
})
