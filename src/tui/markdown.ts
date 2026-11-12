import type { ViewLine, ViewSegment, ViewStyle } from "./transcript.js"

/**
 * The TUI transcript is a flat list of styled lines, so markdown is rendered by
 * concealing its markers and keeping the structure: headings lose their `#`,
 * emphasis loses its delimiters, and lists, quotes and code blocks keep a
 * gutter. There is no viewport width here, so rules are a fixed length.
 */

const RULE_TEXT = "────────────"
/** Tables are capped so a wide table does not blow past a standard terminal. */
const MAX_TABLE_WIDTH = 76

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const DELIMITER_CELL = /^:?-+:?$/
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/
const ZERO_WIDTH = /[\u0300-\u036F\u200B-\u200F\uFE00-\uFE0F]/
const EMOJI = /\p{Emoji_Presentation}/u

interface Fence {
  readonly char: string
  readonly size: number
}

interface FenceOpen {
  readonly marker: string
  readonly lang: string
}

type TableAlign = "left" | "center" | "right"

interface TableCell {
  readonly segments: readonly ViewSegment[]
  readonly width: number
}

interface ParsedTable {
  readonly lines: ViewLine[]
  readonly next: number
}

interface InlineContext {
  readonly base: ViewStyle
  readonly strong: boolean
  readonly emphasis: boolean
  readonly strike: boolean
}

interface InlineFlags {
  readonly strong?: boolean
  readonly emphasis?: boolean
  readonly strike?: boolean
}

function context(base: ViewStyle): InlineContext {
  return { base, strong: false, emphasis: false, strike: false }
}

function inherit(current: InlineContext, flags: InlineFlags, base?: ViewStyle): InlineContext {
  return {
    base: base ?? current.base,
    strong: current.strong || flags.strong === true,
    emphasis: current.emphasis || flags.emphasis === true,
    strike: current.strike || flags.strike === true,
  }
}

function styleOf(current: InlineContext): ViewStyle {
  if (current.strike) return "strike"
  if (current.strong && current.emphasis) return "strong-emphasis"
  if (current.strong) return "strong"
  if (current.emphasis) return "emphasis"
  return current.base
}

function runLength(text: string, index: number, char: string): number {
  let length = 0
  while (text[index + length] === char) length += 1
  return length
}

/** Terminal cells one code point occupies, so table borders line up. */
function charWidth(char: string): number {
  if (ZERO_WIDTH.test(char)) return 0
  return WIDE.test(char) || EMOJI.test(char) ? 2 : 1
}

function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char)
  return width
}

function takeWidth(text: string, room: number): { readonly text: string; readonly width: number } {
  let width = 0
  let kept = ""
  for (const char of text) {
    const size = charWidth(char)
    if (width + size > room) break
    kept += char
    width += size
  }
  return { text: kept, width }
}

function isSpace(char: string): boolean {
  return /\s/.test(char)
}

function isWord(char: string): boolean {
  return /[A-Za-z0-9]/.test(char)
}

function findBacktickClose(text: string, from: number, length: number): number {
  let index = from
  while (index < text.length) {
    if (text[index] === "`") {
      const run = runLength(text, index, "`")
      if (run === length) return index
      index += run
      continue
    }
    index += 1
  }
  return -1
}

function findMarkerClose(text: string, from: number, char: string, size: number): number {
  let index = from
  while (index <= text.length - size) {
    if (text[index] === char) {
      const run = runLength(text, index, char)
      if (run === size) {
        const before = text[index - 1]
        const after = text[index + size]
        const closes =
          before !== undefined && !isSpace(before) && (char !== "_" || after === undefined || !isWord(after))
        if (closes) return index
      }
      index += run
      continue
    }
    index += 1
  }
  return -1
}

interface LinkMatch {
  readonly label: string
  readonly end: number
}

function parseLink(text: string, start: number): LinkMatch | undefined {
  const close = text.indexOf("]", start + 1)
  if (close === -1 || text[close + 1] !== "(") return undefined
  const end = text.indexOf(")", close + 2)
  if (end === -1) return undefined
  const label = text.slice(start + 1, close)
  const url = text.slice(close + 2, end).trim()
  if (label === "" && url === "") return undefined
  return { label: label === "" ? url : label, end: end + 1 }
}

function markerSize(char: string, run: number): number {
  if (char === "~") return run >= 2 ? 2 : 0
  if (run >= 3) return 3
  if (run >= 2) return 2
  return 1
}

function markerFlags(char: string, size: number): InlineFlags {
  if (char === "~") return { strike: true }
  if (size === 1) return { emphasis: true }
  if (size === 2) return { strong: true }
  return { strong: true, emphasis: true }
}

