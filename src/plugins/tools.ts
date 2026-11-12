import { Plugin } from "@opencode/plugin"
import type { Sandbox } from "../sandbox/backend.js"
import { formatExec } from "../sandbox/output.js"
import type { GlobResult, GrepResult, ListResult, ReadFileResult } from "../sandbox/types.js"

export { formatExec }

/** Built-in OpenCode tools that need a local filesystem or process. */
export const LOCAL_TOOL_NAMES = ["read", "write", "edit", "patch", "glob", "grep", "shell", "list"] as const

export const SANDBOX_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "patch",
  "glob",
  "grep",
  "list",
  "shell",
] as const

export function formatRead(result: ReadFileResult, offset = 1): string {
  const lines = result.content === "" ? [] : result.content.split("\n")
  const first = lines.length === 0 ? offset : offset
  const last = lines.length === 0 ? offset : offset + lines.length - 1
  const header = `${result.path} (lines ${first}-${last} of ${result.totalLines})`
  const body = lines.map((line, index) => `${String(first + index).padStart(6, " ")}| ${line}`).join("\n")
  const suffix = result.truncated ? "\n[truncated; pass offset to read more]" : ""
  return `${header}\n${body}${suffix}`
}

export function formatGlob(result: GlobResult): string {
  if (result.paths.length === 0) return "No files matched."
  const suffix = result.truncated ? "\n[truncated]" : ""
  return `${result.paths.join("\n")}${suffix}`
}

export function formatGrep(result: GrepResult): string {
  if (result.matches.length === 0) return "No matches."
  const suffix = result.truncated ? "\n[truncated]" : ""
  return `${result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join("\n")}${suffix}`
}

export function formatList(result: ListResult): string {
  if (result.entries.length === 0) return `${result.path} is empty.`
  return result.entries
    .map((entry) => (entry.type === "dir" ? `${entry.name}/` : entry.type === "symlink" ? `${entry.name}@` : `${entry.name} (${entry.size} bytes)`))
    .join("\n")
}

function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value
}

function numberField(input: Record<string, unknown>, field: string): number | undefined {
  const value = input[field]
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a number`)
  return value
}

function objectField(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool input must be an object")
  }
  return input as Record<string, unknown>
}

export interface SandboxTool {
  readonly name: string
  readonly description: string
  readonly input: Record<string, unknown>
  readonly run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<string>
}

export function sandboxToolDefinitions(client: Sandbox): SandboxTool[] {
  return [
    {
      name: "read",
      description:
        "Read a text file from /workspace. Returns numbered lines. Use offset and limit to page through large files.",
      input: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path such as /workspace/src/index.ts" },
          offset: { type: "number", description: "First line to read, 1-based" },
          limit: { type: "number", description: "Maximum number of lines" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      async run(input, signal) {
        const offset = numberField(input, "offset")
        const limit = numberField(input, "limit")
        const result = await client.read(
          stringField(input, "path"),
          { ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) },
          signal,
        )
        return formatRead(result, offset ?? 1)
      },
    },
    {
      name: "write",
      description: "Create or overwrite a file in /workspace. Parent directories are created automatically.",
      input: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      async run(input, signal) {
        const result = await client.write(
          stringField(input, "path"),
          stringField(input, "content"),
          signal,
        )
        return `Wrote ${result.bytes} bytes to ${result.path}`
      },
    },
    {
      name: "edit",
      description:
        "Replace an exact string in a file. Fails when oldString is missing or appears more than once, unless replaceAll is true.",
      input: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldString: { type: "string" },
          newString: { type: "string" },
          replaceAll: { type: "boolean" },
        },
        required: ["path", "oldString", "newString"],
        additionalProperties: false,
      },
      async run(input, signal) {
        const result = await client.edit(
          stringField(input, "path"),
          stringField(input, "oldString"),
          stringField(input, "newString"),
          input.replaceAll === true,
          signal,
        )
        return `Replaced ${result.replacements} occurrence${result.replacements === 1 ? "" : "s"} in ${result.path}`
      },
    },
    {
      name: "patch",
      description: "Apply a unified diff to the files in /workspace.",
      input: {
        type: "object",
        properties: {
          patch: { type: "string", description: "A unified diff" },
        },
        required: ["patch"],
        additionalProperties: false,
      },
      async run(input, signal) {
        const result = await client.patch(stringField(input, "patch"), signal)
        return result.output
      },
    },
    {
      name: "glob",
      description: "Find files in /workspace by glob, such as **/*.ts or src/**/*.test.ts.",
      input: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          cwd: { type: "string", description: "Directory to search from. Default /workspace." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
      async run(input, signal) {
        const result = await client.glob(stringField(input, "pattern"), input.cwd as string | undefined, signal)
        return formatGlob(result)
      },
    },
    {
      name: "grep",
      description: "Search file contents in /workspace with a regular expression.",
      input: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "File or directory to search. Default /workspace." },
          glob: { type: "string", description: "Only search paths matching this glob." },
          ignoreCase: { type: "boolean" },
          limit: { type: "number" },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
      async run(input, signal) {
        const result = await client.grep(
          stringField(input, "pattern"),
          {
            ...(typeof input.path === "string" ? { path: input.path } : {}),
            ...(typeof input.glob === "string" ? { glob: input.glob } : {}),
            ...(typeof input.ignoreCase === "boolean" ? { ignoreCase: input.ignoreCase } : {}),
            ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
          },
          signal,
        )
        return formatGrep(result)
      },
    },
    {
      name: "list",
      description: "List one directory in /workspace.",
      input: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory to list. Default /workspace." },
        },
        additionalProperties: false,
      },
      async run(input, signal) {
        const result = await client.list(
          typeof input.path === "string" ? input.path : "/workspace",
          signal,
        )
        return formatList(result)
      },
    },
    {
      name: "shell",
      description:
        "Run a command with bash in the sandbox. Use it to build, test, and inspect the project. The working directory defaults to /workspace.",
      input: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command line passed to bash -lc" },
          cwd: { type: "string", description: "Working directory. Default /workspace." },
          timeoutMs: { type: "number", description: "Timeout in milliseconds" },
        },
        required: ["command"],
        additionalProperties: false,
      },
      async run(input, signal) {
        const result = await client.exec(stringField(input, "command"), {
          ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
          ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
          signal,
        })
        return formatExec(result)
      },
    },
  ]
}

export function sandboxTools(client: Sandbox): Plugin.Plugin {
  return Plugin.define({
    id: "sandbox-tools",
    async setup(ctx) {
      const tools = sandboxToolDefinitions(client)
      await ctx.tool.transform((editor) => {
        for (const name of LOCAL_TOOL_NAMES) {
          editor.remove(name)
        }
        for (const tool of tools) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.input,
            options: { codemode: false },
            async execute(input, context) {
              return { content: await tool.run(objectField(input), context.signal) }
            },
          })
        }
      })
    },
  })
}
