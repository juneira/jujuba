import { describe, expect, it } from "vitest"
import { stripAnsi } from "../../src/tui/ansi.js"

describe("stripAnsi", () => {
  it("removes color and cursor sequences", () => {
    expect(stripAnsi("\u001B[32mgreen\u001B[0m")).toBe("green")
    expect(stripAnsi("\u001B[1;31mred\u001B[22;39m")).toBe("red")
    expect(stripAnsi("\u001B[2K\u001B[1Gok")).toBe("ok")
    expect(stripAnsi("\u009B32mred")).toBe("red")
  })

  it("removes operating-system commands", () => {
    expect(stripAnsi("\u001B]0;title\u0007done")).toBe("done")
    expect(stripAnsi("\u001B]8;;https://example.dev\u001B\\link")).toBe("link")
  })

  it("removes charset and single-character escapes", () => {
    expect(stripAnsi("\u001B(Btext")).toBe("text")
    expect(stripAnsi("\u001B=text")).toBe("text")
  })

  it("drops control characters but keeps newlines and tabs", () => {
    expect(stripAnsi("a\rb\u0007c")).toBe("abc")
    expect(stripAnsi("a\tb\nc")).toBe("a\tb\nc")
  })

  it("leaves ordinary brackets and text alone", () => {
    expect(stripAnsi("[32m is not an escape")).toBe("[32m is not an escape")
    expect(stripAnsi("")).toBe("")
  })

  it("does not leave the parameters of an unterminated sequence", () => {
    expect(stripAnsi("\u001B[32")).toBe("32")
  })
})
