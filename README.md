# JUJUBA

A coding agent that runs shell commands and edits files inside a Cloudflare
Sandbox container, with a terminal UI.

Built on the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/),
the [OpenCode 2 harness](https://opencode.ai/docs/build/sdk/) running inside a
Durable Object, [Cloudflare Containers](https://developers.cloudflare.com/sandbox/)
for execution, and [OpenTUI](https://opentui.com/) for the terminal interface.

```text
┌────────────────────────────── your machine ──────────────────────────────┐
│  TUI (OpenTUI / Bun)                                                      │
│    │ HTTP + WebSocket                                                     │
│    ▼                                                                      │
│  wrangler dev :8787                                                       │
│    └─ CodeAgent (Durable Object, SQLite)                                  │
│         ├─ Lifecycle (durable jobs, wake after eviction)                  │
│         ├─ OpenCodeHarness → OpenCodeWorkerd (loop, sessions, tools)      │
│         ├─ /api/ws → session events                                       │
│         └─ ctx.container ──► Cloudflare Container (microVM)               │
│                                 ├─ container.exec: bash -lc               │
│                                 └─ Files: read/write/stat/readDirectory   │
└───────────────────────────────────────────────────────────────────────────┘
```

## Why

- **Isolated execution.** Each agent gets a Cloudflare Container: a microVM with
  its own kernel and network. The model's commands cannot read the Worker's
  bindings, secrets, or storage.
- **Real Linux.** `shell`, `read`, `write`, `edit`, `patch`, `glob`, `grep`, and
  `list` all operate on a real Debian filesystem with Node.js, Bun, Git, Python,
  compilers, and ripgrep available.
- **Durable sessions.** OpenCode keeps transcript and session state in the Durable
  Object's SQLite; the Agents SDK lifecycle wakes the object after an eviction.
- **Snapshots.** The container disk is ephemeral. `POST /api/sandbox/save`
  snapshots the workspace into Durable Object storage and the next container
  restores it.
- **Terminal UI.** No browser, no Vite, no static assets. One process, keyboard
  driven.

## Requirements

- [Bun](https://bun.sh/) 1.4+ (required by OpenTUI's native FFI)
- Node.js 22+ (used by `wrangler dev`)
- An [OpenRouter](https://openrouter.ai/) API key
- Docker running locally for `wrangler dev`
- A Workers Paid plan to deploy Containers

Bun must be on `PATH` for non-interactive shells too. Add it to `~/.zshenv`, not
only `~/.zshrc`:

```sh
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

## Quick start

```sh
bun install
export OPENROUTER_API_KEY=sk-or-...
bun run dev
```

`bun run dev` regenerates `.dev.vars`, checks that Docker is running, starts
`wrangler dev`, waits for `/health`, and then opens the TUI. The TUI owns the
terminal; wrangler runs with stdin ignored and writes to `.dev/wrangler.log`. If
wrangler exits, its log tail is printed after the TUI closes.

The first `wrangler dev` builds the sandbox image from
`docker/sandbox/Dockerfile`, so it takes longer than later runs. The image is
rebuilt when the Dockerfile or its inputs change.

### Install as a command

`bun run dev` is for development. For day-to-day use, install the `jujuba`
command once:

```sh
bun link      # registers ~/.bun/bin/jujuba (already on your PATH)
jujuba init   # writes ~/.config/jujuba/env (mode 600)
jujuba        # build if needed, start the worker, open the TUI
```

`jujuba` is the same flow as `bun run dev`, with production-style settings:

1. `jujuba build` compiles the worker bundle
   (`wrangler deploy --dry-run --outdir …`, no upload) and builds the sandbox
   image (`docker build -t jujuba-sandbox:<fingerprint>`). Both are
   incremental, and a matching fingerprint in `~/.local/state/jujuba/build.json`
   skips the step entirely.
2. `wrangler dev` starts on `127.0.0.1:8790` with
   `--env-file ~/.local/state/jujuba/env` (generated, mode 600) and
   `--persist-to ~/.local/state/jujuba/wrangler-state`, so the repository's
   `.dev.vars` and `.wrangler/` are never touched.
3. Once `/health` answers, the TUI opens with its state in
   `~/.local/state/jujuba/tui`.

Useful commands and flags:

```sh
jujuba start        # run without the build step
jujuba build        # build only
jujuba doctor       # check bun, node, Docker, wrangler, the API key, the port
jujuba --port 9000  # another port
jujuba --agent work # another agent (separate sessions)
jujuba --help
```

Configuration lives in `~/.config/jujuba/env` (dotenv). The process
environment wins over the file; keys that are absent fall back to the `vars` in
`wrangler.jsonc`.

```sh
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash-1017
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
SANDBOX_INSTANCE=standard-1
SANDBOX_INTERNET=true
SANDBOX_INACTIVITY_MS=600000
```

`JUJUBA_CONFIG`, `JUJUBA_STATE`, `JUJUBA_PORT` and `JUJUBA_AGENT`
override the paths, the port and the agent. `AUTH_TOKEN` is ignored locally
because the worker binds to loopback and the TUI does not send an
`Authorization` header yet.

Sessions started by `jujuba` live in `~/.local/state/jujuba/wrangler-state`,
separate from the ones `bun run dev` keeps in `.wrangler/state`. Copy that
directory if you want the dev history to show up.

### Three terminals (optional)

To see wrangler output live, run the worker and the TUI in separate terminals:

```sh
# terminal 1 — worker (inherits stdio)
bun run worker

# terminal 2 — TUI
bun run tui
```

Check the worker: `curl http://127.0.0.1:8787/health`.

### Local container startup

On some Docker/kernel combinations, workerd's egress sidecar intercepts its own
control port (39001), so the first sandbox command fails with
`Container failed to start` or `exec() cannot be called on a container that is not running`.
`bun run dev` starts a watcher that adds a local iptables exemption for that port.

For the two-terminal flow, run the watcher in a third terminal:

```sh
bun run fix:sidecar
```

Set `SANDBOX_LOCAL_FIX_EGRESS=false` to disable the watcher. It only affects local
`wrangler dev`; deployed containers use Cloudflare's sidecar directly.

### TUI commands and keys

| Input / key | Action |
| --- | --- |
| `/new_project <name> [remote]` | Create a project and switch to it |
| `/projects` | Pick a project (`↑`/`↓`, `Enter`, `Esc`) |
| `/root` | Return to root mode |
| `/new` | Create a session in the current project, or in root |
| `/sessions` | Pick a session; root mode lists every project’s sessions |
| `$ <command>` | Run a shell command in the current agent’s `/workspace` |
| `Enter` | Send the prompt, or run the command |
| `Esc` | Close a menu, or abort the running turn |
| `Ctrl+C` | Exit |

A leading `/` always means a command, never a message. A leading `$` always
means a shell command in the current agent’s `/workspace`; it runs directly and
never reaches the model. While you type `/`, the matching commands are listed
above the prompt: `↑`/`↓` move the highlight and `Enter` runs the highlighted
command (the first match is highlighted as soon as the list appears). Text that
matches no command is never sent to the model — `Enter` reports the unknown name
and shows the full list; `Esc` returns to typing.

### Projects

Each project has its own agent name, Durable Object, container, `/workspace`,
and snapshots. Sessions created in a project stay in that project. Root mode is
the projectless namespace: its sessions and workspace are separate from every
project, and `/sessions` there lists root sessions plus every project session,
labelled by project. Picking a project session switches to that project first.

```sh
/new_project demo                         # empty repo: git init -b main
/new_project demo https://example.com/x.git  # clone it into /workspace
/projects                                 # switch projects
/root                                     # back to the projectless namespace
```

Project names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`; `root` is
reserved. The internal agent id is opaque (`project-<uuid>`), so it cannot
collide with a user-chosen `TUI_AGENT`. The registry belongs to the root agent:
changing `TUI_AGENT` starts a separate project namespace. `/projects` redacts
credentials embedded in a remote URL.

Project creation starts the project’s container and may take a while, especially
when cloning. HTTPS and SSH remotes both work; the image includes `git` and
`openssh-client`. New host keys are accepted on first use with
`StrictHostKeyChecking=accept-new`. Private HTTPS remotes need credentials in the
sandbox. Git terminal prompts are disabled so a missing credential fails instead
of hanging. A failed clone or init resets the project sandbox and does not
register the project.

On local runs, `bun run dev` and `jujuba` automatically forward the first
private key they find at `~/.ssh/id_ed25519`, `~/.ssh/id_ecdsa`, or
`~/.ssh/id_rsa`, plus `~/.ssh/known_hosts`. Set `SSH_KEY_PATH` to use another
identity. The key is installed in every sandbox at `/root/.ssh/id_ed25519`
(mode 600) and is available to project creation and to the agent’s own
`git clone`/`git push` commands. Passphrase-protected keys need an SSH agent or
an unencrypted copy, because the sandbox has no terminal to prompt for a
passphrase.

### Transcript

Assistant text streams into the transcript. Each tool call gets a highlighted
header with its main argument, a status marker (`○` running, `✔` done, `✖`
failed), and diff stats when it touched files. File tools also render a diff:

```text
▌ write  /workspace/src/hello.ts  +3 −0  ✔
  ┌ added /workspace/src/hello.ts
  │ +export function hello(): string {
  │ +  return "hello"
  │ +}
  └
```

`write` shows its content as added lines, `edit` diffs the replaced block, and
`patch` renders the unified diff it applied (a file removed by the patch is
marked `deleted`). The TUI only sees a tool's input, so overwriting an existing
file with `write` still looks like an addition, and a file removed by a shell
command appears as ordinary shell output rather than a diff. Long diffs show 30
lines per file; tool output shows 15 lines (the head for `read`/`grep`/`glob`/
`list`, the tail for `shell`) and reports how many lines were hidden. ANSI
escape sequences in command output are stripped before display.

A `$` command gets its own block, and its tail is kept like `shell` output:

```text
▌ $ git status  ✔
  exit: 0
  On branch main
```

Assistant text is rendered as markdown: headings, bold, italic, strikethrough,
inline code and links lose their syntax markers and gain a style, blockquotes
and lists keep a `│` gutter or a bullet, pipe tables render as bordered boxes
with alignment taken from the delimiter row, and fenced code blocks render with
a `│` gutter and a dim language label. Code inside fences is not
language-highlighted, tables are capped at 76 columns (wide cells are truncated
with `…`), and task lists and reference links are shown as plain text.

The header above the transcript shows the current project (or `root`), the
session name (its OpenCode title when there is one, otherwise the id), and the
provider and model the agent is using. On the right, the `JUJUBA` brand is drawn
in bubblegum pink: the highlighted syllable changes every second while a ball
blooms from a dot to a full spark, and the cycle starts over with the word. The
word itself never changes case. The status line below the prompt keeps the run
state and the last error.

The TUI reopens the last session and mode you used. It records session ids in
`$XDG_STATE_HOME/jujuba` (default `~/.local/state/jujuba`), one file per
agent, and the selected project in `last-project-<root-agent>.json`. If the
session no longer exists the worker falls back to that agent’s root session and
the TUI records the real id instead. A missing project falls back to root mode.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | — | OpenRouter credential |
| `OPENROUTER_MODEL` | yes | `deepseek/deepseek-v4.1-flash-1017` (in `wrangler.jsonc`) | Model id |
| `OPENROUTER_BASE_URL` | no | OpenRouter | Gateway or test override |
| `AUTH_TOKEN` | no | — | Requires `Authorization: Bearer` on `/api/*` |
| `SANDBOX_INSTANCE` | no | `standard-1` | `lite`, `standard-1` … `standard-4` |
| `SANDBOX_INTERNET` | no | `true` | `false` blocks outbound network |
| `SANDBOX_INACTIVITY_MS` | no | `600000` | Keep the container warm after a turn (max 6 hours) |
| `SSH_KEY_BASE64` | no | local auto-detect | Base64 private key installed in every sandbox |
| `SSH_KNOWN_HOSTS_BASE64` | no | local auto-detect | Base64 `known_hosts` installed with the key |
| `SSH_KEY_PATH` | no | — | Local-only path to a private key to forward |
| `SSH_KNOWN_HOSTS_PATH` | no | `~/.ssh/known_hosts` | Local-only `known_hosts` path to forward |
| `TUI_URL` | no | `http://127.0.0.1:8787` | Worker URL |
| `TUI_AGENT` | no | `tui` | Root agent / sandbox name and project namespace |
| `TUI_STATE_DIR` | no | `${XDG_STATE_HOME:-~/.local/state}/jujuba` | Where the TUI remembers the last session and project mode |
| `JUJUBA_CONFIG` | no | `~/.config/jujuba/env` | `jujuba` config file |
| `JUJUBA_STATE` | no | `${XDG_STATE_HOME:-~/.local/state}/jujuba` | `jujuba` state directory |
| `JUJUBA_PORT` | no | `8790` | `jujuba` worker port |
| `JUJUBA_AGENT` | no | `tui` | `jujuba` agent name |

`.dev.vars` is gitignored. The e2e suite rewrites it with a fake LLM and restores
the previous content on teardown.

`basic` is listed in the Containers limits table but the `durable_object`
scheduling policy does not accept it at runtime, so this project defaults to
`standard-1` (4 GiB RAM, 1/2 vCPU, 8 GB disk). Use `lite` for cheap, short
commands and `standard-2` or larger for heavy builds.

## How it works

1. The TUI sends a prompt to `POST /api/prompt` and opens
   `/api/ws?agent=<name>&session=<id>`, using the session it restored at startup,
   created with `/new`, or picked with `/sessions`. The agent is the root agent
   or the current project’s agent.
2. The Worker routes to that `CodeAgent` Durable Object. A project is a separate
   object with its own sessions, container and snapshots; the root object keeps
   the project registry and serves cross-project session listings.
3. `OpenCodeHarness` runs the OpenCode loop; OpenCode owns the transcript,
   sessions, retries, and recovery.
4. OpenCode's local tools are unavailable in workerd, so a plugin removes them and
   registers sandbox-backed versions with the same names and semantics.
5. Those tools call `CloudflareSandbox`, which starts the agent's container on
   first use and then uses `container.exec` and `Files`.
6. `/workspace` is the container's workspace. `EXEC` commands run with
   `timeout --kill-after=5 … bash -lc`, so a hung command and its children are
   killed. Output is capped before it reaches the model.
7. `session.events()` streams deltas, tool calls, and run results over WebSocket;
   the TUI reducer turns them into the transcript.

## Session API

| Route | Body | Purpose |
| --- | --- | --- |
| `POST /api/sessions` | `{agent}` | List one agent’s sessions, subagent sessions included |
| `POST /api/sessions/all` | `{agent}` | Root sessions plus every registered project’s sessions |
| `POST /api/sessions/new` | `{agent}` | Create a top-level session |
| `POST /api/prompt` | `{agent, text, session?}` | Send a prompt to a session (default root) |
| `POST /api/abort` | `{agent, session?}` | Stop the session's running turn |
| `GET /api/state?agent=&session=` | — | Transcript and pending work |
| `GET /api/ws?agent=&session=` | — | Snapshot, then live events |
| `POST /api/projects` | `{agent}` | List projects registered in that root agent |
| `POST /api/projects/new` | `{agent, name, remote?}` | Create a project, clone or init git, return it |

An unknown `session` on `/api/ws` falls back to that agent’s root session
(`ses_root`); the snapshot reports the id actually used. Root sessions and each
project can all have a `ses_root`, so a session is always addressed by
`(agent, session id)`, never by id alone.

## Sandbox API

The worker exposes these routes under `/api/sandbox/*` (subject to `AUTH_TOKEN`):

| Route | Body | Purpose |
| --- | --- | --- |
| `GET /api/sandbox/status?agent=` | — | Backend, running state, image, snapshot id |
| `POST /api/sandbox/save` | `{agent}` | Snapshot the workspace |
| `POST /api/sandbox/reset` | `{agent}` | Destroy the container and clear the snapshot |
| `POST /api/sandbox/read` | `{agent, path, offset?, limit?}` | Read a workspace file |
| `POST /api/sandbox/write` | `{agent, path, content}` | Write a workspace file |
| `POST /api/sandbox/exec` | `{agent, command, cwd?, timeoutMs?}` | Run a command in `/workspace` |

Use `save` after work you want to keep. The container's inactivity timeout keeps
the files between turns, but a stopped container starts from its last snapshot or
from the image. `CodeAgent` also snapshots after each completed turn while the
container is running. Snapshots expire after 30 days.

## Project layout

```text
src/
  worker.ts              Worker entry
  worker/handler.ts      HTTP routes, auth, validation, WS routing
  agent/durable.ts       CodeAgent (Durable Object)
  agent/config.ts        OpenCode provider/model/agent config
  agent/prompt.ts        System prompt
  projects/naming.ts     Project name and git-remote validation
  projects/registry.ts   Root agent's project registry helpers
  projects/init.ts       Git clone/init command plans
  projects/types.ts      Project and cross-project session types
  plugins/tools.ts       Sandbox-backed OpenCode tools
  sandbox/backend.ts     Sandbox interface used by the tools
  sandbox/cloudflare.ts  ctx.container + Files adapter
  sandbox/output.ts      Timeout, cwd, quoting and output caps
  sandbox/paths.ts       /workspace normalization and jail
  sandbox/types.ts       Result types and SandboxError
  tui/api.ts             HTTP + WebSocket client
  tui/commands.ts        Slash commands and session filtering
  tui/last-session.ts    Reads/writes the last session id
  tui/last-project.ts    Reads/writes the last project mode
  tui/view-model.ts      Pure event reducer
  tui/render.ts          OpenTUI renderables
  tui/markdown.ts        Markdown to styled transcript lines
  tui/transcript.ts      Styled transcript lines for the TUI
  tui/tool-view.ts       Tool diffs and argument summaries
  tui/main.ts            TUI entrypoint
docker/
  sandbox/Dockerfile     Sandbox image (sandbox-shim + tools)
scripts/
  dev.ts                 Starts wrangler and the TUI
  coverage-gate.ts       Merges lcov and enforces 100%
test/
  unit/                  Pure Node tests (Vitest)
  e2e/                   Real wrangler + fake OpenRouter + Docker
  tui/                   OpenTUI in-memory tests (bun test)
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | wrangler + TUI |
| `bun run start` | `jujuba` (build if needed, wrangler + TUI) |
| `bun run build:prod` | worker bundle + sandbox image only |
| `bun run link` | `bun link`, installs the `jujuba` command |
| `bun run worker` | `wrangler dev` only |
| `bun run tui` | TUI only |
| `bun run deploy` | `wrangler deploy` (Workers Paid + container image push) |
| `bun run test` | Vitest (unit + e2e) + `bun test test/tui` |
| `bun run test:unit` | unit only |
| `bun run test:e2e` | e2e only (requires Docker) |
| `bun run test:bun` | TUI only |
| `bun run coverage` | both runners + 100% gate |
| `bun run typecheck` | `tsc --noEmit` |

## Testing

```sh
bun run test
```

- **Unit** (`test/unit`) exercises the pure logic: path jail, output caps, the
  Cloudflare adapter with fake `ctx.container`/`Files`, config, plugin
  registration, HTTP handler, TUI reducer and client.
- **E2E** (`test/e2e`) starts a real `wrangler dev` with a real container and
  scripts the model through a fake OpenRouter server. Only the LLM is mocked.
  Docker must be running. The setup also starts the local sidecar watcher, so
  container tests run on Docker/kernel combinations where the egress sidecar
  blocks its own control port. If the container still cannot start, the suite logs
  a warning and skips the container-dependent cases; set
  `E2E_REQUIRE_CONTAINER=1` to fail instead (use this in CI).
- **TUI** (`test/tui`) renders with `@opentui/core/testing` in memory, with no TTY.

Coverage is enforced at **100%** for the measured modules. Vitest is authoritative
for the files it covers; Bun's report is used only for `src/tui/render.ts`, which
Vitest cannot execute. `scripts/coverage-gate.ts` merges both reports and fails
below 100%.

```sh
bun run coverage
```

## Deploying

```sh
bunx wrangler login
bunx wrangler secret put OPENROUTER_API_KEY
bunx wrangler secret put SSH_KEY_BASE64 < <(base64 -w0 ~/.ssh/id_ed25519)
# optional:
bunx wrangler secret put SSH_KNOWN_HOSTS_BASE64 < <(base64 -w0 ~/.ssh/known_hosts)
bun run deploy
```

`wrangler deploy` builds the image from `docker/sandbox/Dockerfile`, pushes it to
Cloudflare's registry, and deploys the Worker. The SSH secrets are optional; a
deployed Worker cannot read your local `~/.ssh`, so they must be present as
secrets there. Set `AUTH_TOKEN` for any public deployment.
`SANDBOX_INTERNET=true` lets model-generated commands reach the Internet; set it
to `false` for untrusted prompts.

## Security notes

- A deployed sandbox is a **microVM with its own kernel and network**. It cannot
  read the Worker's bindings, secrets, or storage.
- Locally, `wrangler dev` runs the container in Docker, so local isolation is the
  Docker boundary, not the production microVM.
- With the `durable_object` scheduling policy, `exec({ user })` only sets file
  ownership; every process has root capabilities inside the container. The
  microVM, not the uid, is the boundary.
- Internet access is on by default. Model-generated commands can reach any host
  and exfiltrate what they can read. Use `SANDBOX_INTERNET=false` when that
  matters.
- Command and file output is untrusted model input. Treat it as data, not
  instructions.
- Snapshots can contain credentials written into the sandbox, including the
  forwarded SSH key. Keep `AUTH_TOKEN` set for any non-local deployment and treat
  those snapshots like the key itself.

## Limitations / roadmap

- The container disk is ephemeral. Save a snapshot before the inactivity timeout
  if you need the files later.
- Each project keeps its own container. Several warm projects consume one
  container instance each until their inactivity timeouts expire.
- Project deletion and renaming are not implemented.
- Private git remotes need credentials already available in the sandbox; git
  terminal prompts are disabled during project creation.
- The sandbox starts empty for root sessions. Clone a repository or write files
  through `/api/sandbox/write`; there is no local workspace sync.
- `scheduling_policy: "durable_object"` and container snapshots are public beta.
  Moving an existing Durable Object class to this policy is a one-way switch.
- `wrangler dev` does not always exit on `SIGTERM`, leaving `workerd` on the port;
  clean up with `lsof -ti:8787 | xargs -r kill -9`.
- Run only one local worker at a time; concurrent instances can hit
  `SQLITE_BUSY`.
- Local container startup depends on the Docker engine and workerd version. If
  `wrangler dev` reports `Container failed to start`, run `bun run fix:sidecar`
  (or use `bun run dev`, which starts it automatically), update Wrangler, or
  deploy to Cloudflare to exercise the production microVM.

## License

Private / unlicensed.