function scan(text: string, current: InlineContext): ViewSegment[] {
  const segments: ViewSegment[] = []
  let buffer = ""
  const flush = (): void => {
    if (buffer === "") return
    segments.push({ text: buffer, style: styleOf(current) })
    buffer = ""
  }

  let index = 0
  while (index < text.length) {
    const char = text[index]!

    if (char === "\\" && index + 1 < text.length) {
      buffer += text[index + 1]!
      index += 2
      continue
    }

    if (char === "`") {
      const run = runLength(text, index, "`")
      const close = findBacktickClose(text, index + run, run)
      if (close === -1) {
        buffer += "`".repeat(run)
        index += run
        continue
      }
      flush()
      // Code spans are literal: no emphasis or links inside them.
      segments.push({ text: text.slice(index + run, close), style: "inline-code" })
      index = close + run
      continue
    }

    if (char === "[") {
      const link = parseLink(text, index)
      if (link === undefined) {
        buffer += char
        index += 1
        continue
      }
      flush()
      segments.push(...scan(link.label, inherit(current, {}, "link")))
      index = link.end
      continue
    }

    if (char === "*" || char === "_" || char === "~") {
      const run = runLength(text, index, char)
      const size = markerSize(char, run)
      if (size === 0) {
        buffer += char
        index += 1
        continue
      }
      const marker = char.repeat(size)
      const after = text[index + size]
      const before = text[index - 1]
      const opens =
        after !== undefined && !isSpace(after) && (char !== "_" || before === undefined || !isWord(before))
      if (opens) {
        const close = findMarkerClose(text, index + size, char, size)
        if (close !== -1) {
          flush()
          segments.push(...scan(text.slice(index + size, close), inherit(current, markerFlags(char, size))))
          index = close + size
          continue
        }
      }
      buffer += marker
      index += size
      continue
    }

    buffer += char
    index += 1
  }

  flush()
  return segments
}

function inlineLine(text: string, base: ViewStyle): ViewLine {
  const segments = scan(text, context(base))
  return { segments: segments.length === 0 ? [{ text: "", style: base }] : segments }
}

