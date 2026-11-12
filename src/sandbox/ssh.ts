import { SandboxError } from "./types.js"

export const SSH_DIR = "/root/.ssh"
export const SSH_KEY_PATH = `${SSH_DIR}/id_ed25519`
export const SSH_KNOWN_HOSTS_PATH = `${SSH_DIR}/known_hosts`
export const SSH_CONFIG_PATH = `${SSH_DIR}/config`

/**
 * The sandbox is a disposable root container. Installing a host key here makes
 * every git command inside it use that identity, not just project creation.
 */
export const SSH_CONFIG = `Host *
  IdentityFile ${SSH_KEY_PATH}
  StrictHostKeyChecking accept-new
  UserKnownHostsFile ${SSH_KNOWN_HOSTS_PATH}
`

export const SSH_PERMISSIONS_COMMAND =
  `chmod 700 ${SSH_DIR} && chmod 600 ${SSH_CONFIG_PATH}` +
  ` && (test ! -f ${SSH_KEY_PATH} || chmod 600 ${SSH_KEY_PATH})` +
  ` && (test ! -f ${SSH_KNOWN_HOSTS_PATH} || chmod 600 ${SSH_KNOWN_HOSTS_PATH})`

/** Decodes base64 from an env var without ever exposing the key in a command. */
export function decodeBase64(value: string, label = "SSH key"): string {
  const compact = value.replace(/\s+/g, "")
  if (compact === "") throw new SandboxError(`${label} is empty`, 500, "ssh_key_invalid")
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new SandboxError(`${label} is not valid base64`, 500, "ssh_key_invalid")
  }
  try {
    const binary = atob(compact)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    throw new SandboxError(`${label} is not valid base64`, 500, "ssh_key_invalid")
  }
}

/** Accepts the usual PEM/OpenSSH private-key formats and keeps a final newline. */
export function normalizePrivateKey(value: string): string {
  const key = value.trim()
  if (!/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(key)) {
    throw new SandboxError("SSH private key is not a PEM or OpenSSH key", 500, "ssh_key_invalid")
  }
  return `${key}\n`
}

export function normalizeKnownHosts(value: string): string {
  return `${value.trim()}\n`
}
