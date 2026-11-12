# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A coding agent that runs **inside a Cloudflare Sandbox container**, built on the
Cloudflare Agents SDK:

- **Agent runtime:** a Durable Object (`CodeAgent`) hosted by `wrangler dev`.
- **Harness:** OpenCode 2 (`@opencode/sdk/workerd`) via `OpenCodeHarness`.
- **Model provider:** OpenRouter, through OpenCode's native `openrouter` provider.
- **Execution:** a Cloudflare Container attached to the Durable Object
  (`ctx.container`), using `container.exec()` and `@cloudflare/sandbox` `Files`.
- **UI:** an OpenTUI terminal app (there is no browser UI).

The agent loop, transcript, sessions, and crash recovery belong to OpenCode. The
Agents SDK adds the durable object, SQLite storage, and lifecycle jobs. Cloudflare
Containers provide the isolated Linux microVM.

## Stack

| Piece | Version / entry |
| --- | --- |
| Runtime | Bun (required by OpenTUI native FFI) |
| Worker | `wrangler` 4.159, `nodejs_compat` |
| Agents SDK | `agents@0.33.0` (`agents/lifecycle`, `agents/harness/opencode`) |
| OpenCode | `@opencode/sdk@2.2.6`, `@opencode/plugin@2.2.6` |
| Sandbox files | `@cloudflare/sandbox@1.0.3` |
| TUI | `@opentui/core@0.8.3` |
| Tests | Vitest 5 (istanbul) + `bun test` for the TUI |

`bun` is installed at `~/.bun/bin/bun`. It must be on `PATH` for **non-interactive**
zsh too, so the export belongs in `~/.zshenv` (not `~/.zshrc`, which only runs
interactive shells).

## Commands

```sh
bun install

# one-command dev (Docker + wrangler + TUI)
bun run dev

# installed command (production-style local run)
bun run link        # bun link, installs ~/.bun/bin/jujuba
bun run start       # jujuba: build if needed, wrangler + TUI
bun run build:prod  # worker bundle + sandbox image only

# or one process per terminal:
bun run worker     # 127.0.0.1:8787
bun run fix:sidecar # local workaround; bun run dev starts it automatically
bun run tui        # connects to 127.0.0.1:8787, agent "tui"

# tests
bun run test        # vitest run && bun test test/tui
bun run test:unit   # test/unit
bun run test:e2e    # test/e2e (spawns wrangler dev + fake OpenRouter; needs Docker)
bun run test:bun    # test/tui (OpenTUI in memory)
bun run coverage    # both runners + 100% gate
bun run typecheck   # tsc --noEmit
bun run deploy      # wrangler deploy (Workers Paid)
```

Ports: dev uses 8787; `jujuba` uses 8790; e2e uses 7432 (fake LLM) and 8791
(worker). If a previous run left processes behind:

```sh
lsof -ti:8787,8790,8791,7432 | xargs -r kill -9
```

`bun run dev` gives the terminal to the TUI. `wrangler` starts with stdin ignored
and stdout/stderr redirected to `.dev/wrangler.log`, so wrangler keystrokes (for
example `r` or `x`) cannot reach the TUI. Running `bun run worker` directly still
inherits stdio, which is the way to watch its output live.

`bun run dev` requires Docker. The first run builds the sandbox image from
`docker/sandbox/Dockerfile`; later runs reuse it.

## Architecture

```
TUI (Bun, OpenTUI)
  │ HTTP + WebSocket
  ▼
Worker (src/worker.ts)
  │ handleRequest → env.AGENT.getByName(name)
  ▼
CodeAgent (Durable Object, SQLite)
  ├─ Lifecycle (durable jobs / wake after eviction)
  ├─ OpenCodeHarness
  │    └─ OpenCodeWorkerd (loop, transcript, sessions)
  │         └─ plugin: sandbox-tools
  │              └─ CloudflareSandbox
  │                   ├─ container.exec(["timeout", …, "bash", "-lc", cmd])
  │                   └─ Files (readFile/writeFile/stat/readDirectory)
  └─ /api/ws WebSocket → session.events()
        │
        ▼
Cloudflare Container (microVM, own kernel + network)
  └─ /workspace   real files + bash
```

