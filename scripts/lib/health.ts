export interface HealthOptions {
  readonly timeoutMs?: number | undefined
  readonly stopped: () => boolean
}

/** Poll `/health` until the worker answers, the timeout expires, or it dies. */
export async function waitForHealth(url: string, options: HealthOptions): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 300_000)
  while (Date.now() < deadline) {
    if (options.stopped()) return false
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}
