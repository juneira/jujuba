import { describe, expect, it, vi } from "vitest"
import type { AgentStub, PromptResult } from "../../src/agent/types.js"
import { handleRequest } from "../../src/worker/handler.js"

function stub(): AgentStub {
  return {
    prompt: vi.fn(async (): Promise<PromptResult> => ({ status: "done", text: "hi" })),
    abort: vi.fn(async () => true),
    sessions: vi.fn(async () => [{ id: "ses_root", busy: false }]),
    allSessions: vi.fn(async () => ({ sessions: [], errors: [] })),
    createSession: vi.fn(async () => ({ id: "ses_new", busy: false })),
    projects: vi.fn(async () => []),
    createProject: vi.fn(async (name: string) => ({ name, agent: "project-1" })),
    state: vi.fn(async () => ({ messages: [], busy: false, pending: [] })),
    sandboxStatus: vi.fn(async () => ({
      backend: "cloudflare" as const,
      running: true,
      image: "image",
      snapshotId: "snap",
    })),
    sandboxSave: vi.fn(async () => ({ id: "snap", size: 10 })),
    sandboxReset: vi.fn(async () => undefined),
    sandboxRead: vi.fn(async () => ({ path: "/workspace/a", content: "hi", totalLines: 1, truncated: false })),
    sandboxWrite: vi.fn(async () => ({ path: "/workspace/a", bytes: 2 })),
    sandboxExec: vi.fn(async () => ({
      exitCode: 0,
      stdout: "hi",
      stderr: "",
      truncated: false,
      durationMs: 1,
    })),
    fetch: vi.fn(async () => new Response("socket")),
  }
}

function setup(agent: AgentStub = stub(), token?: string) {
  const names: string[] = []
  return {
    agent,
    names,
    deps: {
      getAgent: (name: string) => {
        names.push(name)
        return agent
      },
      ...(token === undefined ? {} : { authToken: token }),
    },
  }
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://example.com${path}`, init)
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
}

