import { spawn } from "node:child_process"

export interface CommandResult {
  readonly code: number
  readonly stdout: string
}

export interface CommandOptions {
  readonly cwd?: string | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
  /** Stream the child's output to the terminal instead of capturing it. */
  readonly inheritStdio?: boolean | undefined
}

/** Run a command to completion. Rejects only when it cannot be spawned. */
export function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: { ...process.env, ...options.env },
      stdio: options.inheritStdio === true ? "inherit" : ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    // Drain stderr so a chatty child cannot fill its pipe and stall.
    child.stderr?.on("data", () => undefined)

    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout })
    })
  })
}
