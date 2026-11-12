import { createServer } from "node:net"

/** True when nothing is already listening on `127.0.0.1:<port>`. */
export function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => {
      resolve(false)
    })
    server.once("listening", () => {
      server.close(() => {
        resolve(true)
      })
    })
    server.listen(port, "127.0.0.1")
  })
}
