import { runCommand } from "./command.js"

export async function dockerReady(): Promise<boolean> {
  try {
    const result = await runCommand("docker", ["info", "--format", "{{.ServerVersion}}"])
    return result.code === 0
  } catch {
    return false
  }
}

export async function dockerImageExists(tag: string): Promise<boolean> {
  try {
    const result = await runCommand("docker", ["image", "inspect", tag])
    return result.code === 0
  } catch {
    return false
  }
}
