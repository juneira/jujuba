import { createHash } from "node:crypto"

export interface FingerprintEntry {
  readonly path: string
  readonly content: string
}

function compare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * Stable, order-independent hash of the build inputs. Used as the sandbox
 * image tag and to decide whether the previous build is still current.
 */
export function fingerprint(entries: readonly FingerprintEntry[]): string {
  const hash = createHash("sha256")
  for (const entry of [...entries].sort((left, right) => compare(left.path, right.path))) {
    hash.update(entry.path)
    hash.update("\0")
    hash.update(entry.content)
    hash.update("\0")
  }
  return hash.digest("hex").slice(0, 12)
}