### Directory map

| Path | Responsibility |
| --- | --- |
| `src/worker.ts` | Worker entry: exports `CodeAgent`, delegates to `handleRequest` |
| `src/worker/handler.ts` | HTTP routes, auth, prompt validation, sandbox routes, WebSocket routing |
| `src/agent/durable.ts` | `CodeAgent` Durable Object: harness, sandbox, lifecycle, socket forwarding |
| `src/agent/config.ts` | Builds OpenCode config (provider, model, `coder` agent) |
| `src/agent/prompt.ts` | System prompt for the coding agent |
| `src/agent/env.ts` | `Env` bindings |
| `src/agent/naming.ts` | Agent/session id validation, filesystem-safe agent key |
| `src/agent/session.ts` | Pure mapping between harness results and API shapes |
| `src/projects/naming.ts` | Project name and git-remote validation |
| `src/projects/registry.ts` | Root agent project registry helpers, remote redaction |
| `src/projects/init.ts` | Git clone/init/identity command plans |
| `src/projects/types.ts` | Project and cross-project session API types |
| `src/plugins/tools.ts` | Removes OpenCode local tools and registers sandbox-backed ones |
| `src/sandbox/backend.ts` | `Sandbox` interface used by the tools |
| `src/sandbox/cloudflare.ts` | `ctx.container` + `Files` adapter, snapshots, recovery |
| `src/sandbox/output.ts` | Timeout clamp, cwd validation, shell quoting, output caps |
| `src/sandbox/paths.ts` | `/workspace` path normalization and jail |
| `src/sandbox/ssh.ts` | SSH key decoding, normalization and install constants |
| `src/sandbox/types.ts` | Result types and `SandboxError` |
| `src/tui/api.ts` | HTTP + WebSocket client with reconnect/backoff |
| `src/tui/commands.ts` | Command registry/matching (`/new_project`, `/projects`, `/root`, `$`), top-level session filtering |
| `src/tui/last-session.ts` | Per-agent "last session" state file |
| `src/tui/last-project.ts` | Last mode (project or root) state file |
| `src/tui/view-model.ts` | Pure reducer: harness events → transcript entries |
| `src/tui/tool-view.ts` | File diffs and argument previews derived from tool input |
| `src/tui/transcript.ts` | Pure styled-line view of the transcript |
| `src/tui/gum.ts` | Pure header animation: JU-JU-BA color steps and the blooming ball |
| `src/tui/markdown.ts` | Markdown to styled transcript lines (markers concealed) |
| `src/tui/ansi.ts` | Strips terminal escape sequences from rendered text |
| `src/tui/render.ts` | OpenTUI renderables (excluded from Vitest coverage) |
| `src/tui/main.ts` | TUI entrypoint |
| `src/jujuba/args.ts` | `jujuba` argv parsing, usage text, port/agent validation |
| `src/jujuba/config.ts` | dotenv parsing, env precedence, XDG config/state paths |
| `src/jujuba/fingerprint.ts` | Stable hash of the build inputs (image tag, build cache key) |
| `bin/jujuba.ts` | `jujuba` entrypoint: resolves the checkout, dispatches to `scripts/jujuba` |
| `scripts/jujuba/main.ts` | Subcommands: `init`, `build`, `start`/`run`, `doctor` |
| `scripts/jujuba/build.ts` | `wrangler deploy --dry-run` bundle + `docker build` sandbox image |
| `scripts/jujuba/run.ts` | Production-style local run: `wrangler dev --env-file …`, health wait, TUI |
| `scripts/lib/supervisor.ts` | Child-process supervision shared by `dev.ts` and `jujuba` |
| `scripts/lib/docker.ts` | `docker info` / `docker image inspect` / command runner |
| `scripts/lib/health.ts` | `/health` polling |
| `scripts/lib/port.ts` | Port availability check for `doctor` |
| `scripts/lib/ssh.ts` | Local host key discovery for `dev` and `jujuba` |
| `docker/sandbox/Dockerfile` | Sandbox image: `sandbox-shim` + Git, ripgrep, Python, compilers |
| `scripts/dev.ts` | Docker preflight, starts wrangler, then the TUI |
| `scripts/local-sidecar-fix.ts` | Local-only iptables exemption for the egress sidecar control port |
| `scripts/fix-local-sidecar.ts` | Standalone watcher for the two-terminal flow |
| `scripts/coverage-gate.ts` | Merges Vitest + Bun lcov and enforces 100% |

