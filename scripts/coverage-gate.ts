import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

interface FileCoverage {
  lines: Map<number, number>
  functions: number
  functionsHit: number
  branches: number
  branchesHit: number
}

const INPUTS = ["coverage/vitest/lcov.info", "coverage/lcov.info"]
const OUTPUT = "coverage/lcov.info"

function parse(text: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>()
  let current: { file: string; coverage: FileCoverage } | undefined

  const flush = (): void => {
    if (current === undefined) return
    const existing = files.get(current.file)
    if (existing === undefined) {
      files.set(current.file, current.coverage)
      return
    }
    for (const [line, count] of current.coverage.lines) {
      existing.lines.set(line, Math.max(existing.lines.get(line) ?? 0, count))
    }
    existing.functions = Math.max(existing.functions, current.coverage.functions)
    existing.functionsHit = Math.max(existing.functionsHit, current.coverage.functionsHit)
    existing.branches = Math.max(existing.branches, current.coverage.branches)
    existing.branchesHit = Math.max(existing.branchesHit, current.coverage.branchesHit)
  }

  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.startsWith("SF:")) {
      flush()
      current = {
        file: line.slice(3),
        coverage: { lines: new Map(), functions: 0, functionsHit: 0, branches: 0, branchesHit: 0 },
      }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith("DA:")) {
      const [lineNumber, count] = line.slice(3).split(",")
      if (lineNumber === undefined || count === undefined) continue
      const number = Number(lineNumber)
      const value = Number(count)
      if (Number.isNaN(number) || Number.isNaN(value)) continue
      current.coverage.lines.set(number, Math.max(current.coverage.lines.get(number) ?? 0, value))
      continue
    }
    if (line.startsWith("FNF:")) current.coverage.functions = Number(line.slice(4))
    if (line.startsWith("FNH:")) current.coverage.functionsHit = Number(line.slice(4))
    if (line.startsWith("BRF:")) current.coverage.branches = Number(line.slice(4))
    if (line.startsWith("BRH:")) current.coverage.branchesHit = Number(line.slice(4))
    if (line === "end_of_record") flush()
  }
  flush()
  return files
}

function render(files: Map<string, FileCoverage>): string {
  const chunks: string[] = []
  for (const [file, coverage] of files) {
    const hit = [...coverage.lines.values()].filter((count) => count > 0).length
    chunks.push(`TN:\nSF:${file}`)
    for (const [line, count] of [...coverage.lines].sort((a, b) => a[0] - b[0])) {
      chunks.push(`DA:${line},${count}`)
    }
    chunks.push(`FNF:${coverage.functions}`)
    chunks.push(`FNH:${coverage.functionsHit}`)
    chunks.push(`LF:${coverage.lines.size}`)
    chunks.push(`LH:${hit}`)
    if (coverage.branches > 0) {
      chunks.push(`BRF:${coverage.branches}`)
      chunks.push(`BRH:${coverage.branchesHit}`)
    }
    chunks.push("end_of_record")
  }
  return `${chunks.join("\n")}\n`
}

const merged = new Map<string, FileCoverage>()
for (const input of INPUTS) {
  const text = await readFile(input, "utf8").catch(() => "")
  if (text === "") {
    console.warn(`[coverage] missing ${input}`)
    continue
  }
  for (const [file, coverage] of parse(text)) {
    // Vitest is authoritative for files it covers. Bun is only used for files
    // that Vitest excludes (the native TUI renderer), and its transitive
    // imports must not degrade the Vitest numbers.
    if (merged.has(file)) continue
    merged.set(file, coverage)
  }
}

const totals = {
  lines: 0,
  linesHit: 0,
  functions: 0,
  functionsHit: 0,
  branches: 0,
  branchesHit: 0,
}
for (const coverage of merged.values()) {
  totals.lines += coverage.lines.size
  totals.linesHit += [...coverage.lines.values()].filter((count) => count > 0).length
  totals.functions += coverage.functions
  totals.functionsHit += coverage.functionsHit
  totals.branches += coverage.branches
  totals.branchesHit += coverage.branchesHit
}

const percent = (hit: number, total: number): number => (total === 0 ? 100 : (hit / total) * 100)

const summary = {
  lines: percent(totals.linesHit, totals.lines),
  functions: percent(totals.functionsHit, totals.functions),
  branches: percent(totals.branchesHit, totals.branches),
  statements: percent(totals.linesHit, totals.lines),
}

console.log(`[coverage] merged ${merged.size} files`)
console.log(
  `[coverage] lines ${summary.lines.toFixed(2)}% functions ${summary.functions.toFixed(2)}% branches ${summary.branches.toFixed(2)}%`,
)

await writeFile(path.resolve(OUTPUT), render(merged))

const failed = Object.entries(summary).filter(([, value]) => value < 100)
if (failed.length > 0) {
  for (const [name, value] of failed) console.error(`[coverage] ${name} is ${value.toFixed(2)}%`)
  process.exit(1)
}