function headingLine(content: string): ViewLine {
  const text = content.replace(/\s+#+\s*$/, "")
  const segments = scan(text, context("heading"))
  return { segments: segments.length === 0 ? [{ text: "", style: "heading" }] : segments }
}

function quoteBody(line: string): string | undefined {
  const match = QUOTE.exec(line)
  if (match === null) return undefined
  let body = match[1]!
  for (;;) {
    const nested = QUOTE.exec(body)
    if (nested === null) return body
    body = nested[1]!
  }
}

function listLine(indent: string, marker: string, body: string): ViewLine {
  return {
    segments: [
      { text: indent, style: "assistant" },
      { text: marker, style: "list-marker" },
      ...scan(body, context("assistant")),
    ],
  }
}

function blockLine(line: string): ViewLine[] {
  const heading = HEADING.exec(line)
  if (heading !== null) return [headingLine(heading[2]!)]

  if (RULE.test(line)) return [{ segments: [{ text: RULE_TEXT, style: "rule" }] }]

  const quote = quoteBody(line)
  if (quote !== undefined) {
    return [{ segments: [{ text: "│ ", style: "quote" }, ...scan(quote, context("quote"))] }]
  }

  const bullet = BULLET.exec(line)
  if (bullet !== null) return [listLine(bullet[1]!, "• ", bullet[2]!)]

  const ordered = ORDERED.exec(line)
  if (ordered !== null) return [listLine(ordered[1]!, `${ordered[2]}. `, ordered[3]!)]

  return [inlineLine(line, "assistant")]
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

/** Splits a table row on unescaped pipes, trimming each cell. */
function splitRow(line: string): string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.includes("|")) return undefined
  const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed
  const content = body.endsWith("|") ? body.slice(0, -1) : body
  const cells: string[] = []
  let current = ""
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!
    if (char === "\\" && content[index + 1] === "|") {
      current += "|"
      index += 1
      continue
    }
    if (char === "|") {
      cells.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function tableAlignments(line: string): TableAlign[] | undefined {
  const cells = splitRow(line)
  if (cells === undefined) return undefined
  const aligns: TableAlign[] = []
  for (const cell of cells) {
    if (!DELIMITER_CELL.test(cell)) return undefined
    const left = cell.startsWith(":")
    const right = cell.endsWith(":")
    aligns.push(left && right ? "center" : right ? "right" : "left")
  }
  return aligns
}

function fitRow(cells: readonly string[], columns: number): string[] {
  return Array.from({ length: columns }, (_, column) => cells[column] ?? "")
}

function tableCell(text: string, style: ViewStyle): TableCell {
  const segments = scan(text, context(style))
  const parts: readonly ViewSegment[] = segments.length === 0 ? [{ text: "", style }] : segments
  return { segments: parts, width: parts.reduce((total, part) => total + textWidth(part.text), 0) }
}

/** Cuts a cell to its column width, keeping styles and appending an ellipsis. */
function truncateCell(cell: TableCell, max: number): TableCell {
  if (cell.width <= max) return cell
  const limit = Math.max(max - 1, 0)
  const segments: ViewSegment[] = []
  let used = 0
  for (const segment of cell.segments) {
    if (used >= limit) break
    const part = takeWidth(segment.text, limit - used)
    segments.push({ text: part.text, style: segment.style })
    used += part.width
  }
  const last = segments[segments.length - 1]
  if (last === undefined) {
    return { segments: [{ text: "…", style: cell.segments[0]!.style }], width: 1 }
  }
  segments[segments.length - 1] = { text: `${last.text}…`, style: last.style }
  return { segments, width: used + 1 }
}

/** Shrinks the widest columns until the table fits the width budget. */
function tableWidths(natural: readonly number[]): number[] {
  const widths = [...natural]
  const available = MAX_TABLE_WIDTH - (widths.length * 3 + 1)
  let total = widths.reduce((sum, width) => sum + width, 0)
  while (total > available) {
    let widest = 0
    for (let column = 1; column < widths.length; column += 1) {
      if (widths[column]! > widths[widest]!) widest = column
    }
    if (widths[widest]! <= 1) break
    widths[widest]! -= 1
    total -= 1
  }
  return widths
}

function borderLine(left: string, middle: string, right: string, widths: readonly number[]): ViewLine {
  const body = widths.map((width) => "─".repeat(width + 2)).join(middle)
  return { segments: [{ text: `${left}${body}${right}`, style: "table-border" }] }
}

function tableRowLine(cells: readonly TableCell[], widths: readonly number[], aligns: readonly TableAlign[]): ViewLine {
  const segments: ViewSegment[] = [{ text: "│ ", style: "table-border" }]
  cells.forEach((cell, column) => {
    const extra = widths[column]! - cell.width
    const align = aligns[column]!
    const left = align === "right" ? extra : align === "center" ? Math.floor(extra / 2) : 0
    const right = extra - left
    if (left > 0) segments.push({ text: " ".repeat(left), style: "assistant" })
    segments.push(...cell.segments)
    if (right > 0) segments.push({ text: " ".repeat(right), style: "assistant" })
    segments.push({ text: column === cells.length - 1 ? " │" : " │ ", style: "table-border" })
  })
  return { segments }
}

function tableLines(rows: readonly (readonly string[])[], aligns: readonly TableAlign[]): ViewLine[] {
  const grid = rows.map((row, rowIndex) =>
    row.map((text) => tableCell(text, rowIndex === 0 ? "table-header" : "assistant")),
  )
  const widths = tableWidths(aligns.map((_, column) => Math.max(...grid.map((row) => row[column]!.width))))
  const fitted = grid.map((row) => row.map((cell, column) => truncateCell(cell, widths[column]!)))
  const lines: ViewLine[] = [borderLine("┌", "┬", "┐", widths)]
  fitted.forEach((row, rowIndex) => {
    if (rowIndex === 1) lines.push(borderLine("├", "┼", "┤", widths))
    lines.push(tableRowLine(row, widths, aligns))
  })
  lines.push(borderLine("└", "┴", "┘", widths))
  return lines
}

function parseTable(source: readonly string[], start: number): ParsedTable | undefined {
  const header = splitRow(stripCr(source[start]!))
  if (header === undefined) return undefined
  const delimiter = source[start + 1]
  if (delimiter === undefined) return undefined
  const aligns = tableAlignments(stripCr(delimiter))
  if (aligns === undefined || aligns.length !== header.length) return undefined

  const rows: string[][] = [header]
  let next = start + 2
  while (next < source.length) {
    const line = stripCr(source[next]!)
    if (line.trim() === "") break
    const cells = splitRow(line)
    if (cells === undefined) break
    rows.push(fitRow(cells, header.length))
    next += 1
  }
  return { lines: tableLines(rows, aligns), next }
}

function fenceOpen(line: string): FenceOpen | undefined {
  const match = FENCE.exec(line)
  if (match === null) return undefined
  return { marker: match[1]!, lang: match[2]!.trim() }
}

function isFenceClose(line: string, fence: Fence): boolean {
  const info = fenceOpen(line)
  if (info === undefined) return false
  return info.marker[0] === fence.char && info.marker.length >= fence.size && info.lang === ""
}

function codeLine(line: string): ViewLine {
  return {
    segments: [
      { text: "│ ", style: "tool-meta" },
      { text: line, style: "code-block" },
    ],
  }
}

/** Markdown text as transcript lines, with syntax markers concealed. */
export function markdownLines(text: string): ViewLine[] {
  const lines: ViewLine[] = []
  const source = text.split("\n")
  let fence: Fence | undefined

  for (let index = 0; index < source.length; index += 1) {
    const line = stripCr(source[index]!)

    if (fence !== undefined) {
      if (isFenceClose(line, fence)) {
        fence = undefined
        continue
      }
      lines.push(codeLine(line))
      continue
    }

    const open = fenceOpen(line)
    if (open !== undefined) {
      fence = { char: open.marker[0]!, size: open.marker.length }
      // The fence itself is concealed; the language tag stays as a dim label.
      if (open.lang !== "") {
        lines.push({
          segments: [
            { text: "│ ", style: "tool-meta" },
            { text: open.lang, style: "code-lang" },
          ],
        })
      }
      continue
    }

    const table = parseTable(source, index)
    if (table !== undefined) {
      lines.push(...table.lines)
      index = table.next - 1
      continue
    }

    lines.push(...blockLine(line))
  }

  return lines
}