## Data flow

1. The TUI POSTs `/api/prompt` and opens `/api/ws?agent=<name>&session=<id>`.
   The agent is the root agent or the current project’s agent. The session comes
   from the state file, `/new` (`POST /api/sessions/new`) or `/sessions`
   (`POST /api/sessions`; root mode uses `/api/sessions/all`). A `$` command
   bypasses the model and runs through `POST /api/sandbox/exec`.
2. `handleRequest` validates the agent/session and calls the DO RPC.
3. A project is its own `CodeAgent`, container and OpenCode store. The root agent
   keeps the project registry in DO storage and aggregates project sessions for
   root `/sessions`.
4. `OpenCodeHarness` runs the model loop; the model calls `read`, `write`,
   `edit`, `patch`, `glob`, `grep`, `list`, `shell`.
5. Those tools are implemented by `CloudflareSandbox`, which starts the agent's
   container on first use and then uses `container.exec` and `Files`.
6. `session.events()` streams `text_delta`, `tool_start`, `tool_end`, `run_end`,
   etc. over the WebSocket. Its opening snapshot also carries the session title,
   provider and model, so the TUI header needs no extra request.
7. `view-model.ts` reduces those events into the TUI transcript.

## Invariants and gotchas

- **workerd has no filesystem or shell.** OpenCode's built-in `read`, `write`,
  `edit`, `patch`, `glob`, `grep`, `shell`, `list` are removed and replaced by
  plugin tools. The container is the only place commands run.
- **`/workspace` is virtual.** `normalizeWorkspacePath` rejects absolute paths
  outside it and any `..` escape. `Files` itself does not restrict paths, so the
  adapter must keep the jail.
- **`container.start()` returns before the container is ready.** `exec()` waits
  for a starting container; `Files` does not. Always call `ensureRunning()` before
  file operations.
- **The container disk is ephemeral.** Files survive between turns while the
  container is warm (inactivity timeout) and are lost when it stops. Snapshots are
  stored in Durable Object storage and restored on the next start. `save()` uses
  an exclusive queue so it cannot race a tool write.
- **`sandbox-shim` version must match `@cloudflare/sandbox`.** The Dockerfile
  copies it from `docker.io/cloudflare/sandbox:1.0.3`. A mismatch throws
  `SandboxProtocolError`.
- **Instance types for `durable_object` are `lite` and `standard-1..4`.** The
  runtime does not accept `basic` or the legacy `dev`/`standard` aliases. Default
  to `standard-1`; `lite` is only 256 MiB.
- **Internet is on by default.** `SANDBOX_INTERNET=false` blocks outbound traffic.
  A deployed sandbox cannot read Worker bindings or secrets either way.
- **`fetch` must stay bound to the global scope.** In workerd, calling a stored
  reference (`const f = fetch; f(...)`) throws `Illegal invocation`. Use
  `(input, init) => fetch(input, init)`.
