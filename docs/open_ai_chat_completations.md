# OpenAI Chat Completions API

This document covers the endpoints under the `/chat/completions*` resource of the OpenAI REST API. It is derived from `docs/openapi.yaml` and covers every HTTP verb exposed for these paths.

> **New project?** OpenAI recommends using the newer [Responses API](https://platform.openai.com/docs/api-reference/responses) for new work. Chat Completions remains fully supported and is documented here.

## Authentication

All endpoints require a Bearer token in the `Authorization` header.

```
Authorization: Bearer $OPENAI_API_KEY
```

Requests must be sent to `https://api.openai.com/v1` with `Content-Type: application/json` (except the streamed completion path, which may also return `text/event-stream`).

---

## Endpoints

| Method | Path                                            | Operation             |
| ------ | ----------------------------------------------- | --------------------- |
| POST   | `/chat/completions`                             | Create chat completion |
| GET    | `/chat/completions`                             | List stored chat completions |
| GET    | `/chat/completions/{completion_id}`             | Get a stored chat completion |
| POST   | `/chat/completions/{completion_id}`             | Update a stored chat completion |
| DELETE | `/chat/completions/{completion_id}`             | Delete a stored chat completion |
| GET    | `/chat/completions/{completion_id}/messages`    | Get messages of a stored chat completion |

Stored endpoints (list/get/update/delete/messages) only return or operate on completions that were originally created with `store: true`.

---

## POST `/chat/completions` — Create chat completion

Generates a model response for a chat conversation. Returns a single `chat.completion` object, or a streamed sequence of `chat.completion.chunk` objects when `stream: true`.

Supports text, image (vision), and audio inputs. Parameter support varies by model — reasoning models in particular have a reduced set of supported parameters. See the [reasoning guide](https://platform.openai.com/docs/guides/reasoning).

### Request body (application/json)

| Field             | Type     | Required | Notes                                                                                          |
| ----------------- | -------- | -------- | ---------------------------------------------------------------------------------------------- |
| `model`           | string   | yes      | The model ID (e.g. `gpt-5.4`, `gpt-4o`, `gpt-4o-mini`, `o1`, ...).                              |
| `messages`        | array    | yes      | Conversation history. Each item has a `role` (`system`, `developer`, `user`, `assistant`, `tool`, or `function`) and `content`. |
| `stream`          | boolean  | no       | If `true`, partial message deltas are sent as `text/event-stream` events.                       |
| `temperature`     | number   | no       | Sampling temperature, default `1`.                                                             |
| `top_p`           | number   | no       | Nucleus sampling, default `1`.                                                                 |
| `n`               | integer  | no       | How many chat completion choices to generate. Default `1`.                                     |
| `max_tokens`      | integer  | no       | Upper bound for generated tokens.                                                              |
| `max_completion_tokens` | integer | no   | Token cap for reasoning + completion (preferred for reasoning models).                         |
| `stop`            | string \| string[] | no | Sequences where the model should stop generating.                                              |
| `presence_penalty`| number   | no       | Penalize new tokens based on appearance, `-2.0` to `2.0`.                                      |
| `frequency_penalty`| number  | no       | Penalize new tokens based on frequency, `-2.0` to `2.0`.                                       |
| `logit_bias`      | object   | no       | Map of token IDs to bias values `-100` to `100`.                                               |
| `logprobs`        | boolean  | no       | Whether to return log probabilities of the output tokens.                                      |
| `top_logprobs`    | integer  | no       | Number of most likely tokens to return at each position (0–20).                                |
| `user`            | string   | no       | A stable identifier for your end users (helps with abuse detection).                            |
| `response_format` | object   | no       | `{"type": "text" | "json_object" | "json_schema", "json_schema": {...}}` to constrain output. |
| `seed`            | integer  | no       | Best-effort deterministic sampling. Same seed + params ⇒ same output.                          |
| `tools`           | array    | no       | List of tools the model may call. Each tool: `{"type": "function", "function": {...}}`.        |
| `tool_choice`     | string \| object | no | `"none"`, `"auto"`, `"required"`, or `{"type": "function", "function": {"name": "..."}}`.    |
| `parallel_tool_calls` | boolean | no   | Whether to enable parallel function calling during tool use.                                   |
| `store`           | boolean  | no       | If `true`, the completion is stored and can be retrieved via the stored endpoints.             |
| `metadata`        | object   | no       | Up to 16 key-value pairs (max 64 chars each) for tagging stored completions.                   |
| `audio`           | object   | no       | Audio output config: `{"voice": "alloy" | ..., "format": "wav" | "mp3" | "flac" | "opus" | "pcm16"}`. |
| `modalities`      | array    | no       | Output types, e.g. `["text", "audio"]`.                                                        |
| `prediction`      | object   | no       | Predicted output content for speculative decoding (`{"type": "content", "content": "..."}`).   |
| `reasoning_effort`| string   | no       | For reasoning models: `"low" | "medium" | "high"`.                                            |
| `service_tier`    | string   | no       | `"auto" | "default" | "flex" | "priority"`.                                                  |
| `stream_options`  | object   | no       | `{"include_usage": true}` to include a final chunk with `usage`.                              |
| `web_search_options` | object | no     | Configure built-in web search tool.                                                            |
| `prompt_cache_key`| string   | no       | Key for prompt caching.                                                                         |
| `safety_identifier`| string  | no       | Safety identifier for the request.                                                             |
| `verbosity`       | string   | no       | `"low" | "medium" | "high"` — controls output verbosity where supported.                       |

### Response

- **200 OK** (`application/json`): a `CreateChatCompletionResponse` with `id`, `object: "chat.completion"`, `created` (epoch seconds), `model`, `choices[]` (each with `index`, `message`/`delta`, `logprobs`, `finish_reason`), `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`, plus optional `prompt_tokens_details` / `completion_tokens_details`).
- **200 OK** (`text/event-stream`): a sequence of `CreateChatCompletionStreamResponse` chunks. The final chunk has `finish_reason: "stop"` (or `"length"`, `"tool_calls"`, `"content_filter"`, `"function_call"`); set `stream_options.include_usage` to also receive a usage chunk.

### Examples

**Default — single completion**

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "developer", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

**Image input (vision)**

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is in this image?"},
          {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
        ]
      }
    ],
    "max_tokens": 300
  }'
