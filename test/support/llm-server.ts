import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

export interface ScriptedToolCall {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly id?: string
}

export interface ScriptedTurn {
  readonly text?: string
  readonly reasoning?: string
  readonly toolCalls?: readonly ScriptedToolCall[]
}

interface ChatBody {
  readonly model?: string
  readonly stream?: boolean
  readonly tools?: readonly unknown[]
}

const state: { queue: ScriptedTurn[]; requests: number; exhausted: boolean; lastAgentRequest: string } = {
  queue: [],
  requests: 0,
  exhausted: false,
  lastAgentRequest: "",
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

function chunk(model: string, delta: Record<string, unknown>, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish === null
      ? {}
      : { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
  })}\n\n`
}

function sse(response: ServerResponse, model: string, turn: ScriptedTurn): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  response.write(chunk(model, { role: "assistant", ...(turn.reasoning === undefined ? {} : { reasoning: turn.reasoning }) }, null))

  if (turn.text !== undefined && turn.text !== "") {
    response.write(chunk(model, { content: turn.text }, null))
  }
  if (turn.toolCalls !== undefined) {
    turn.toolCalls.forEach((call, index) => {
      response.write(
        chunk(
          model,
          {
            tool_calls: [
              {
                index,
                id: call.id ?? `call_${index + 1}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          },
          null,
        ),
      )
    })
  }

  const finish = turn.toolCalls === undefined ? "stop" : "tool_calls"
  response.write(chunk(model, {}, finish))
  response.write("data: [DONE]\n\n")
  response.end()
}

function completion(response: ServerResponse, model: string, turn: ScriptedTurn): void {
  json(response, 200, {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: turn.text ?? null,
          ...(turn.toolCalls === undefined
            ? {}
            : {
                tool_calls: turn.toolCalls.map((call, index) => ({
                  id: call.id ?? `call_${index + 1}`,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.args) },
                })),
              }),
        },
        finish_reason: turn.toolCalls === undefined ? "stop" : "tool_calls",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const raw = await readBody(request)

  if (url.pathname === "/__reset" && request.method === "POST") {
    state.queue = []
    state.requests = 0
    state.exhausted = false
    state.lastAgentRequest = ""
    json(response, 200, { ok: true })
    return
  }

  if (url.pathname === "/__last") {
    json(response, 200, { body: state.lastAgentRequest })
    return
  }

  if (url.pathname === "/__enqueue" && request.method === "POST") {
    const body = JSON.parse(raw) as { turns?: ScriptedTurn[] }
    state.queue.push(...(body.turns ?? []))
    json(response, 200, { ok: true, queued: state.queue.length })
    return
  }

  if (url.pathname === "/__stats") {
    json(response, 200, { ...state, queued: state.queue.length })
    return
  }

  if (url.pathname.endsWith("/models")) {
    json(response, 200, { data: [] })
    return
  }

  if (url.pathname.endsWith("/chat/completions") && request.method === "POST") {
    state.requests += 1
    const body = JSON.parse(raw) as ChatBody
    const model = body.model ?? "test-model"
    const isAgentCall = Array.isArray(body.tools) && body.tools.length > 0
    if (isAgentCall) state.lastAgentRequest = raw

    // Title generation and compaction calls carry no tools. Answer them without
    // consuming the scripted turns for the agent loop.
    if (!isAgentCall) {
      const turn: ScriptedTurn = { text: "Test session" }
      if (body.stream === false) completion(response, model, turn)
      else sse(response, model, turn)
      return
    }

    const turn = state.queue.shift()
    if (turn === undefined) {
      state.exhausted = true
      const fallback: ScriptedTurn = { text: "No scripted response was queued." }
      if (body.stream === false) completion(response, model, fallback)
      else sse(response, model, fallback)
      return
    }

    if (body.stream === false) completion(response, model, turn)
    else sse(response, model, turn)
    return
  }

  json(response, 404, { error: { message: `unexpected request: ${request.method} ${url.pathname}` } })
}

export interface FakeOpenRouter {
  readonly url: string
  close(): Promise<void>
}

if (import.meta.main === true) {
  const server = await startFakeOpenRouter({ port: Number(process.env.LLM_PORT ?? "7432") })
  console.log(`[fake-openrouter] ${server.url}`)
}

export async function startFakeOpenRouter(options: { port: number }): Promise<FakeOpenRouter> {
  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      json(response, 500, { error: { message: String(error) } })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  return {
    url: `http://127.0.0.1:${options.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
