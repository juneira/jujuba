# AGENTS.md

Small terminal chat client for OpenAI-compatible Chat Completions APIs (module `github.com/juneira/jujuba`). No CI, no lint config beyond `go vet` + `gofmt` — verification is `make lint && make test`.

## Commands

- `make start` — run the interactive CLI (stdin REPL); `make build` produces the `jujuba` binary
- `make test` / `make lint` / `make fix_lint` — vet + gofmt check / gofmt rewrite
- Single test via `go test ./openai -run TestAsk_SuccessResponse`; stdlib `testing` only

## Required setup

- `main.go` **exits immediately if `.env` is missing** (`godotenv.Load` is fatal). Run `cp .env.sample .env` first. `.env` is gitignored.
- Env vars: `OPENAI_BASE_URL` (default `http://localhost:1234`, LM Studio-style), `MODEL_ID` (default `deepseek/deepseek-v4-flash-0731`), `OPENAI_API_KEY`, `STREAM` (`1`/`true`/`yes` enables SSE streaming).

## Architecture

- `chat/` — provider-agnostic core: `Chat` holds history, providers implement `chat.Provider` (`Ask`, `AskStream`). Keep it free of `openai` imports.
- `openai/` — the provider implementation; posts to `{baseURL}/v1/chat/completions`. The base URL must **not** include `/v1` — the client appends the full path itself.
- Tests never hit a live API: `openai` tests use `httptest` servers simulating JSON and SSE responses; `chat` tests use a mock provider.
- `docs/external/` is a vendored OpenAI API reference (`openapi.yaml` + derived docs), the source of truth for endpoint shapes.

## Schema types are hand-written, not generated

`openai/chat_completation_schema.go` manually mirrors the Chat Completions schema from `docs/external/openapi.yaml` (text-only subset — no image/audio content). Conventions to follow when touching it:

- `oneOf`/`anyOf` unions are structs with exactly one populated pointer field, never `any` (custom marshal/unmarshal lives in `openai/marshal.go`)
- Optional/nullable fields are pointers with `omitempty`
- Update both schema file and `openapi.yaml`-derived docs when changing request/response shapes

Only runtime dependency is `joho/godotenv`.
