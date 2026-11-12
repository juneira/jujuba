import { stripAnsi } from "./ansi.js"
import { markdownLines } from "./markdown.js"
import type { DiffLineKind, ToolChange, ToolStatus, ToolView } from "./tool-view.js"
import type { TuiEntry, ShellView, TuiState } from "./view-model.js"

export type ViewStyle =
  | "user"
  | "assistant"
  | "tool-name"
  | "tool-args"
  | "tool-meta"
  | "file-header"
  | "diff-added"
  | "diff-removed"
  | "diff-hunk"
  | "diff-context"
  | "output"
  | "info"
  | "error"
  | "heading"
  | "strong"
  | "emphasis"
  | "strong-emphasis"
  | "strike"
  | "inline-code"
  | "link"
  | "quote"
  | "list-marker"
  | "rule"
  | "code-block"
  | "code-lang"
  | "table-border"
  | "table-header"

export interface ViewSegment {
  readonly text: string
  readonly style: ViewStyle
}

export interface ViewLine {
  readonly segments: readonly ViewSegment[]
}

/** Visible diff lines per file; the rest is summarized in the transcript. */
export const MAX_DISPLAY_DIFF_LINES = 30
/** Visible tool output lines; shell keeps its tail, everything else its head. */
export const MAX_DISPLAY_OUTPUT_LINES = 15

function line(text: string, style: ViewStyle): ViewLine {
  return { segments: [{ text, style }] }
}

function splitBody(text: string): string[] {
  return text.split("\n")
}

function prefixedLines(prefix: string, body: readonly string[], style: ViewStyle): ViewLine[] {
  return body.map((part, index) =>
    index === 0
      ? { segments: [{ text: prefix, style }, { text: part, style }] }
      : line(`  ${part}`, style),
  )
}

function diffStyle(kind: DiffLineKind): ViewStyle {
  switch (kind) {
    case "add":
      return "diff-added"
    case "del":
      return "diff-removed"
    case "hunk":
      return "diff-hunk"
    case "context":
      return "diff-context"
  }
}

function stats(changes: readonly ToolChange[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    additions += change.additions
    deletions += change.deletions
  }
  return { additions, deletions }
}

function nameStyle(tool: ToolView): ViewStyle {
  return tool.status === "error" ? "error" : "tool-name"
}

function statusMarker(status: { readonly status: ToolStatus }): string {
  if (status.status === "error") return "✖"
  return status.status === "running" ? "○" : "✔"
}

function statusStyle(status: { readonly status: ToolStatus }): ViewStyle {
  if (status.status === "error") return "error"
  return status.status === "running" ? "tool-meta" : "tool-name"
}

function toolHeader(tool: ToolView): ViewLine {
  const segments: ViewSegment[] = [
    { text: "▌ ", style: nameStyle(tool) },
    { text: tool.name, style: nameStyle(tool) },
  ]
  if (tool.summary !== "") {
    segments.push({ text: "  ", style: "tool-args" }, { text: tool.summary, style: "tool-args" })
  }
  const totals = stats(tool.changes)
  if (totals.additions > 0 || totals.deletions > 0) {
    segments.push({ text: `  +${totals.additions} −${totals.deletions}`, style: "tool-meta" })
  }
  segments.push({ text: `  ${statusMarker(tool)}`, style: statusStyle(tool) })
  return { segments }
}

function changeLines(change: ToolChange): ViewLine[] {
  const lines: ViewLine[] = [line(`  ┌ ${change.status} ${change.path}`, "file-header")]
  const shown = change.lines.slice(0, MAX_DISPLAY_DIFF_LINES)
  for (const diff of shown) {
    lines.push({ segments: [{ text: "  │ ", style: "tool-meta" }, { text: diff.text, style: diffStyle(diff.kind) }] })
  }
  const hidden = change.elided + (change.lines.length - shown.length)
  if (hidden > 0) lines.push(line(`  │ … ${hidden} more line${hidden === 1 ? "" : "s"}`, "tool-meta"))
  lines.push(line("  └", "tool-meta"))
  return lines
}

function outputLinesFor(output: string | undefined, tail: boolean): ViewLine[] {
  if (output === undefined || output === "") return []
  const body = splitBody(stripAnsi(output))
  const over = body.length > MAX_DISPLAY_OUTPUT_LINES
  const shown = over
    ? tail
      ? body.slice(-MAX_DISPLAY_OUTPUT_LINES)
      : body.slice(0, MAX_DISPLAY_OUTPUT_LINES)
    : body
  const lines = shown.map((part): ViewLine => line(`  ${part}`, "output"))
  const hidden = body.length - shown.length
  if (hidden > 0) {
    const summary = line(`  … ${hidden} more line${hidden === 1 ? "" : "s"}`, "tool-meta")
    if (tail) lines.unshift(summary)
    else lines.push(summary)
  }
  return lines
}

function outputLines(tool: ToolView): ViewLine[] {
  return outputLinesFor(tool.output, tool.name === "shell")
}

function shellHeader(shell: ShellView): ViewLine {
  const style: ViewStyle = shell.status === "error" ? "error" : "tool-name"
  const segments: ViewSegment[] = [
    { text: "▌ ", style },
    { text: "$ ", style: "tool-name" },
    { text: shell.command, style: "tool-args" },
  ]
  segments.push({ text: `  ${statusMarker(shell)}`, style: statusStyle(shell) })
  return { segments }
}

function shellLines(entry: TuiEntry): ViewLine[] {
  const shell = entry.shell
  if (shell === undefined) {
    return splitBody(stripAnsi(entry.text)).map((part, index) =>
      line(`  ${part}`, index === 0 ? "tool-name" : "output"),
    )
  }
  const lines = [shellHeader(shell)]
  lines.push(...outputLinesFor(shell.output, true))
  return lines
}

function toolLines(entry: TuiEntry): ViewLine[] {
  const tool = entry.tool
  if (tool === undefined) {
    return splitBody(stripAnsi(entry.text)).map((part, index) =>
      line(`  ${part}`, index === 0 ? "tool-name" : "output"),
    )
  }
  const lines = [toolHeader(tool)]
  for (const change of tool.changes) lines.push(...changeLines(change))
  if (tool.changes.length === 0) lines.push(...outputLines(tool))
  return lines
}

function entryLines(entry: TuiEntry): ViewLine[] {
  if (entry.tool !== undefined) return toolLines(entry)
  switch (entry.kind) {
    case "user":
      return prefixedLines("> ", splitBody(entry.text), "user")
    case "error":
      return prefixedLines("! ", splitBody(entry.text), "error")
    case "info":
      return prefixedLines("· ", splitBody(entry.text), "info")
    case "tool":
      return toolLines(entry)
    case "shell":
      return shellLines(entry)
    case "assistant":
      return markdownLines(stripAnsi(entry.text))
  }
}

/** The whole transcript as styled lines. Pure, so it is unit tested directly. */
export function viewLines(state: TuiState): ViewLine[] {
  return state.entries.flatMap(entryLines)
}

export function viewLineText(line: ViewLine): string {
  return line.segments.map((segment) => segment.text).join("")
}

export function transcriptText(state: TuiState): string[] {
  return viewLines(state).map(viewLineText)
}
