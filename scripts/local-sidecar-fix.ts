import { spawn } from "node:child_process"

/**
 * Local development workaround.
 *
 * workerd starts a `cloudflare/proxy-everything` sidecar for every container. On
 * some Docker/kernel combinations the sidecar's TPROXY rules also intercept its
 * own control port (39001) and break DNS/egress, so workerd cannot reach
 * `/ca` and `/egress` and the user container never starts
 * (`Container failed to start`).
 *
 * When internet is enabled (the default), the sidecar's egress interception is
 * not needed locally: the app container already reaches the network through
 * Docker's NAT. The watcher flushes the sidecar's mangle table, which fixes both
 * the control port and DNS. When `SANDBOX_INTERNET=false`, it only exempts the
 * control port so the sidecar keeps blocking egress.
 *
 * It also prefers IPv4 and a reachable resolver inside the app container, because
 * some Docker/host DNS configurations return IPv6 first and the local network has
 * no IPv6 egress.
 *
 * This is best effort and only runs while the dev process is alive.
 */

const CONTROL_PORT = "39001"
const CONTROL_PATCH = [
  `iptables -t mangle -C PREROUTING -p tcp --dport ${CONTROL_PORT} -j RETURN || iptables -t mangle -I PREROUTING 1 -p tcp --dport ${CONTROL_PORT} -j RETURN`,
  `iptables -t mangle -C OUTPUT -p tcp --sport ${CONTROL_PORT} -j RETURN || iptables -t mangle -I OUTPUT 1 -p tcp --sport ${CONTROL_PORT} -j RETURN`,
].join("; ")
const FLUSH_PATCH = "iptables -t mangle -F"
const APP_PATCH =
  "printf 'precedence ::ffff:0:0/96  100\\n' > /etc/gai.conf; " +
  "printf 'nameserver 8.8.8.8\\nnameserver 1.1.1.1\\n' > /etc/resolv.conf"
const APP_PATCH_NO_INTERNET = "printf 'precedence ::ffff:0:0/96  100\\n' > /etc/gai.conf"

const POLL_MS = 500

interface CommandResult {
  readonly code: number
  readonly stdout: string
}

function run(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] })
    let stdout = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => (stdout += chunk))
    child.on("error", () => resolve({ code: 1, stdout: "" }))
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }))
  })
}

export interface SidecarFixer {
  stop(): void
}

export function startSidecarFixer(log: (message: string) => void = () => undefined): SidecarFixer {
  const patchedSidecars = new Set<string>()
  const patchedApps = new Set<string>()
  const internet = process.env.SANDBOX_INTERNET !== "false"
  const sidecarPatch = internet ? FLUSH_PATCH : CONTROL_PATCH
  const appPatch = internet ? APP_PATCH : APP_PATCH_NO_INTERNET
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async (): Promise<void> => {
    if (stopped) return
    const listing = await run("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}"])
    if (listing.code === 0) {
      for (const line of listing.stdout.split("\n")) {
        const [name, image] = line.split("\t")
        if (name === undefined || image === undefined) continue
        if (!name.endsWith("-proxy") || !image.includes("proxy-everything")) continue

        if (!patchedSidecars.has(name)) {
          const result = await run("docker", ["exec", name, "sh", "-c", sidecarPatch])
          if (result.code === 0) {
            patchedSidecars.add(name)
            log(`[dev] patched local egress sidecar ${name}`)
          }
        }

        const app = name.slice(0, -"-proxy".length)
        if (!patchedApps.has(app)) {
          const result = await run("docker", ["exec", app, "sh", "-c", appPatch])
          if (result.code === 0) {
            patchedApps.add(app)
            log(`[dev] patched local sandbox DNS ${app}`)
          }
        }
      }
    }
    if (!stopped) timer = setTimeout(() => void tick(), POLL_MS)
  }

  void tick()

  return {
    stop(): void {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
