import { readFileSync } from "node:fs"
import path from "node:path"

/** What the local runners forward to the sandbox through the worker env. */
export interface LocalSshEnvironment {
  readonly keyBase64?: string
  readonly knownHostsBase64?: string
  /** Only for a diagnostic line; never the key itself. */
  readonly keyPath?: string
}

const DEFAULT_KEYS = ["id_ed25519", "id_ecdsa", "id_rsa"] as const

function readBase64(file: string): string | undefined {
  try {
    return Buffer.from(readFileSync(file)).toString("base64")
  } catch {
    return undefined
  }
}

function readPrivateKey(file: string): string | undefined {
  try {
    const text = readFileSync(file, "utf8")
    if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return undefined
    return Buffer.from(text, "utf8").toString("base64")
  } catch {
    return undefined
  }
}

/**
 * Finds the host's SSH material for local runs. An explicit SSH_KEY_BASE64 in
 * the environment wins; otherwise SSH_KEY_PATH or the usual identity names are
 * tried. The key is only returned base64-encoded and is never logged.
 */
export function loadSshEnvironment(
  home: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): LocalSshEnvironment {
  const explicitKey = env.SSH_KEY_BASE64
  let keyBase64 =
    explicitKey === undefined || explicitKey === "" ? undefined : explicitKey
  let keyPath: string | undefined

  if (keyBase64 === undefined) {
    const requested = env.SSH_KEY_PATH
    const candidates =
      requested === undefined || requested === ""
        ? DEFAULT_KEYS.map((name) => path.join(home, ".ssh", name))
        : [requested]
    for (const candidate of candidates) {
      const encoded = readPrivateKey(candidate)
      if (encoded !== undefined) {
        keyBase64 = encoded
        keyPath = candidate
        break
      }
    }
  }

  const explicitKnownHosts = env.SSH_KNOWN_HOSTS_BASE64
  const knownHostsBase64 =
    explicitKnownHosts === undefined || explicitKnownHosts === ""
      ? readBase64(env.SSH_KNOWN_HOSTS_PATH ?? path.join(home, ".ssh", "known_hosts"))
      : explicitKnownHosts

  return {
    ...(keyBase64 === undefined ? {} : { keyBase64 }),
    ...(knownHostsBase64 === undefined ? {} : { knownHostsBase64 }),
    ...(keyPath === undefined ? {} : { keyPath }),
  }
}