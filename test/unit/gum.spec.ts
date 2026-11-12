import { describe, expect, it } from "vitest"
import { BRAND, CYCLE_MS, SYLLABLES, STEP_MS, gumSegments, gumWidth } from "../../src/tui/gum.js"

/** The visible word, without the ball. */
function wordSegments(elapsedMs: number) {
  return gumSegments(elapsedMs).filter((segment) => segment.style === "brand" || segment.style === "active")
}

describe("gum header animation", () => {
  it("splits the uppercase brand into the JU-JU-BA syllables", () => {
    expect(SYLLABLES.join("")).toBe(BRAND)
    expect(BRAND).toBe("JUJUBA")
    expect(SYLLABLES).toEqual(["JU", "JU", "BA"])
    expect(STEP_MS).toBe(1_000)
    expect(CYCLE_MS).toBe(STEP_MS * 3)
  })

  it("never changes the case of the word", () => {
    for (const elapsed of [0, 400, 1_000, 2_000, 2_599, 3_000, 7_500]) {
      expect(wordSegments(elapsed).map((segment) => segment.text).join("")).toBe("JUJUBA")
    }
    expect(wordSegments(0).every((segment) => segment.text === segment.text.toUpperCase())).toBe(true)
  })

  it("moves the highlight to the next syllable every second and wraps around", () => {
    const stylesAt = (elapsedMs: number) => wordSegments(elapsedMs).map((segment) => segment.style)
    expect(stylesAt(0)).toEqual(["active", "brand", "brand"])
    expect(stylesAt(STEP_MS - 1)).toEqual(["active", "brand", "brand"])
    expect(stylesAt(STEP_MS)).toEqual(["brand", "active", "brand"])
    expect(stylesAt(STEP_MS * 2 - 1)).toEqual(["brand", "active", "brand"])
    expect(stylesAt(STEP_MS * 2)).toEqual(["brand", "brand", "active"])
    expect(stylesAt(CYCLE_MS - 1)).toEqual(["brand", "brand", "active"])
    expect(stylesAt(CYCLE_MS)).toEqual(["active", "brand", "brand"])
    expect(stylesAt(CYCLE_MS + STEP_MS)).toEqual(["brand", "active", "brand"])
  })

  it("treats a negative elapsed time as the previous cycle", () => {
    const stylesAt = (elapsedMs: number) => wordSegments(elapsedMs).map((segment) => segment.style)
    expect(stylesAt(-STEP_MS)).toEqual(["brand", "brand", "active"])
    expect(stylesAt(-CYCLE_MS)).toEqual(["active", "brand", "brand"])
  })

  it("grows the ball across the whole cycle without popping it", () => {
    const ballAt = (elapsedMs: number) => gumSegments(elapsedMs).at(-1)
    expect(ballAt(0)).toEqual({ text: " ✢", style: "ball" })
    expect(ballAt(599)).toEqual({ text: " ✢", style: "ball" })
    expect(ballAt(600)).toEqual({ text: " ✳", style: "ball" })
    expect(ballAt(1_200)).toEqual({ text: " ✶", style: "ball" })
    expect(ballAt(1_800)).toEqual({ text: " ✻", style: "ball" })
    expect(ballAt(2_400)).toEqual({ text: " ✽", style: "ball" })
    expect(ballAt(CYCLE_MS - 1)).toEqual({ text: " ✽", style: "ball" })
    expect(ballAt(CYCLE_MS)).toEqual({ text: " ✢", style: "ball" })
    expect(gumSegments(CYCLE_MS - 1)).toHaveLength(4)
  })

  it("reports the visible width of the word plus the ball", () => {
    for (const elapsed of [0, 400, 1_000, 2_000, 2_600]) {
      const text = gumSegments(elapsed)
        .map((segment) => segment.text)
        .join("")
      expect(gumWidth(elapsed)).toBe(text.length)
    }
    expect(gumWidth(0)).toBe("JUJUBA ✢".length)
    expect(gumWidth(CYCLE_MS - 1)).toBe("JUJUBA ✽".length)
  })

  it("always draws the word and its ball", () => {
    const segments = gumSegments(0)
    expect(segments).toHaveLength(4)
    expect(segments.map((segment) => segment.style)).toEqual(["active", "brand", "brand", "ball"])
  })
})