```

**Streaming**

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "developer", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'
```

Each line is `data: {json}`; the stream ends with `data: [DONE]`.

**Function calling**

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "What is the weather like in Boston today?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_current_weather",
          "description": "Get the current weather in a given location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string", "description": "City and state, e.g. San Francisco, CA"},
              "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["location"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

When the model decides to call a tool, the response `choices[0].finish_reason` is `"tool_calls"` and `choices[0].message.tool_calls` contains the function name and JSON-encoded arguments. Append a `role: "tool"` message with the result and call again to get a final answer.

**Logprobs**

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "logprobs": true,
    "top_logprobs": 2
  }'
```

---

## GET `/chat/completions` — List stored chat completions

Returns a paginated list of stored chat completions. Completions are only stored when originally created with `store: true`.

### Query parameters

| Name      | Type    | Required | Default | Description                                                                                              |
| --------- | ------- | -------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `model`   | string  | no       | —       | Filter to completions produced by the given model.                                                       |
| `metadata` | object | no       | —       | Filter by metadata keys, e.g. `metadata[key1]=value1&metadata[key2]=value2`.                            |
| `after`   | string  | no       | —       | Cursor — identifier of the last item from the previous page.                                             |
| `limit`   | integer | no       | `20`    | Number of completions to retrieve.                                                                       |
| `order`   | string  | no       | `asc`   | Sort by timestamp; `asc` or `desc`.                                                                     |

### Response

**200 OK** — `ChatCompletionList` with `object: "list"`, `data: ChatCompletion[]`, `first_id`, `last_id`, `has_more`.

### Example

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json"
```

```python
from openai import OpenAI
client = OpenAI()
for page in client.chat.completions.list():
    print(page.id)
```

---

## GET `/chat/completions/{completion_id}` — Get a stored chat completion

Retrieves a single stored chat completion by ID. Only completions created with `store: true` are accessible.

### Path parameters

| Name           | Type   | Required | Description                              |
| -------------- | ------ | -------- | ---------------------------------------- |
| `completion_id`| string | yes      | The ID of the chat completion to fetch.  |

### Response

**200 OK** — a `CreateChatCompletionResponse` object.

### Example

```bash
curl https://api.openai.com/v1/chat/completions/chatcmpl-abc123 \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json"
```

```python
from openai import OpenAI
client = OpenAI()
completion = client.chat.completions.retrieve("chatcmpl-abc123")
print(completion.id)
```

---

## POST `/chat/completions/{completion_id}` — Update a stored chat completion

Modifies a stored chat completion. Only completions created with `store: true` can be updated. Currently the only supported modification is to update the `metadata` field.

### Path parameters

| Name           | Type   | Required | Description                              |
| -------------- | ------ | -------- | ---------------------------------------- |
| `completion_id`| string | yes      | The ID of the chat completion to update. |

### Request body (application/json)

| Field      | Type   | Required | Description                                            |
| ---------- | ------ | -------- | ------------------------------------------------------ |
| `metadata` | object | yes      | New metadata. Up to 16 key-value pairs, 64 chars max.  |

### Response

**200 OK** — the updated `CreateChatCompletionResponse`.

