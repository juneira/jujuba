import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TuiClient } from "../../src/tui/api.js"

class FakeSocket {
  static instances: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.()
  }

  message(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  closeFromServer(): void {
    this.onclose?.()
  }
}

function handlers() {
  return {
    onSnapshot: vi.fn(),
    onEvents: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
  }
}

function client(overrides: Record<string, unknown> = {}) {
  return new TuiClient({
    baseUrl: "http://agent.test/",
    agent: "my agent",
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    ...overrides,
  })
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("TuiClient prompt and abort", () => {
  it("posts prompts", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "done", text: "hi" }))
    const api = client({ fetch })
    await expect(api.prompt("hello")).resolves.toEqual({ status: "done", text: "hi" })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agent.test/api/prompt")
    expect(JSON.parse(String(init.body))).toEqual({ agent: "my agent", text: "hello" })

    await api.prompt("hello", "ses_x")
    expect(JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "my agent",
      text: "hello",
      session: "ses_x",
    })
  })

  it("throws the server error for a failed prompt", async () => {
    const api = client({ fetch: async () => Response.json({ error: "nope" }, { status: 400 }) })
    await expect(api.prompt("hello")).rejects.toThrow("nope")
    const noBody = client({ fetch: async () => new Response("", { status: 500 }) })
    await expect(noBody.prompt("hello")).rejects.toThrow("prompt failed")
  })

  it("aborts", async () => {
    const fetch = vi.fn(async () => Response.json({ aborted: true }))
    const api = client({ fetch })
    await expect(api.abort()).resolves.toBe(true)
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "my agent",
    })

    await api.abort("ses_x")
    expect(JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "my agent",
      session: "ses_x",
    })

    expect(await client({ fetch: async () => Response.json({ aborted: false }) }).abort()).toBe(false)
    await expect(
      client({ fetch: async () => Response.json({ error: "bad" }, { status: 500 }) }).abort(),
    ).rejects.toThrow("bad")
    await expect(
      client({ fetch: async () => new Response("", { status: 500 }) }).abort(),
    ).rejects.toThrow("abort failed")
  })

  it("falls back to the global fetch", async () => {
    const globalFetch = vi.fn(async () => Response.json({ status: "done", text: "ok" }))
    vi.stubGlobal("fetch", globalFetch)
    try {
      const api = new TuiClient({ baseUrl: "http://agent.test", agent: "a" })
      await expect(api.prompt("hello")).resolves.toEqual({ status: "done", text: "ok" })
      expect(globalFetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("TuiClient sessions", () => {
  it("lists sessions", async () => {
    const fetch = vi.fn(async () => Response.json({ sessions: [{ id: "ses_root", busy: false }] }))
    const api = client({ fetch })
    await expect(api.sessions()).resolves.toEqual([{ id: "ses_root", busy: false }])
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agent.test/api/sessions")
    expect(JSON.parse(String(init.body))).toEqual({ agent: "my agent" })

    await expect(client({ fetch: async () => Response.json({}) }).sessions()).resolves.toEqual([])
    await expect(
      client({ fetch: async () => Response.json({ error: "bad" }, { status: 500 }) }).sessions(),
    ).rejects.toThrow("bad")
    await expect(
      client({ fetch: async () => new Response("", { status: 500 }) }).sessions(),
    ).rejects.toThrow("sessions failed")
  })

  it("lists all sessions across projects", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        sessions: [{ id: "ses_root", busy: false, agent: "project-1", project: "demo" }],
        errors: [{ project: "broken", message: "boom" }],
      }),
    )
    const api = client({ fetch })
    await expect(api.allSessions()).resolves.toEqual({
      sessions: [{ id: "ses_root", busy: false, agent: "project-1", project: "demo" }],
      errors: [{ project: "broken", message: "boom" }],
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agent.test/api/sessions/all")
    expect(JSON.parse(String(init.body))).toEqual({ agent: "my agent" })

    await expect(client({ fetch: async () => Response.json({}) }).allSessions()).resolves.toEqual({
      sessions: [],
      errors: [],
    })
    await expect(
      client({ fetch: async () => Response.json({ error: "bad" }, { status: 500 }) }).allSessions(),
    ).rejects.toThrow("bad")
    await expect(
      client({ fetch: async () => new Response("", { status: 500 }) }).allSessions(),
    ).rejects.toThrow("sessions failed")
    await expect(client({ fetch: async () => new Response("{bad") }).allSessions()).resolves.toEqual({
      sessions: [],
      errors: [],
    })
  })

  it("lists and creates projects", async () => {
    const fetch = vi.fn(async () => Response.json({ projects: [{ name: "demo", agent: "project-1" }] }))
    const api = client({ fetch })
    await expect(api.projects()).resolves.toEqual([{ name: "demo", agent: "project-1" }])
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agent.test/api/projects")
    expect(JSON.parse(String(init.body))).toEqual({ agent: "my agent" })

    const creating = vi.fn(async () => Response.json({ project: { name: "demo", agent: "project-1" } }))
    const creator = client({ fetch: creating })
    await expect(creator.createProject("demo")).resolves.toEqual({ name: "demo", agent: "project-1" })
    expect(JSON.parse(String((creating.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "my agent",
      name: "demo",
    })
    await expect(creator.createProject("demo", "https://example.com/repo.git")).resolves.toEqual({
      name: "demo",
      agent: "project-1",
    })
    expect(JSON.parse(String((creating.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "my agent",
      name: "demo",
      remote: "https://example.com/repo.git",
    })

    await expect(client({ fetch: async () => Response.json({}) }).projects()).resolves.toEqual([])
    await expect(
      client({ fetch: async () => Response.json({ error: "bad" }, { status: 500 }) }).projects(),
    ).rejects.toThrow("bad")
    await expect(
      client({ fetch: async () => Response.json({}, { status: 500 }) }).projects(),
    ).rejects.toThrow("projects failed")
    await expect(
      client({ fetch: async () => Response.json({}, { status: 500 }) }).createProject("demo"),
    ).rejects.toThrow("create project failed")
    await expect(
      client({ fetch: async () => Response.json({ error: "bad" }, { status: 500 }) }).createProject("demo"),
    ).rejects.toThrow("bad")
    await expect(client({ fetch: async () => Response.json({}) }).createProject("demo")).rejects.toThrow(
      "create project failed",
    )
    await expect(client({ fetch: async () => new Response("{bad") }).projects()).resolves.toEqual([])
    await expect(client({ fetch: async () => new Response("{bad") }).createProject("demo")).rejects.toThrow(
      "create project failed",
    )
  })

  it("creates a session", async () => {
    const fetch = vi.fn(async () => Response.json({ session: { id: "ses_new", busy: false } }))
    const api = client({ fetch })
    await expect(api.createSession()).resolves.toEqual({ id: "ses_new", busy: false })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agent.test/api/sessions/new")
    expect(JSON.parse(String(init.body))).toEqual({ agent: "my agent" })

    await expect(
      client({ fetch: async () => Response.json({ error: "bad" }, { status: 500 }) }).createSession(),
    ).rejects.toThrow("bad")
    await expect(
      client({ fetch: async () => new Response("", { status: 500 }) }).createSession(),
    ).rejects.toThrow("create session failed")
    await expect(
      client({ fetch: async () => Response.json({}) }).createSession(),
    ).rejects.toThrow("create session failed")
  })
})

describe("TuiClient project routing", () => {
  it("sends the requested agent for project calls", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ status: "done", aborted: true, session: { id: "ses_new", busy: false } }),
    )
    const api = client({ fetch })
    await api.prompt("hello", "ses_x", "project-1")
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "project-1",
      text: "hello",
      session: "ses_x",
    })

    await api.abort("ses_x", "project-1")
    expect(JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "project-1",
      session: "ses_x",
    })

    await api.sessions("project-1")
    expect(JSON.parse(String((fetch.mock.calls[2] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "project-1",
    })

    await api.createSession("project-1")
    expect(JSON.parse(String((fetch.mock.calls[3] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "project-1",
    })
  })

  it("connects a project socket with its agent", () => {
    const api = client()
    const stop = api.connect(handlers(), "ses_x", "project-1")
    expect(FakeSocket.instances[0]!.url).toBe("ws://agent.test/api/ws?agent=project-1&session=ses_x")
    stop()
  })
})

describe("TuiClient exec", () => {
  it("posts a shell command to the sandbox", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ exitCode: 0, stdout: "hi", stderr: "", truncated: false, durationMs: 1 }),
    )
    const api = client({ fetch })
    await expect(api.exec("pwd")).resolves.toEqual({
      exitCode: 0,
      stdout: "hi",
      stderr: "",
      truncated: false,
      durationMs: 1,
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agent.test/api/sandbox/exec")
    expect(JSON.parse(String(init.body))).toEqual({ agent: "my agent", command: "pwd" })
  })

  it("sends the requested agent and optional options", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ exitCode: 0, stdout: "", stderr: "", truncated: false, durationMs: 0 }),
    )
    const api = client({ fetch })
    await api.exec("pwd", "project-1", { cwd: "/workspace/src", timeoutMs: 5_000 })
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      agent: "project-1",
      command: "pwd",
      cwd: "/workspace/src",
      timeoutMs: 5_000,
    })
  })

  it("throws the server error for a failed command", async () => {
    const api = client({ fetch: async () => Response.json({ error: "nope" }, { status: 400 }) })
    await expect(api.exec("pwd")).rejects.toThrow("nope")
    const noBody = client({ fetch: async () => new Response("", { status: 500 }) })
    await expect(noBody.exec("pwd")).rejects.toThrow("exec failed")
  })
})