- **`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on.** Build
  optional properties with conditional spreads; do not assign `undefined`.
  Use `!` only where the index is guaranteed.
- **The worker is single-tenant per agent name.** `agentKey(ctx.id.name)` scopes
  the sandbox. Keep agent names within `^[A-Za-z0-9._-]{1,64}$`.
- **A project is another agent, not a directory.** `createProject` allocates
  `project-<uuid>`, calls that DO's `initProject()`, and then stores the record in
  the root agent's `projects.registry`. Do not reuse a user-chosen `TUI_AGENT` as
  a project agent id, and do not put all projects in one `/workspace`.
- **The root registry is per root agent.** `TUI_AGENT` selects both the root
  namespace and the project registry; changing it exposes a different set of
  projects.
- **Sessions are addressed by `(agent, id)`, never id alone.** `ses_root` exists
  in the root agent and in every project. The TUI passes the agent to prompt,
  abort, sessions, and the WebSocket; root `/sessions` must keep the project and
  agent labels.
- **Project creation is git init or clone, never both.** A remote clones into the
  empty `/workspace`; no remote runs `git init -b main`. Failures reset that
  project's sandbox and are not registered. The image must keep `openssh-client`
  because SSH remotes need the `ssh` binary; git runs with
  `GIT_TERMINAL_PROMPT=0` and `StrictHostKeyChecking=accept-new`.
- **SSH keys are installed before any sandbox operation.** `CloudflareSandbox`
  decodes `SSH_KEY_BASE64` / `SSH_KNOWN_HOSTS_BASE64` once, writes them through
  `Files` (never through a shell command), secures `/root/.ssh`, and resets the
  one-install flag on `reset()` and container start. `#installSsh()` must not call
  `#exec()`, which would recurse through `#ensureRunning()`; use `#runRaw()`.
  Never log the key. Local runners auto-forward `~/.ssh/id_*`; deployed runs need
  the base64 values as Worker secrets.
- **Containers and snapshots contain the SSH key.** Treat a project snapshot like
  the private key itself. A restored snapshot may already have `/root/.ssh`; the
  installer overwrites it with the current env key on the next sandbox operation.
- **A leading `/` in the TUI is always a command.** `parseCommand` returns
  `unknown` for anything the registry lacks, and `main.ts` opens the command
  menu (or the matches) instead of prompting. Never let slash text fall through
  to the model.
- **A leading `$` in the TUI is a shell command.** `parseCommand` returns
  `shell` for the first `$`; `main.ts` runs it through `POST /api/sandbox/exec`
  and adds a `shell` transcript entry. It never reaches the model. A bare `$`
  is usage. Shell entries are local TUI state and do not survive a session
  switch or a snapshot rebuild.
- **A saved session id can be stale.** `/api/ws` validates `?session=` against
  `harness.sessions.list()` and falls back to root; the snapshot reports the id
  actually used, so the TUI overwrites the state file instead of reconnecting to
  a missing session forever. Do not make `#socket` throw for an unknown id.
- **`.dev.vars` wins over `wrangler.jsonc` vars locally.** `scripts/dev.ts`
  rewrites it from the environment before starting wrangler. The e2e global
  setup also rewrites it (fake LLM) and restores the previous content on
  teardown, including on failure. `jujuba` never reads or writes it: it
  passes `--env-file <state>/env`, which replaces `.dev.vars` for that run.
- **`jujuba` keeps its state out of the repository.** Config is
  `~/.config/jujuba/env` (mode 600), state is
  `~/.local/state/jujuba` (runtime env file, bundle, build fingerprint,
  `wrangler-state`, TUI last-session and last-project). Process env wins over the
  config file.
  Local runs drop `AUTH_TOKEN` because the TUI sends no `Authorization` header.
- **The build step must not upload.** `jujuba build` runs
  `wrangler deploy --dry-run --outdir <state>/dist --containers-rollout none`
  (otherwise dry-run still builds the container image), then
  `docker build -t jujuba-sandbox:<fingerprint>`. `wrangler dev` builds its
  own image tag on every start; the explicit build only warms Docker's cache
  and validates the Dockerfile.
- **Do not log secrets.** `OPENROUTER_API_KEY` is a secret; `.dev.vars`, `.dev/`,
  `workspace/`, and `coverage/` are gitignored. `jujuba init` writes the key
  to a 600-mode file and never prints it.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | OpenRouter credential |