### Example

```bash
curl -X POST https://api.openai.com/v1/chat/completions/chat_abc123 \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"metadata": {"foo": "bar"}}'
```

```python
from openai import OpenAI
client = OpenAI()
client.chat.completions.update(
    completion_id="chatcmpl-abc123",
    metadata={"foo": "bar"},
)
```

---

## DELETE `/chat/completions/{completion_id}` — Delete a stored chat completion

Deletes a stored chat completion. Only completions created with `store: true` can be deleted.

### Path parameters

| Name           | Type   | Required | Description                              |
| -------------- | ------ | -------- | ---------------------------------------- |
| `completion_id`| string | yes      | The ID of the chat completion to delete. |

### Response

**200 OK** — a `ChatCompletionDeleted` object:

```json
{
  "object": "chat.completion.deleted",
  "id": "chatcmpl-AyPNinnUqUDYo9SAdA52NobMflmj2",
  "deleted": true
}
```

### Example

```bash
curl -X DELETE https://api.openai.com/v1/chat/completions/chat_abc123 \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json"
```

```python
from openai import OpenAI
client = OpenAI()
result = client.chat.completions.delete("chatcmpl-abc123")
print(result.id, result.deleted)
```

---

## GET `/chat/completions/{completion_id}/messages` — Get chat messages

Returns the input messages associated with a stored chat completion. Only completions created with `store: true` are accessible.

### Path parameters

| Name           | Type   | Required | Description                                       |
| -------------- | ------ | -------- | ------------------------------------------------- |
| `completion_id`| string | yes      | The ID of the chat completion whose messages you want. |

### Query parameters

| Name    | Type    | Required | Default | Description                                                          |
| ------- | ------- | -------- | ------- | -------------------------------------------------------------------- |
| `after` | string  | no       | —       | Cursor — identifier of the last message from the previous page.      |
| `limit` | integer | no       | `20`    | Number of messages to retrieve.                                     |
| `order` | string  | no       | `asc`   | Sort by timestamp; `asc` or `desc`.                                  |

### Response

**200 OK** — a `ChatCompletionMessageList`:

```json
{
  "object": "list",
  "data": [
    {
      "id": "chatcmpl-AyPNinnUqUDYo9SAdA52NobMflmj2-0",
      "role": "user",
      "content": "write a haiku about ai",
      "name": null,
      "content_parts": null
    }
  ],
  "first_id": "chatcmpl-AyPNinnUqUDYo9SAdA52NobMflmj2-0",
  "last_id": "chatcmpl-AyPNinnUqUDYo9SAdA52NobMflmj2-0",
  "has_more": false
}
```

### Example

```bash
curl https://api.openai.com/v1/chat/completions/chat_abc123/messages \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json"
```

```python
from openai import OpenAI
client = OpenAI()
page = client.chat.completions.messages.list(completion_id="chatcmpl-abc123")
for message in page.data:
    print(message.role, message.content)
```

---

## Common error responses

| Status | Meaning                                                                |
| ------ | ---------------------------------------------------------------------- |
| 400    | Bad request — invalid parameters, model unavailable, or validation error. |
| 401    | Unauthorized — missing or invalid `Authorization` header.              |
| 404    | Not found — the requested resource (model, completion, file, ...) does not exist. |
| 429    | Rate limit exceeded — back off and retry, or upgrade your usage tier.  |
| 500    | Server error — the upstream service failed; safe to retry.             |
| 503    | Service unavailable — engine overloaded; retry with backoff.           |

Error bodies follow the standard format:

```json
{
  "error": {
    "message": "Invalid value for 'model'.",
    "type": "invalid_request_error",
    "param": "model",
    "code": null
  }
}
```

---

## Usage tips

- **Determinism** — set `seed` together with fixed `temperature` and `top_p` for reproducible outputs.
- **Cost control** — use `max_tokens` / `max_completion_tokens` to cap output. For reasoning models, `max_completion_tokens` covers both reasoning and visible output.
- **JSON mode** — set `response_format: { "type": "json_object" }` (and tell the model in the system/developer prompt to produce JSON), or use `json_schema` for a strict schema.
- **Storing completions** — only completions created with `store: true` are reachable through the list/get/update/delete/messages endpoints. They are retained for 30 days (check the platform docs for the latest retention policy).
- **Streaming** — handle partial chunks by appending `choices[0].delta.content`. The last chunk has `finish_reason` set; if `stream_options.include_usage: true` is set, you will also receive a trailing chunk with `usage`.
- **Function calling** — set `parallel_tool_calls: true` to allow multiple tool calls in a single turn. After receiving `tool_calls`, append a `role: "tool"` message per call (with `tool_call_id` and the stringified result) before continuing the conversation.
