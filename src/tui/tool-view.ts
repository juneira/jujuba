export type ToolStatus = "running" | "done" | "error"

export type ToolChangeStatus = "added" | "modified" | "deleted"

export type DiffLineKind = "add" | "del" | "context" | "hunk"

export interface DiffLine {
  readonly kind: DiffLineKind
  /** The unified-diff line, including its `+`, `-`, space, or `@@` prefix. */
  readonly text: string
}

export interface ToolChange {
  readonly path: string
  readonly status: ToolChangeStatus
  /** Diff lines kept for display; the rest is reported through `elided`. */
  readonly lines: readonly DiffLine[]
  readonly additions: number
  readonly deletions: number
  readonly elided: number
}

export interface ToolView {
  readonly name: string
  readonly summary: string
  readonly status: ToolStatus
  readonly output?: string
  readonly changes: readonly ToolChange[]
}

/** Keeps one tool call's diff bounded even when a write is very large. */
export const MAX_TOOL_DIFF_LINES = 400
/** Above this many LCS cells a block is shown as all removals then all additions. */
export const MAX_LCS_CELLS = 250_000

const SAMPLE_LIMIT = 80

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stringField(input: unknown, field: string): string | undefined {
  if (!isRecord(input)) return undefined
  const value = input[field]
  return typeof value === "string" ? value : undefined
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]!
  return line.length > SAMPLE_LIMIT ? `${line.slice(0, SAMPLE_LIMIT - 1)}…` : line
}

function splitLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

function diffCore(before: readonly string[], after: readonly string[]): DiffLine[] {
  const rows = before.length
  const columns = after.length
  if (rows === 0) return after.map((line): DiffLine => ({ kind: "add", text: `+${line}` }))
  if (columns === 0) return before.map((line): DiffLine => ({ kind: "del", text: `-${line}` }))
  if (rows * columns > MAX_LCS_CELLS) {
    return [
      ...before.map((line): DiffLine => ({ kind: "del", text: `-${line}` })),
      ...after.map((line): DiffLine => ({ kind: "add", text: `+${line}` })),
    ]
  }

  const width = columns + 1
  const lengths = new Int32Array((rows + 1) * width)
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const index = row * width + column
      const below = (row + 1) * width + column
      lengths[index] =
        before[row] === after[column]
          ? lengths[below + 1]! + 1
          : Math.max(lengths[below]!, lengths[index + 1]!)
    }
  }

  const lines: DiffLine[] = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      lines.push({ kind: "context", text: ` ${before[row]!}` })
      row += 1
      column += 1
    } else if (lengths[(row + 1) * width + column]! >= lengths[row * width + column + 1]!) {
      lines.push({ kind: "del", text: `-${before[row]!}` })
      row += 1
    } else {
      lines.push({ kind: "add", text: `+${after[column]!}` })
      column += 1
    }
  }
  for (; row < rows; row += 1) lines.push({ kind: "del", text: `-${before[row]!}` })
  for (; column < columns; column += 1) lines.push({ kind: "add", text: `+${after[column]!}` })
  return lines
}