| `OPENROUTER_MODEL` | yes | Model id, e.g. `deepseek/deepseek-v4.1-flash-1017` |
| `OPENROUTER_BASE_URL` | no | Gateway / test override; default OpenRouter |
| `SANDBOX_INSTANCE` | no | `lite`, `standard-1` … `standard-4` (default `standard-1`) |
| `SANDBOX_INTERNET` | no | `true` (default) or `false` |
| `SANDBOX_INACTIVITY_MS` | no | Container keep-warm timeout (default 600000, max 21600000) |
| `SSH_KEY_BASE64` | no | Base64 private key installed in every sandbox (local auto-detected) |
| `SSH_KNOWN_HOSTS_BASE64` | no | Base64 known_hosts installed with the key (local auto-detected) |
| `SSH_KEY_PATH` | no | Local-only path to the key to forward |
| `SSH_KNOWN_HOSTS_PATH` | no | Local-only known_hosts path to forward |
| `AUTH_TOKEN` | no | If set, `/api/*` requires `Authorization: Bearer` |
| `TUI_URL` / `TUI_AGENT` | no | TUI worker URL / agent name |
| `TUI_STATE_DIR` | no | Directory for `last-session-<agent>.json` and `last-project-<agent>.json` (default `$XDG_STATE_HOME/jujuba` or `~/.local/state/jujuba`) |
| `JUJUBA_CONFIG` | no | `jujuba` config file (default `~/.config/jujuba/env`) |
| `JUJUBA_STATE` | no | `jujuba` state directory (default `~/.local/state/jujuba`) |
| `JUJUBA_PORT` / `JUJUBA_AGENT` | no | `jujuba` worker port (default 8790) / agent name (default `tui`) |

The current committed default model is set in `wrangler.jsonc`; the local
`.dev.vars` (regenerated by `bun run dev`) is what `wrangler dev` actually reads.
`scripts/dev.ts` falls back to `deepseek/deepseek-v4.1-flash-1017` when
`OPENROUTER_MODEL` is unset, which matches `wrangler.jsonc`. `jujuba` reads the
same defaults from `~/.config/jujuba/env` instead.

### `jujuba` (installed CLI)

`bun link` installs `bin/jujuba.ts` as `~/.bun/bin/jujuba`. Default command
is `run`: build if the fingerprint changed, start `wrangler dev` with
`--env-file` and `--persist-to` under the state directory, wait for `/health`,
then spawn the TUI with `TUI_STATE_DIR` inside the state directory. `start`
skips the build, `build` only builds, `init` writes the config, `doctor` checks
bun/node/Docker/wrangler/key/port.

Pure logic (argv, dotenv, paths, fingerprint) lives in `src/jujuba/` and is
covered by `test/unit/jujuba-*.spec.ts` (the 100% gate applies). Process
spawning, filesystem writes and network checks live in `scripts/jujuba/` and
`scripts/lib/` (excluded from coverage, like `dev.ts`).

## Testing

- `test/unit/**` — Vitest, Node environment, no network. Path jail, output caps,
  the Cloudflare adapter with fake `ctx.container`/`Files`, config, plugin
  registration, HTTP handler, project naming/registry/init commands, TUI
  view-model, state files and client.
- `test/e2e/**` — Vitest with `globalSetup`: starts a fake OpenRouter and a real
  `wrangler dev` with a real container. Docker must be running. The setup starts
  the same local sidecar watcher as `bun run dev`, so the container tests run even
  when the egress sidecar would otherwise block its control port. The model is
  scripted through `POST /__reset` and `POST /__enqueue`; only the LLM is mocked.
  If the container still cannot start, the setup probes it and skips the
  container-dependent cases; set `E2E_REQUIRE_CONTAINER=1` to fail instead (use
  this in CI).
