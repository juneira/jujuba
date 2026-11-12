import { normalizeWorkspacePath, WORKSPACE } from "./paths.js"

export const DEFAULT_TIMEOUT_MS = 120_000
export const MAX_TIMEOUT_MS = 300_000
export const DEFAULT_READ_LINES = 500
export const MAX_READ_LINES = 2_000
export const MAX_READ_BYTES = 1_000_000

/** Keeps command timeouts inside the range the sandbox accepts. */
export function clampTimeout(timeoutMs: number | undefined): number {
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, timeoutMs ?? DEFAULT_TIMEOUT_MS))
}

/**
 * Validates a cwd and returns its container path. `/`, an empty value, and the
 * workspace aliases all mean `/workspace`.
 */
export function resolveWorkspaceCwd(cwd: string | undefined): string {
  if (cwd === undefined || cwd === "" || cwd === "/" || cwd === WORKSPACE || cwd === `${WORKSPACE}/`) {
    return WORKSPACE
  }
  return normalizeWorkspacePath(cwd)
}

/** Quotes a value for a POSIX shell command line. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Keeps the beginning and the end of a stream and reports how much was
 * dropped. Command output is untrusted and can be arbitrarily large, so it is
 * capped before it reaches the model.
 */
export class CappedText {
  readonly #headLimit: number
  readonly #tailLimit: number
  #head = ""
  #tail = ""
  #total = 0
  #dropped = false

  constructor(headLimit = 8_000, tailLimit = 16_000) {
    this.#headLimit = headLimit
    this.#tailLimit = tailLimit
  }

  push(chunk: string): void {
    this.#total += chunk.length
    let rest = chunk
    if (this.#head.length < this.#headLimit) {
      const room = this.#headLimit - this.#head.length
      this.#head += rest.slice(0, room)
      rest = rest.slice(room)
    }
    if (rest.length === 0) return
    this.#dropped = true
    this.#tail = (this.#tail + rest).slice(-this.#tailLimit)
  }

  get truncated(): boolean {
    return this.#dropped
  }

  value(): string {
    if (!this.#dropped) return this.#head
    const kept = this.#head.length + this.#tail.length
    return `${this.#head}\n… [${Math.max(0, this.#total - kept)} chars truncated] …\n${this.#tail}`
  }
}

/** Reads a byte stream and stops once `limit` bytes have been exceeded. */
export async function readLimited(
  stream: ReadableStream | null,
  limit: number,
): Promise<Uint8Array> {
  if (stream === null) return new Uint8Array()
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value as Uint8Array
      total += chunk.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error(`file is larger than ${limit} bytes`)
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return concatBytes(chunks, total)
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

/** Consumes a command stream through `CappedText`. */
export async function readCapped(stream: ReadableStream | null): Promise<CappedText> {
  const capped = new CappedText()
  if (stream === null) return capped
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      capped.push(decoder.decode(value as Uint8Array, { stream: true }))
    }
    capped.push(decoder.decode())
  } finally {
    reader.releaseLock()
  }
  return capped
}
