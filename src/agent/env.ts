import type { CodeAgent } from "./durable.js"

export interface Env {
  readonly AGENT: DurableObjectNamespace<CodeAgent>
  readonly OPENROUTER_API_KEY: string
  readonly OPENROUTER_MODEL: string
  readonly OPENROUTER_BASE_URL?: string
  readonly SANDBOX_INSTANCE?: string
  readonly SANDBOX_INTERNET?: string
  readonly SANDBOX_INACTIVITY_MS?: string
  readonly AUTH_TOKEN?: string
  /** Base64 of the private key installed in each sandbox for git over SSH. */
  readonly SSH_KEY_BASE64?: string
  /** Base64 of an optional known_hosts file installed with the key. */
  readonly SSH_KNOWN_HOSTS_BASE64?: string
}
