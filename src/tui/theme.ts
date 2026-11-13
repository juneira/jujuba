import type { GumStyle } from "./gum.js"
import type { ViewStyle } from "./transcript.js"

/**
 * The TUI palette. Every color the terminal UI paints is defined here; swapping
 * these hex values re-themes the whole TUI without touching the renderables.
 *
 * The defaults are "Blackberry Marshmallow": a deep plum background built
 * around the bubblegum pinks used by the JUJUBA brand.
 */
export const PALETTE = {
  /** Full-screen background painted behind every pane. */
  background: "#241A2B",
  /** Panels: the transcript frame, menus and the unfocused input. */
  panel: "#2E2036",
  /** The focused input, a little lighter than a panel. */
  input: "#3A2944",
  border: "#5B3F63",
  borderFocus: "#FF2D95",
  text: "#FFF0F6",
  textMuted: "#B9A3C0",
  /** Text drawn on top of a selected pink row. */
  textOnPink: "#241A2B",
  blueberry: "#8FC7FF",
  mint: "#7FE7C4",
  lavender: "#C6A6FF",
  matcha: "#A6E3A1",
  cherry: "#FF7A93",
  lemon: "#FFE08A",
  plum: "#9A85A3",
  cream: "#F2E4EA",
  gumBrand: "#FF79C6",
  gumActive: "#FF2D95",
  gumBall: "#FF8FD0",
} as const

/**
 * Transcript styles that set their own foreground. The rest inherit the
 * renderable foreground (and its attributes), which keeps the theme small.
 */
export const VIEW_COLORS: Partial<Record<ViewStyle, string>> = {
  user: PALETTE.blueberry,
  "tool-name": PALETTE.mint,
  "file-header": PALETTE.lavender,
  "diff-added": PALETTE.matcha,
  "diff-removed": PALETTE.cherry,
  "diff-hunk": PALETTE.blueberry,
  error: PALETTE.cherry,
  heading: PALETTE.lemon,
  "inline-code": PALETTE.matcha,
  link: PALETTE.blueberry,
  quote: PALETTE.plum,
  "list-marker": PALETTE.mint,
  rule: PALETTE.plum,
  "code-block": PALETTE.cream,
  "table-border": PALETTE.plum,
}

/** The animated brand: the highlighted syllable and the blooming ball. */
export const GUM_COLORS: Record<GumStyle, string> = {
  brand: PALETTE.gumBrand,
  active: PALETTE.gumActive,
  ball: PALETTE.gumBall,
}
