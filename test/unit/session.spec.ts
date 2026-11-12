import { describe, expect, it } from "vitest"
import {
  socketEvents,
  socketSnapshot,
  toPromptResult,
  toSessionState,
  toSessionSummary,
} from "../../src/agent/session.js"

describe("session mapping", () => {
  it("keeps optional prompt fields only when present", () => {
    expect(toPromptResult({ status: "done", text: "hi" })).toEqual({ status: "done", text: "hi" })
    expect(toPromptResult({ status: "unanswered", reason: "interrupted" })).toEqual({
      status: "unanswered",
      reason: "interrupted",
    })
    expect(toPromptResult({ status: "done" })).toEqual({ status: "done" })
  })

  it("maps session summaries", () => {
    expect(toSessionSummary({ id: "ses_a", busy: true })).toEqual({ id: "ses_a", busy: true })
    expect(toSessionSummary({ id: "ses_b", busy: false, title: "T", parent: "ses_a" })).toEqual({
      id: "ses_b",
      busy: false,
      title: "T",
      parent: "ses_a",
    })
  })

  it("maps session state", () => {
    expect(toSessionState([1], true, [2])).toEqual({ messages: [1], busy: true, pending: [2] })
  })

  it("serializes socket frames", () => {
    expect(socketSnapshot({ a: 1 })).toBe('{"type":"snapshot","snapshot":{"a":1}}')
    expect(socketSnapshot({ session: "ses_a" }, { provider: "openrouter", model: "m", title: "T" })).toBe(
      '{"type":"snapshot","snapshot":{"session":"ses_a","provider":"openrouter","model":"m","title":"T"}}',
    )
    expect(socketEvents([{ type: "run_start" }])).toBe('{"type":"events","events":[{"type":"run_start"}]}')
  })
})
