import { parseAgentName, parseSessionId } from "../agent/naming.js"
import type { AgentStub } from "../agent/types.js"
import { parseGitRemote, parseProjectName } from "../projects/naming.js"

export interface HandlerDeps {
  readonly getAgent: (name: string) => AgentStub
  readonly authToken?: string
}

const MAX_PROMPT_CHARS = 100_000

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status })
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json()
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object")
  }
  return parsed as Record<string, unknown>
}

function authorized(request: Request, token: string | undefined): boolean {
  if (token === undefined || token === "") return true
  return request.headers.get("authorization") === `Bearer ${token}`
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value
}

function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a number`)
  return value
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value
}

export async function handleRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === "/health") {
    return json({ ok: true })
  }

  if (!authorized(request, deps.authToken)) {
    return error("unauthorized", 401)
  }

  try {
    if (url.pathname === "/api/prompt" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      const session = parseSessionId(body.session)
      if (typeof body.text !== "string" || body.text.trim() === "") {
        return error("text is required")
      }
      if (body.text.length > MAX_PROMPT_CHARS) {
        return error(`text is limited to ${MAX_PROMPT_CHARS} characters`, 413)
      }
      return json(await deps.getAgent(agent).prompt(body.text, session))
    }

    if (url.pathname === "/api/abort" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      const session = parseSessionId(body.session)
      return json({ aborted: await deps.getAgent(agent).abort(session) })
    }

    if (url.pathname === "/api/sessions" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      return json({ sessions: await deps.getAgent(agent).sessions() })
    }

    if (url.pathname === "/api/sessions/new" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      return json({ session: await deps.getAgent(agent).createSession() })
    }

    if (url.pathname === "/api/sessions/all" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      return json(await deps.getAgent(agent).allSessions())
    }

    if (url.pathname === "/api/projects" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      return json({ projects: await deps.getAgent(agent).projects() })
    }

    if (url.pathname === "/api/projects/new" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      const name = parseProjectName(stringField(body, "name"))
      const rawRemote = optionalString(body, "remote")
      const remote = rawRemote === undefined ? undefined : parseGitRemote(rawRemote)
      return json({ project: await deps.getAgent(agent).createProject(name, remote) })
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      const agent = parseAgentName(url.searchParams.get("agent") ?? undefined)
      const session = parseSessionId(url.searchParams.get("session") ?? undefined)
      return json(await deps.getAgent(agent).state(session))
    }

    if (url.pathname === "/api/sandbox/status" && request.method === "GET") {
      const agent = parseAgentName(url.searchParams.get("agent") ?? undefined)
      return json(await deps.getAgent(agent).sandboxStatus())
    }

    if (url.pathname === "/api/sandbox/save" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      return json(await deps.getAgent(agent).sandboxSave())
    }

    if (url.pathname === "/api/sandbox/reset" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      await deps.getAgent(agent).sandboxReset()
      return json({ ok: true })
    }

    if (url.pathname === "/api/sandbox/read" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      const path = stringField(body, "path")
      const offset = optionalNumber(body, "offset")
      const limit = optionalNumber(body, "limit")
      return json(await deps.getAgent(agent).sandboxRead(path, offset, limit))
    }

    if (url.pathname === "/api/sandbox/write" && request.method === "POST") {
      const body = await readJson(request)
      const agent = parseAgentName(body.agent)
      const path = stringField(body, "path")
      const content = stringField(body, "content")
      return json(await deps.getAgent(agent).sandboxWrite(path, content))
    }

    if (url.pathname === "/api/ws") {
      const agent = parseAgentName(url.searchParams.get("agent") ?? undefined)
      if (request.headers.get("upgrade") !== "websocket") {
        return error("expected a websocket upgrade", 426)
      }
      return deps.getAgent(agent).fetch(request)
    }

    return error("not found", 404)
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "request failed")
  }
}
