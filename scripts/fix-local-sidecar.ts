import { startSidecarFixer } from "./local-sidecar-fix.js"

const fixer = startSidecarFixer((message) => console.log(message))

const stop = (): void => {
  fixer.stop()
  process.exit(0)
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

console.log("[sidecar] watching for local Cloudflare egress sidecars; Ctrl+C to stop")