/** A line diff of two text blocks; common lines stay as context. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)

  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const oldEnd = oldLines.length - suffix
  const newEnd = newLines.length - suffix
  const head = oldLines.slice(0, prefix).map((line): DiffLine => ({ kind: "context", text: ` ${line}` }))
  const body = diffCore(oldLines.slice(prefix, oldEnd), newLines.slice(prefix, newEnd))
  const tail =
    suffix === 0
      ? []
      : oldLines.slice(oldEnd).map((line): DiffLine => ({ kind: "context", text: ` ${line}` }))
  return [...head, ...body, ...tail]
}

function count(lines: readonly DiffLine[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (line.kind === "add") additions += 1
    if (line.kind === "del") deletions += 1
  }
  return { additions, deletions }
}

function change(path: string, status: ToolChangeStatus, lines: readonly DiffLine[]): ToolChange {
  const totals = count(lines)
  const shown = lines.length > MAX_TOOL_DIFF_LINES ? lines.slice(0, MAX_TOOL_DIFF_LINES) : lines
  return {
    path,
    status,
    lines: shown,
    additions: totals.additions,
    deletions: totals.deletions,
    elided: lines.length - shown.length,
  }
}

function writeChange(input: unknown): ToolChange[] {
  const path = stringField(input, "path")
  const content = stringField(input, "content")
  if (path === undefined || content === undefined) return []
  const body = splitLines(content).map((line): DiffLine => ({ kind: "add", text: `+${line}` }))
  const header: DiffLine = { kind: "hunk", text: `@@ -0,0 +1,${body.length} @@` }
  return [change(path, "added", [header, ...body])]
}

function editChange(input: unknown): ToolChange[] {
  const path = stringField(input, "path")
  const before = stringField(input, "oldString")
  const after = stringField(input, "newString")
  if (path === undefined || before === undefined || after === undefined) return []
  return [change(path, "modified", lineDiff(before, after))]
}

function diffPath(raw: string): string {
  const tab = raw.indexOf("\t")
  return (tab === -1 ? raw : raw.slice(0, tab)).trim()
}

function stripPrefix(path: string): string {
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path
}

function gitHint(line: string): string {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
  return match?.[2] ?? line.slice("diff --git ".length)
}

interface ToolSection {
  hint?: string
  oldPath?: string
  newPath?: string
  readonly lines: DiffLine[]
}

function hunkCounts(line: string): { old: number; next: number } {
  const match = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line)
  return {
    old: match?.[1] === undefined ? 1 : Number(match[1]),
    next: match?.[2] === undefined ? 1 : Number(match[2]),
  }
}

function patchSectionChange(section: ToolSection): ToolChange | undefined {
  const target = section.newPath ?? section.oldPath ?? section.hint
  if (target === undefined) return undefined
  if (target === "/dev/null" && section.oldPath === undefined) return undefined
  const status: ToolChangeStatus =
    section.newPath === "/dev/null" ? "deleted" : section.oldPath === "/dev/null" ? "added" : "modified"
  const path = target === "/dev/null" ? section.oldPath! : target
  return change(path, status, section.lines)
}

function rawDiffLines(lines: readonly string[]): DiffLine[] {
  return lines.flatMap((line): DiffLine[] => {
    if (line.startsWith("@@")) return [{ kind: "hunk", text: line }]
    if (line.startsWith("+++") || line.startsWith("---")) return []
    if (line.startsWith("+")) return [{ kind: "add", text: line }]
    if (line.startsWith("-")) return [{ kind: "del", text: line }]
    if (line.startsWith(" ")) return [{ kind: "context", text: line }]
    return []
  })
}

/** Splits a unified diff into one change per file and keeps hunk line numbers. */
export function patchChanges(input: unknown): ToolChange[] {
  const patch = stringField(input, "patch")
  if (patch === undefined) return []

  const sections: ToolSection[] = []
  let current: ToolSection | undefined
  let remainingOld = 0
  let remainingNew = 0
  let inHunk = false

  const finishHunk = (): void => {
    if (remainingOld <= 0 && remainingNew <= 0) inHunk = false
  }

  const begin = (hint?: string): ToolSection => {
    const section: ToolSection = { ...(hint === undefined ? {} : { hint }), lines: [] }
    sections.push(section)
    return section
  }

  for (const line of patch.split("\n")) {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line
    if (text.startsWith("diff --git ")) {
      current = begin(gitHint(text))
      inHunk = false
      continue
    }
    if (!inHunk && text.startsWith("--- ")) {
      if (current === undefined || current.oldPath !== undefined || current.newPath !== undefined) {
        current = begin()
      }
      current.oldPath = stripPrefix(diffPath(text.slice(4)))
      continue
    }
    if (!inHunk && text.startsWith("+++ ")) {
      if (current === undefined) current = begin()
      current.newPath = stripPrefix(diffPath(text.slice(4)))
      continue
    }
    if (text.startsWith("@@")) {
      if (current === undefined) current = begin()
      const counts = hunkCounts(text)
      remainingOld = counts.old
      remainingNew = counts.next
      current.lines.push({ kind: "hunk", text })
      inHunk = remainingOld > 0 || remainingNew > 0
      continue
    }
    if (!inHunk) continue
    if (text.startsWith("+")) {
      current!.lines.push({ kind: "add", text })
      remainingNew -= 1
      finishHunk()
      continue
    }
    if (text.startsWith("-")) {
      current!.lines.push({ kind: "del", text })
      remainingOld -= 1
      finishHunk()
      continue
    }
    if (text.startsWith("\\")) continue
    current!.lines.push({ kind: "context", text })
    remainingOld -= 1
    remainingNew -= 1
    finishHunk()
  }

  const changes = sections
    .map(patchSectionChange)
    .filter((candidate): candidate is ToolChange => candidate !== undefined)
  if (changes.length > 0) return changes
  const fallback = rawDiffLines(patch.split("\n"))
  return fallback.length === 0 ? [] : [change("patch", "modified", fallback)]
}

/** A short argument preview for the tool header, without dumping whole inputs. */
export function toolSummary(name: string, input: unknown): string {
  switch (name) {
    case "shell": {
      const command = stringField(input, "command")
      return command === undefined ? "" : firstLine(command)
    }
    case "read":
    case "write":
    case "edit":
    case "list":
      return stringField(input, "path") ?? ""
    case "glob":
      return stringField(input, "pattern") ?? ""
    case "grep":
      return stringField(input, "pattern") ?? ""
    case "patch": {
      const patch = stringField(input, "patch")
      if (patch === undefined) return ""
      const files = (patch.match(/^diff --git /gm) ?? []).length
      const headers = files === 0 ? (patch.match(/^--- /gm) ?? []).length : files
      return headers === 0 ? "unified diff" : `${headers} file${headers === 1 ? "" : "s"}`
    }
    default: {
      if (!isRecord(input)) return typeof input === "string" ? firstLine(input) : ""
      for (const value of Object.values(input)) {
        if (typeof value === "string" && value !== "") return firstLine(value)
      }
      return ""
    }
  }
}

/** File changes a tool call implies, derived from the call's input. */
export function toolChanges(name: string, input: unknown): ToolChange[] {
  switch (name) {
    case "write":
      return writeChange(input)
    case "edit":
      return editChange(input)
    case "patch":
      return patchChanges(input)
    default:
      return []
  }
}
