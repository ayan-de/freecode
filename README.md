<div align="center">

<img src="logo.svg" alt="FreeCode Logo" width="286" height="60" />

**An open-source CLI coding agent that runs on whichever model you already pay for**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<img src="tui2.png" width="960" height="720" />
<img src="image.png" width="1663" height="650" />

</div>

**FreeCode** is a terminal coding agent. You give it a task in plain language; it
reads your repository, runs commands, edits files, and reports back — driving the
work itself through a single agentic tool-use loop rather than asking you which
files it needs.

It talks to roughly **198 providers** derived from [models.dev](https://models.dev)
— Anthropic, OpenAI, Gemini, DeepSeek, Groq, Mistral, xAI, MiniMax, Z.ai, and
every OpenAI-compatible endpoint behind them — through one generic driver. You
can also sign in with an **Anthropic Pro/Max subscription** instead of an API
key — opt-in, and [read the stance first](#install).

Everything intelligent lives in one CLI backend. The TUI, the VS Code extension,
the web UI, and the desktop app are presentation layers that speak JSON-RPC to it.

## Install

```bash
curl -fsSL https://freecode.website/install | bash
```

On Windows, use PowerShell:

```powershell
irm https://freecode.website/install.ps1 | iex
```

Then, in any project:

```bash
freecode
```

Pick a model with `/model` before your first prompt — a fresh install has no
provider selected, and FreeCode refuses to guess one rather than sending your
prompt somewhere you never chose. Full walkthrough:
[Quickstart](https://freecode.website/getting-started/quickstart).

Using an Anthropic subscription instead of an API key:

```bash
freecode auth login anthropic
```

> **Read what that does before you run it.** Subscription inference is only
> reachable by presenting FreeCode to Anthropic **as Claude Code** — its OAuth
> client id, its headers, its identity line. Anthropic reserves that inference
> for its own surfaces and has acted against tools doing this, and the account
> at risk is yours. It is opt-in, off by default, and one `freecode auth logout`
> away. Full stance:
> [Anthropic subscription login](https://freecode.website/getting-started/anthropic-subscription).

## What it does

- **One agentic loop.** The model receives your prompt, project context, and a
  tool set, then drives the work — no separate "which files do you need" pass.
  Independent tool calls run in parallel batches.
- **Real streaming, native tool calling, extended thinking, prompt caching**, and
  usage accounting across every provider, through the Vercel AI SDK.
- **Agent modes** — `plan`, `build`, `review`, `explore`, `danger` — enforced by a
  permission layer with per-rule allow/ask/deny and path-scoped rules in
  `.freecode/settings.json`.
- **Persistent memory across sessions**, with a derived knowledge graph (local
  ONNX embeddings, clustering, cascade retrieval) and an opt-in graph explorer.
- **Durable sessions** — resume, fork, export/import, and automatic compaction
  when the context window fills.
- **Extensibility** — MCP servers, skills (`SKILL.md`), lifecycle hooks, and
  `CLAUDE.md` / `AGENTS.md` instruction files.
- **Observability** — every model call is recorded as an event; `freecode trace`
  renders the waterfall, and runs export as OTLP spans.
- **An eval harness** — behaviour changes are verified by scored agent runs, not
  by eyeballing a transcript.

## Tools

| Tool         | Description                                          |
| ------------ | ---------------------------------------------------- |
| `read`       | Read file contents                                   |
| `ls`         | List directory contents                              |
| `write`      | Create or overwrite files                            |
| `edit`       | Edit files in place with smart matching              |
| `glob`       | Find files matching glob patterns                    |
| `grep`       | Search file contents via regex                       |
| `bash`       | Execute shell commands                               |
| `agent`      | Delegate to a subagent with its own capability profile |
| `skill`      | Load a specialized skill from `SKILL.md`             |
| `question`   | Ask the user clarifying questions                    |
| `todowrite`  | Track a multi-step plan                              |
| `webfetch`   | Fetch a URL                                          |
| `websearch`  | Search the web                                       |
| `lsp`        | Query a language server                              |
| `memory`     | Save or recall persistent memory                     |
| `output`     | Retrieve stored tool output                          |

MCP tools register dynamically at runtime through the same registry.

## Commands

```
freecode                 open the TUI in the current project
freecode run <prompt>    one headless turn, streamed to stdout
freecode serve           JSON-RPC backend over stdin/stdout
freecode web             local web UI
freecode auth            Anthropic subscription login / status / logout
freecode session         list and delete sessions
freecode memory          knowledge-graph stats, rebuild, and explorer UI
freecode mcp             manage MCP servers
freecode trace           render a session's model-call waterfall
freecode eval            run the eval suites
freecode update          re-run the installer
```

## Architecture

```
     ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
     │   TUI    │  │  VS Code │  │   Web    │  │ Desktop  │
     │ apps/tui │  │apps/vscode│ │ apps/web │  │apps/web-app│
     └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
          └─────────────┴── JSON-RPC ─┴─────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│              CLI Backend (apps/core) — ALL intelligence        │
│  Agent loop · Tools · Context engine · Sessions · Providers    │
│  MCP client · Hooks · Skills · Memory · Compaction · Rollout   │
└──────────────────────────────┬───────────────────────────────┘
                               │ Vercel AI SDK
                               ▼
┌──────────────────────────────────────────────────────────────┐
│   ~198 providers from models.dev — Anthropic · OpenAI ·        │
│   Gemini · DeepSeek · Groq · Mistral · xAI · MiniMax · Z.ai    │
└──────────────────────────────────────────────────────────────┘
```

**Key principle:** frontends only render and speak IPC. No provider calls, no
file reading, no tool execution outside `apps/core`.

> A legacy browser-automation path (Playwright, driving a signed-in ChatGPT or
> Gemini session) still exists under `apps/core/src/browser/` and `gemini-web`.
> It is not the default execution path.

## Running from a clone

```bash
pnpm install
pnpm --filter @thisisayande/freecode-shared build
pnpm dev            # or: cd apps/tui && pnpm dev
```

Checks:

```bash
pnpm check-types
pnpm test
```

## Documentation

Full docs: **[freecode.website](https://freecode.website)**

- [Installation](https://freecode.website/getting-started/installation)
- [Quickstart](https://freecode.website/getting-started/quickstart)
- [Configuration](https://freecode.website/getting-started/configuration)
- [Internals](https://freecode.website/internals/agent-loop) — agent loop,
  providers, memory, compaction, permissions, eval

In-repo references: [`CLAUDE.md`](CLAUDE.md) (contributor guide),
[`EVAL.md`](EVAL.md), [`TRACE.md`](TRACE.md), and the design specs under
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

MIT
