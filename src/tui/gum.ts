/**
 * The animated "JUJUBA" brand in the TUI header: one syllable is highlighted
 * every step while a ball blooms steadily next to the word. The word itself
 * never changes case; only its colors move.
 */

export const BRAND = "JUJUBA"
export const SYLLABLES = ["JU", "JU", "BA"] as const

/** One syllable is highlighted every second, then the cycle restarts. */
export const STEP_MS = 1_000
export const CYCLE_MS = STEP_MS * SYLLABLES.length
/** Animation frames per second; the ball is redrawn at this rate. */
export const TICK_FPS = 10

/** The ball blooms like a Claude spinner: dot, sparks, then a full bloom. */
const BALL_FRAMES = ["✢", "✳", "✶", "✻", "✽"] as const

export type GumStyle = "brand" | "active" | "ball"

export interface GumSegment {
  readonly text: string
  readonly style: GumStyle
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

/**
 * The word plus its ball at `elapsedMs` after the TUI opened. The ball grows
 * across the whole cycle and starts over with the word.
 */
export function gumSegments(elapsedMs: number): GumSegment[] {
  const cycle = modulo(elapsedMs, CYCLE_MS)
  const active = Math.floor(cycle / STEP_MS)
  const progress = cycle / CYCLE_MS
  const frame = Math.min(BALL_FRAMES.length - 1, Math.floor(progress * BALL_FRAMES.length))
  const segments: GumSegment[] = SYLLABLES.map((syllable, index) => ({
    text: syllable,
    style: index === active ? "active" : "brand",
  }))
  segments.push({ text: ` ${BALL_FRAMES[frame]!}`, style: "ball" })
  return segments
}

/** Visible width of the brand at `elapsedMs`, so the header can reserve room. */
export function gumWidth(elapsedMs: number): number {
  return gumSegments(elapsedMs).reduce((width, segment) => width + segment.text.length, 0)
}
