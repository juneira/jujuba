# Chat + OpenAI Adapter — Implementation Plan

## Goal
Create a `chat.Chat` abstraction with an injectable `Provider` interface, plus an OpenAI-compatible adapter targeting llama.cpp at a configurable base URL. No streaming, no external SDKs.

## Architecture

```
main.go
  └─> chat.Chat.Ask("hello")
        ├─ appends user message to history
        └─> chat.Provider.Ask(chat)         // adapter call
              └─> openai.Client.Ask(chat)    // HTTP POST to /v1/chat/completions
                    ├─ converts chat.Messages() → []ChatCompletionRequestMessage
                    ├─ builds CreateChatCompletionRequest (stream=false)
                    ├─ POSTs JSON to {baseURL}/v1/chat/completions
                    └─ parses CreateChatCompletionResponse → *chat.MessageType
        ├─ appends assistant message to history
        └─ returns response.Content (string)
```

## Files to create/modify

### 1. `chat/chat.go` — Core abstraction
- `Provider` interface: `Ask(chat *Chat) (*MessageType, error)`
- `Chat` struct:
  - `provider Provider` (private, injected)
  - `Model string` (public, read by adapter to build request)
  - `messages []MessageType` (private, append-only history)
- `New(provider Provider, model string) *Chat`
- `(c *Chat) Messages() []MessageType` — expose history for adapters
- `(c *Chat) Ask(message string) (string, error)` — adds user msg → calls provider → adds assistant msg → returns content

### 2. `openai/client.go` — New file (replaces `openai/http.go`)
- `Client` struct:
  - `baseURL string`
  - `httpClient *http.Client`
- `NewClient(baseURL string) *Client`
- `(c *Client) Ask(chat *chat.Chat) (*chat.MessageType, error)`:
  1. Convert `chat.Messages()` → `[]ChatCompletionRequestMessage` (map `RoleUser`→`"user"`, `RoleAssistant`→`"assistant"`, Content→`ChatCompletionRequestMessageContent{Text: &content}`)
  2. Convert user's new message + all history into request messages
  3. Build `CreateChatCompletionRequest{Messages, Model: chat.Model, Stream: ptr(false)}`
  4. `json.Marshal` → `POST {baseURL}/v1/chat/completions`
  5. Parse `CreateChatCompletionResponse`
  6. Return `&chat.MessageType{Role: RoleAssistant, Content: *choices[0].Message.Content}`

### 3. `openai/http.go` — Delete (placeholder, replaced by `client.go`)

### 4. `main.go` — Update example usage
- `chat.New(openai.NewClient("http://localhost:1234"), "llama-3")` → `chat.Ask("hello")` → print response

### 5. `chat/chat_test.go` — Tests
- `TestNew` — verifies Chat created with provider and model
- `TestAsk_AppendsHistory` — mock provider, verify both user and assistant messages in history
- `TestAsk_ReturnsContent` — mock provider, verify string response
- `TestAsk_ProviderError` — mock provider returns error, verify error propagation
- `TestMessages` — verify exposed messages slice

### 6. `openai/client_test.go` — Tests
- `TestAsk_BuildsCorrectRequest` — `httptest.NewServer` captures request body, validates JSON structure (model, messages, stream=false)
- `TestAsk_ParsesResponse` — test server returns valid JSON, verify returned `*chat.MessageType`
- `TestAsk_ServerError` — test server returns 500, verify error
- `TestAsk_InvalidJSON` — test server returns malformed JSON, verify error
- `TestAsk_EmptyChoices` — test server returns empty choices array, verify error

## Key design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `Ask` return | `(string, error)` | Simpler public API; history managed internally |
| Model source | `Chat.Model` (public field) | Adapter reads it from the chat instance |
| `NewClient` sig | `NewClient(baseURL string)` | llama.cpp local, no API key needed |
| History conversion | Adapter reads `chat.Messages()` + current message → builds request | Decouples chat domain from OpenAI wire format |
| Stream readiness | `Stream *bool` field in request, just set to `false` | Easy to toggle later; response types for stream already exist |
| Message mapping | `chat.MessageType.Content` (string) → `ChatCompletionRequestMessageContent{Text: &s}` | Simple text-only mapping for now |

## Dependencies
- Standard library only: `net/http`, `encoding/json`, `testing`, `net/http/httptest`