import { describe, expect, it } from "vitest"
import { GUM_COLORS, PALETTE, VIEW_COLORS } from "../../src/tui/theme.js"

const HEX = /^#[0-9a-f]{6}$/i

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground)
  const second = luminance(background)
  const [lighter, darker] = first > second ? [first, second] : [second, first]
  return (lighter + 0.05) / (darker + 0.05)
}

describe("TUI palette", () => {
  const tokens = Object.values(PALETTE) as readonly string[]

  it("defines every token as a six-digit hex color", () => {
    for (const [name, value] of Object.entries(PALETTE)) expect(value, name).toMatch(HEX)
  })

  it("draws every transcript accent from the palette", () => {
    for (const value of Object.values(VIEW_COLORS)) expect(tokens).toContain(value)
    for (const value of Object.values(GUM_COLORS)) expect(tokens).toContain(value)
  })

  it("keeps transcript accents legible on both content surfaces", () => {
    for (const [style, value] of Object.entries(VIEW_COLORS)) {
      expect(contrast(value, PALETTE.background), `${style} on background`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value, PALETTE.panel), `${style} on panel`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps body text legible on every surface", () => {
    for (const surface of [PALETTE.background, PALETTE.panel, PALETTE.input]) {
      expect(contrast(PALETTE.text, surface), `text on ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(PALETTE.textMuted, surface), `muted text on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps the gum brand legible and selected rows readable", () => {
    for (const surface of [PALETTE.background, PALETTE.panel]) {
      expect(contrast(PALETTE.gumBrand, surface), `brand on ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(PALETTE.gumBall, surface), `ball on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(PALETTE.textOnPink, PALETTE.gumActive)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(PALETTE.textOnPink, PALETTE.gumBrand)).toBeGreaterThanOrEqual(4.5)
  })
})