describe("handleRequest", () => {
  it("serves health without auth", async () => {
    const { deps } = setup(stub(), "secret")
    const response = await handleRequest(request("/health"), deps)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it("enforces the optional bearer token", async () => {
    const { deps } = setup(stub(), "secret")
    expect((await handleRequest(request("/api/prompt", json({ agent: "a", text: "hi" })), deps)).status).toBe(401)
    const ok = await handleRequest(
      request("/api/prompt", {
        ...json({ agent: "a", text: "hi" }),
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
      }),
      deps,
    )
    expect(ok.status).toBe(200)
  })

  it("admits an empty configured token", async () => {
    const { deps } = setup(stub(), "")
    expect((await handleRequest(request("/api/prompt", json({ agent: "a", text: "hi" })), deps)).status).toBe(200)
  })

  it("prompts an agent", async () => {
    const { agent, deps, names } = setup()
    const response = await handleRequest(
      request("/api/prompt", json({ agent: "a", text: "hello", session: "ses_x" })),
      deps,
    )
    expect(names).toEqual(["a"])
    expect(await response.json()).toEqual({ status: "done", text: "hi" })
    expect(agent.prompt).toHaveBeenCalledWith("hello", "ses_x")
  })

  it("validates prompts", async () => {
    const { deps } = setup()
    expect((await handleRequest(request("/api/prompt", json({ agent: "a" })), deps)).status).toBe(400)
    expect((await handleRequest(request("/api/prompt", json({ agent: "a", text: "  " })), deps)).status).toBe(400)
    expect(
      (await handleRequest(request("/api/prompt", json({ agent: "a", text: "x".repeat(100_001) })), deps)).status,
    ).toBe(413)
    expect((await handleRequest(request("/api/prompt", json({ agent: "../a", text: "x" })), deps)).status).toBe(400)
    expect(
      (await handleRequest(request("/api/prompt", json({ agent: "a", text: "x", session: "nope" })), deps)).status,
    ).toBe(400)
    expect((await handleRequest(request("/api/prompt", { method: "POST", body: "{bad" }), deps)).status).toBe(400)
    expect((await handleRequest(request("/api/prompt", json([1])), deps)).status).toBe(400)
  })

  it("aborts a run", async () => {
    const { agent, deps } = setup()
    const response = await handleRequest(request("/api/abort", json({ agent: "a", session: "ses_x" })), deps)
    expect(await response.json()).toEqual({ aborted: true })
    expect(agent.abort).toHaveBeenCalledWith("ses_x")
  })

  it("lists sessions", async () => {
    const { deps } = setup()
    const response = await handleRequest(request("/api/sessions", json({ agent: "a" })), deps)
    expect(await response.json()).toEqual({ sessions: [{ id: "ses_root", busy: false }] })
  })

  it("creates a session", async () => {
    const { agent, deps } = setup()
    const response = await handleRequest(request("/api/sessions/new", json({ agent: "a" })), deps)
    expect(await response.json()).toEqual({ session: { id: "ses_new", busy: false } })
    expect(agent.createSession).toHaveBeenCalledTimes(1)
    expect((await handleRequest(request("/api/sessions/new", json({ agent: "../a" })), deps)).status).toBe(400)
  })

  it("lists and creates projects", async () => {
    const { agent, deps, names } = setup()
    agent.projects = vi.fn(async () => [{ name: "demo", agent: "project-1" }])
    agent.createProject = vi.fn(async (name: string, remote?: string) => ({
      name,
      agent: "project-1",
      ...(remote === undefined ? {} : { remote }),
    }))

    const list = await handleRequest(request("/api/projects", json({ agent: "root" })), deps)
    expect(await list.json()).toEqual({ projects: [{ name: "demo", agent: "project-1" }] })

    const create = await handleRequest(
      request("/api/projects/new", json({ agent: "root", name: "demo", remote: "https://example.com/repo.git" })),
      deps,
    )
    expect(await create.json()).toEqual({
      project: { name: "demo", agent: "project-1", remote: "https://example.com/repo.git" },
    })
    expect(agent.createProject).toHaveBeenCalledWith("demo", "https://example.com/repo.git")
    expect(names).toEqual(["root", "root"])

    const withoutRemote = await handleRequest(
      request("/api/projects/new", json({ agent: "root", name: "demo" })),
      deps,
    )
    expect(await withoutRemote.json()).toEqual({ project: { name: "demo", agent: "project-1" } })
    expect(agent.createProject).toHaveBeenCalledWith("demo", undefined)
  })

  it("validates project input", async () => {
    const { deps } = setup()
    expect((await handleRequest(request("/api/projects", json({ agent: "../a" })), deps)).status).toBe(400)
    expect((await handleRequest(request("/api/projects/new", json({ agent: "root" })), deps)).status).toBe(400)
    expect(
      (await handleRequest(request("/api/projects/new", json({ agent: "root", name: "root" })), deps)).status,
    ).toBe(400)
    expect(
      (await handleRequest(request("/api/projects/new", json({ agent: "root", name: "demo", remote: 5 })), deps))
        .status,
    ).toBe(400)
    expect(
      (
        await handleRequest(
          request("/api/projects/new", json({ agent: "root", name: "demo", remote: "https://x/a b" })),
          deps,
        )
      ).status,
    ).toBe(400)
  })

  it("lists all sessions across projects", async () => {
    const { agent, deps } = setup()
    agent.allSessions = vi.fn(async () => ({
      sessions: [
        { id: "ses_root", busy: false, agent: "root" },
        { id: "ses_root", busy: true, agent: "project-1", project: "demo" },
      ],
      errors: [{ project: "broken", message: "boom" }],
    }))
    const response = await handleRequest(request("/api/sessions/all", json({ agent: "root" })), deps)
    expect(await response.json()).toEqual({
      sessions: [
        { id: "ses_root", busy: false, agent: "root" },
        { id: "ses_root", busy: true, agent: "project-1", project: "demo" },
      ],
      errors: [{ project: "broken", message: "boom" }],
    })
  })

  it("returns state", async () => {
    const { agent, deps } = setup()
    const response = await handleRequest(request("/api/state?agent=a&session=ses_x"), deps)
    expect(await response.json()).toEqual({ messages: [], busy: false, pending: [] })
    expect(agent.state).toHaveBeenCalledWith("ses_x")
  })

  it("forwards a websocket upgrade", async () => {
    const { agent, deps } = setup()
    const response = await handleRequest(
      request("/api/ws?agent=a", { headers: { upgrade: "websocket" } }),
      deps,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("socket")
    expect(agent.fetch).toHaveBeenCalledTimes(1)
  })

  it("rejects a websocket route without an upgrade", async () => {
    const { deps } = setup()
    const response = await handleRequest(request("/api/ws?agent=a"), deps)
    expect(response.status).toBe(426)
  })

  it("returns 404 for unknown routes", async () => {
    const { deps } = setup()
    expect((await handleRequest(request("/nope"), deps)).status).toBe(404)
    expect((await handleRequest(request("/api/prompt", { method: "GET" }), deps)).status).toBe(404)
  })

  it("turns failures into JSON errors", async () => {
    const failing = stub()
    failing.prompt = vi.fn(async () => {
      throw new Error("boom")
    })
    const { deps } = setup(failing)
    const response = await handleRequest(request("/api/prompt", json({ agent: "a", text: "x" })), deps)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "boom" })
  })

  it("handles a non-Error rejection", async () => {
    const failing = stub()
    failing.abort = vi.fn(async () => {
      throw "nope"
    })
    const { deps } = setup(failing)
    const response = await handleRequest(request("/api/abort", json({ agent: "a" })), deps)
    expect(await response.json()).toEqual({ error: "request failed" })
  })
})

describe("handleRequest optional inputs", () => {
  it("accepts missing sessions and query parameters", async () => {
    const { agent, deps } = setup()
    await handleRequest(request("/api/prompt", json({ agent: "a", text: "x" })), deps)
    expect(agent.prompt).toHaveBeenCalledWith("x", undefined)

    await handleRequest(request("/api/abort", json({ agent: "a" })), deps)
    expect(agent.abort).toHaveBeenCalledWith(undefined)

    await handleRequest(request("/api/state?agent=a"), deps)
    expect(agent.state).toHaveBeenCalledWith(undefined)

    expect((await handleRequest(request("/api/state"), deps)).status).toBe(400)
    expect((await handleRequest(request("/api/ws"), deps)).status).toBe(400)
  })
})

describe("sandbox routes", () => {
  it("reports status and saves a snapshot", async () => {
    const { agent, deps } = setup()
    expect(await (await handleRequest(request("/api/sandbox/status?agent=a"), deps)).json()).toEqual({
      backend: "cloudflare",
      running: true,
      image: "image",
      snapshotId: "snap",
    })
    expect(await (await handleRequest(request("/api/sandbox/save", json({ agent: "a" })), deps)).json()).toEqual({
      id: "snap",
      size: 10,
    })
    expect(agent.sandboxSave).toHaveBeenCalledTimes(1)
  })

  it("resets the sandbox", async () => {
    const { agent, deps } = setup()
    const response = await handleRequest(request("/api/sandbox/reset", json({ agent: "a" })), deps)
    expect(await response.json()).toEqual({ ok: true })
    expect(agent.sandboxReset).toHaveBeenCalledTimes(1)
  })

  it("reads and writes sandbox files", async () => {
    const { agent, deps } = setup()
    const read = await handleRequest(
      request("/api/sandbox/read", json({ agent: "a", path: "/workspace/a", offset: 2, limit: 3 })),
      deps,
    )
    expect(await read.json()).toEqual({ path: "/workspace/a", content: "hi", totalLines: 1, truncated: false })
    expect(agent.sandboxRead).toHaveBeenCalledWith("/workspace/a", 2, 3)

    const write = await handleRequest(
      request("/api/sandbox/write", json({ agent: "a", path: "/workspace/a", content: "hi" })),
      deps,
    )
    expect(await write.json()).toEqual({ path: "/workspace/a", bytes: 2 })
    expect(agent.sandboxWrite).toHaveBeenCalledWith("/workspace/a", "hi")
  })

  it("runs a shell command", async () => {
    const { agent, deps } = setup()
    const response = await handleRequest(
      request("/api/sandbox/exec", json({ agent: "a", command: "pwd" })),
      deps,
    )
    expect(await response.json()).toEqual({
      exitCode: 0,
      stdout: "hi",
      stderr: "",
      truncated: false,
      durationMs: 1,
    })
    expect(agent.sandboxExec).toHaveBeenCalledWith("pwd", undefined, undefined)
  })

  it("passes cwd and timeout to a shell command", async () => {
    const { agent, deps } = setup()
    await handleRequest(
      request("/api/sandbox/exec", json({ agent: "a", command: "pwd", cwd: "/workspace/src", timeoutMs: 5_000 })),
      deps,
    )
    expect(agent.sandboxExec).toHaveBeenCalledWith("pwd", "/workspace/src", 5_000)
  })

  it("validates sandbox inputs", async () => {
    const { agent, deps } = setup()
    await handleRequest(request("/api/sandbox/read", json({ agent: "a", path: "/workspace/a" })), deps)
    expect(agent.sandboxRead).toHaveBeenCalledWith("/workspace/a", undefined, undefined)
    expect((await handleRequest(request("/api/sandbox/status"), deps)).status).toBe(400)
    expect((await handleRequest(request("/api/sandbox/read", json({ agent: "a" })), deps)).status).toBe(400)
    expect(
      (await handleRequest(request("/api/sandbox/read", json({ agent: "a", path: "a", offset: "x" })), deps)).status,
    ).toBe(400)
    expect(
      (await handleRequest(request("/api/sandbox/write", json({ agent: "a", path: "a" })), deps)).status,
    ).toBe(400)
    expect((await handleRequest(request("/api/sandbox/save", json({ agent: "../a" })), deps)).status).toBe(400)
    expect((await handleRequest(request("/api/sandbox/exec", json({ agent: "a" })), deps)).status).toBe(400)
    expect(
      (await handleRequest(request("/api/sandbox/exec", json({ agent: "a", command: "  " })), deps)).status,
    ).toBe(400)
    expect(
      (await handleRequest(request("/api/sandbox/exec", json({ agent: "a", command: "x".repeat(100_001) })), deps)).status,
    ).toBe(413)
    expect(
      (await handleRequest(request("/api/sandbox/exec", json({ agent: "a", command: "x", cwd: 5 })), deps)).status,
    ).toBe(400)
    expect(
      (await handleRequest(request("/api/sandbox/exec", json({ agent: "a", command: "x", timeoutMs: "x" })), deps)).status,
    ).toBe(400)
  })
})
