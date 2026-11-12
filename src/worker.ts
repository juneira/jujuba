import type { Env } from "./agent/env.js"
import { handleRequest } from "./worker/handler.js"

export { CodeAgent } from "./agent/durable.js"

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      getAgent: (name) => env.AGENT.getByName(name),
      ...(env.AUTH_TOKEN === undefined ? {} : { authToken: env.AUTH_TOKEN }),
    })
  },
}