describe("TuiClient socket", () => {
  it("falls back to the global WebSocket", () => {
    const api = new TuiClient({ baseUrl: "http://agent.test", agent: "a" })
    expect(api).toBeInstanceOf(TuiClient)
  })

  it("connects to a chosen session", () => {
    const api = client()
    const stop = api.connect(handlers(), "ses_a b")
    expect(FakeSocket.instances[0]!.url).toBe("ws://agent.test/api/ws?agent=my%20agent&session=ses_a%20b")
    stop()
  })

  it("connects and dispatches frames", () => {
    const api = client()
    const sink = handlers()
    const stop = api.connect(sink)
    const socket = FakeSocket.instances[0]!

    expect(socket.url).toBe("ws://agent.test/api/ws?agent=my%20agent")
    expect(sink.onStatus).toHaveBeenLastCalledWith("connecting")

    socket.open()
    expect(sink.onStatus).toHaveBeenLastCalledWith("idle")

    socket.message(JSON.stringify({ type: "snapshot", snapshot: { session: "ses_root" } }))
    expect(sink.onSnapshot).toHaveBeenCalledWith({ session: "ses_root" })

    socket.message({ type: "events", events: [{ type: "run_start" }] })
    expect(sink.onEvents).toHaveBeenCalledWith([{ type: "run_start" }])

    socket.message("not json")
    socket.message("5")
    socket.message(JSON.stringify({ type: "other" }))
    expect(sink.onSnapshot).toHaveBeenCalledTimes(1)
    expect(sink.onEvents).toHaveBeenCalledTimes(1)

    socket.onerror?.()
    expect(sink.onError).toHaveBeenCalledWith("connection lost")

    stop()
    expect(socket.closed).toBe(true)
  })

  it("reconnects with a growing delay and stops on demand", () => {
    const api = client()
    const sink = handlers()
    const stop = api.connect(sink)
    const first = FakeSocket.instances[0]!

    first.closeFromServer()
    expect(sink.onStatus).toHaveBeenLastCalledWith("connecting")
    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(2)

    FakeSocket.instances[1]!.closeFromServer()
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)

    FakeSocket.instances[2]!.closeFromServer()
    vi.advanceTimersByTime(2_000)
    expect(FakeSocket.instances).toHaveLength(4)

    stop()
    expect(FakeSocket.instances[3]!.closed).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it("caps the reconnect delay", () => {
    const api = client({ reconnectDelayMs: 10, maxReconnectDelayMs: 15 })
    const stop = api.connect(handlers())
    FakeSocket.instances[0]!.closeFromServer()
    vi.advanceTimersByTime(10)
    FakeSocket.instances[1]!.closeFromServer()
    vi.advanceTimersByTime(15)
    expect(FakeSocket.instances).toHaveLength(3)
    stop()
  })

  it("ignores duplicate closes until the timer fires", () => {
    const api = client()
    const stop = api.connect(handlers())
    const socket = FakeSocket.instances[0]!
    socket.closeFromServer()
    socket.closeFromServer()
    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(2)
    stop()
  })

  it("does not reconnect after stop", () => {
    const api = client()
    const stop = api.connect(handlers())
    stop()
    FakeSocket.instances[0]!.closeFromServer()
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it("ignores a pending timer after stop", () => {
    const api = client()
    const stop = api.connect(handlers())
    FakeSocket.instances[0]!.closeFromServer()
    stop()
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