- `test/tui/**` — `bun test` with `@opentui/core/testing` (`createTestRenderer`),
  in-memory, no TTY.

Coverage policy: **100%** lines/functions/branches/statements. Vitest is the
authoritative source for files it covers; Bun's lcov is used only for
`src/tui/render.ts`, which Vitest cannot execute. `scripts/coverage-gate.ts`
merges both and exits non-zero below 100%. When adding code:

- Prefer extracting pure logic out of the adapter so it can be unit tested.
- Cover error paths and edge cases (empty input, escapes, timeouts, aborts,
  snapshot failures, missing images).
- Use `/* istanbul ignore next */` only for genuinely unreachable defensive
  branches, and leave a comment explaining why.

## Extending

**New tool:** add a method to the `Sandbox` interface in
`src/sandbox/backend.ts`, implement it in `src/sandbox/cloudflare.ts`, add a
definition in `src/plugins/tools.ts`, and test it in
`test/unit/cloudflare-sandbox.spec.ts` and `test/unit/tools.spec.ts`.

**New HTTP route:** add it to `src/worker/handler.ts`, test the pure handler in
`test/unit/handler.spec.ts`, and add an e2e case if it touches the DO.

**Project behavior:** keep name/remote validation and command construction pure in
`src/projects/`, add handler/TUI client tests, and extend the project e2e case.
Project creation must call `initProject()` before writing the root registry, and
`initProject()` must stay idempotent because a retry can find an existing `.git`.

**Change the model:** set `OPENROUTER_MODEL` (and `OPENROUTER_BASE_URL` if using
a gateway). No code change is needed; the provider is registered from env.

**Change the sandbox image:** edit `docker/sandbox/Dockerfile`. Keep the
`sandbox-shim` tag equal to the installed `@cloudflare/sandbox` version. Delete
old local images with `docker image prune` if builds pile up.

## Known limitations

- `bun run dev` hides wrangler output in `.dev/wrangler.log`; use the
  two-terminal flow to watch it live.
- `wrangler dev` does not always die on `SIGTERM`, leaving `workerd` holding the
  port. Clean up with `lsof -ti:8787 | xargs -r kill -9`.
- Local container startup depends on the Docker engine and workerd version. On
  some combinations the egress sidecar's TPROXY rules block its own control port
  (39001). `bun run dev` and `bun run test:e2e` start a watcher that exempts only
  that port; for the two-terminal flow run `bun run fix:sidecar`. Set
  `SANDBOX_LOCAL_FIX_EGRESS=false` to disable the watcher. This is local-only;
  deployed containers do not use the local sidecar.
- The DO reports SQLite `SQLITE_BUSY` under concurrent local instances; run one
  dev worker at a time.
- The sandbox starts empty; there is no automatic sync with a local workspace.
- TUI diffs are synthesized from tool input, because the sandbox-backed tools
  carry no file metadata. A `write` that overwrites an existing file still looks
  like an addition, and a file removed by a shell command has no diff. `edit`
  shows the replaced block without surrounding context or real line numbers;
  `patch` keeps its own hunk headers.
- **`ScrollBoxRenderable` draws its border outside its layout box.** With a long
  transcript the box overflows the flex layout and pushes the header and status
  off screen. Keep the transcript border on a wrapper `BoxRenderable` and give
  the ScrollBox `width`/`height` `100%` inside it.
- **Tool output is untrusted and often colorized.** The transcript strips ANSI
  sequences (`src/tui/ansi.ts`) before rendering. OpenTUI draws text literally
  and drops the ESC byte, so without stripping a colored line shows `[32m`
  fragments instead of text.
- TUI markdown is a line-oriented subset: fenced code is styled as a block but
  not language-highlighted (that would need tree-sitter and an async render
  path), tables are capped at 76 columns and truncate wide cells, and task
  lists, reference links, images and raw HTML render as plain text.
- Container snapshots and `scheduling_policy: "durable_object"` are public beta.
  Moving an existing Durable Object class to this policy is a one-way switch.
