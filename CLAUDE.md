# FreeCode Agent Guide

> How to work on this codebase — architectural principles, patterns, and practices.

**IMPORTANT: Architecture Spec Compliance**
This codebase follows `docs/superpowers/specs/2026-05-25-architecture-v4.md` (supersedes v3). Before implementing features, read that spec. If implementation deviates from it, the spec takes precedence unless explicitly overridden. Topical specs worth reading before touching a subsystem:

| Area                | Spec                                                    |
| ------------------- | ------------------------------------------------------- |
| Agent loop          | `specs/2026-05-25-agent-loop.md`                        |
| Multi-provider API  | `specs/2026-05-28-multi-provider-api-design.md`         |
| Memory + sessions   | `specs/2026-06-02-memory-session-design.md`             |
| Memory graph        | `specs/2026-07-26-memory-knowledge-graph.md`            |
| Memory write path   | `specs/2026-08-09-memory-write-path.md`                 |
| Memory consolidation | `specs/2026-08-23-memory-consolidation.md` (built 2026-08-23) |
| **Memory (all of it)** | **`docs/superpowers/MEMORY_SYSTEM.md`** — start here |
| MCP client          | `specs/2026-06-08-mcp-client-design.md`                 |
| Observability       | `specs/2026-08-10-agent-observability.md`               |
| **Trace (commands)** | **`TRACE.md`** — `freecode trace` flags, how to read the waterfall |
| Eval harness        | `specs/2026-08-23-eval-harness.md` (Phases 0–5, built) + `specs/2026-08-29-eval-case-registry.md` |
| **Eval (commands)** | **`EVAL.md`** — which command, which flag, when to run it |
| Hooks               | `apps/core/src/hooks/hooks-system.md`                   |

## Implemented Subsystems

The v4 architecture systems are implemented and live in `apps/core/src/`:

| System                     | Location                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Effect/Layer DI**        | `effect/context.ts`, `effect/layers.ts`, `effect/runtime.ts`, `effect/loop-health.ts`                            |
| **Providers (API)**        | `providers/` — `anthropic.ts`, `openai.ts`, `gemini.ts`, `minimax.ts`, `registry.ts`, `config.ts`, `streaming.ts`|
| **Agent loop**             | `agent/loop.ts`, `agent/subagent.ts`, `agent/recovery/`, `agent/title-generator.ts`                              |
| **Bus (PubSub)**           | `bus/index.ts`, `bus/bridge.ts` — question + streaming events                                                     |
| **Hooks**                  | `hooks/` — PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PreCompact, PostCompact, SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Notification, TurnStart, TurnEnd |
| **Skills System**          | `skills/manager.ts`, `skills/loader.ts`, `skills/registry.ts`, `skills/injection.ts`, `skills/types.ts`          |
| **Rollout/Event Sourcing** | `rollout/recorder.ts`, `rollout/types.ts`, `rollout/history.ts`, `rollout/replay.ts`                              |
| **Observability**          | Spec `2026-08-10-agent-observability.md`. Model-call events (`model.request`/`first_token`/`response`/`error`) recorded by `rollout/recorder.ts` around `callProviderOnce`; `model.request` is written *before* the call so an unterminated request is itself the evidence of a hang. **Timeouts live at the fetch layer** (`providers/fetch-timeout.ts`, wired as the `fetch` option on every provider): 300s for response headers, 180s of silence on a live SSE stream (`FREECODE_HEADER_TIMEOUT_MS` / `FREECODE_SSE_STALL_TIMEOUT_MS`, `0` disables). Do NOT move this back above `normalizeAiSdkStream` — it drops `tool-input-delta`, so a large tool call looks like a dead stream. `rollout/trace.ts` (pure fold → spans; `in_flight` vs `hung` past `HANG_THRESHOLD_MS`) + `trace-render.ts` + `rollout/otlp.ts` (OTLP/HTTP JSON, no SDK dep, exported from the log not the hot path). CLI: `freecode trace [id] [--follow|--slow|--list|--json|--otlp]` — **operator reference is `TRACE.md` at the repo root** (flag interactions, how to read the verdict line). **A refused tool call is `function.denied` → `Trace.deniedSpans`, never `toolSpans`** (spec §5.1): `loop.ts` returns before `recordFunctionCall`, so before this event a mode-blocked call left no trace at all and a model looping against a mode it cannot satisfy folded to "did nothing". All four deny sites go through one `denyToolCall()` exit. `toolSpans` means **tools that ran** and its seven consumers depend on that, so denials stay out of it — which is also why an eval's `forbidTools` cannot see a refusal, and must be paired with an `expectTool` or it asserts nothing. **Cost**: `providers/pricing.ts` (USD/Mtok keyed `provider/model`, `~/.freecode/pricing.json` overrides, `PRICES_AS_OF` vintage) — an unknown model prices as `undefined`, never 0 or a near-miss, and a cache read is a **discount off the inclusive `inputTokens`, not an addend**. OTLP root span is `invoke_agent` with `gen_ai.conversation.id` on every span; `attrs()` rounds numerics to ints except the explicit `FRACTIONAL` set (cost, score) — adding a rate outside that set silently reports 0.5 as 1. |
| **Thread Store**           | `store/thread-store.ts`, `store/sqlite-store.ts`, `store/json-store.ts`, `store/remote.ts`                        |
| **Sessions**               | `session/manager.ts`, `session/service.ts`, `session/store.ts`, `session/prompt.ts`, `session/normalize/`        |
| **Compaction**             | `compaction/service.ts`, `compaction/selector.ts`, `compaction/summarizer.ts`, `compaction/tokens.ts`            |
| **Memory**                 | `memory/mem-store.ts`, `memory/mem-query.ts` (BM25 via `bm25.ts`), `memory/mem-prompt.ts`, `memory/mem-types.ts`. Five types: `user`/`feedback`/`project`/`reference` + `episode` (machine-written only). Write path (spec `2026-08-09-memory-write-path.md`): the `memory` tool, plus `extract.ts` mining finished turns, gated by `extract-policy.ts`; a final `force` flush on session end (`session/end-session.ts`, `memory/final-flush.ts`) bypasses the interval gate and nothing else. Consolidation (spec `2026-08-23-memory-consolidation.md`): `consolidate.ts` + `consolidate-run.ts` + `consolidate-policy.ts` + `consolidation-lock.ts`, one cheap call per project per day, merges only (**no delete verb**), over a **git diff** of the memory dir (`git-baseline.ts`). Retrieval judge `judge.ts` (fails closed, cadence-carried on the prefetch). Usage attribution `citations.ts` + `usage-store.ts` → `.graph/usage.json`. Recall benchmark: `pnpm bench:recall` (`memory/bench/`). Off via `memory.{autoExtract,retrievalJudge,autoConsolidate}: false` or `FREECODE_DISABLE_MEMORY_{EXTRACTION,JUDGE,CONSOLIDATION}=1`. |
| **Memory Graph**           | `memory/graph/` — derived KG over persistent memory (spec `2026-07-26-memory-knowledge-graph.md`). `embedder.ts` (local ONNX/fastembed, optional dep), `vector-store.ts` (packed f32 + content-hash cache), `builder.ts` (tag/wikilink/supersede edges), `clusters.ts` (deterministic k-means), `cascade.ts` (seed top-k → graph walk), `secret-filter.ts` (never embed secrets), `index.ts` (`MemoryGraphService`: async one-turn-behind injection, keyword fallback). Sidecar in `<memory>/.graph/`; CLI: `memory graph stats|rebuild`. Keyword retrieval stays as fallback when the embedder is unavailable. **Explorer** (`graph-explorer/`, opt-in addon in `~/.freecode/addons/graph-ui/`, `127.0.0.1` only): `GET /api/graph` sends only `{id,kind,label}` per node — content is fetched per click via `GET /api/node?id=` (`nodeDetailForExplorer`). Page edits ship in `graph-ui.tar.gz` and need a release plus `freecode memory ui-install` to reach an installed binary. |
| **Permission**             | `permission/` — per-rule allow/ask/deny layer (`rules.ts`, `evaluate.ts`, `mode-policy.ts`, `settings.ts`, `prompt.ts`; spec `2026-07-18-permission-rules.md`) + `profiles.ts` capability profiles (minimal/readonly/standard/elevated/admin, used for subagents). Agent modes (plan/build/review/explore/danger) live in `agent/types.ts`. |
| **MCP Client**             | `mcp/client-registry.ts`, `mcp/service.ts`, `mcp/transport.ts`, `mcp/convert-tool.ts`                            |
| **Context Engine**         | `context/collector.ts`, `context/compiler.ts`, `context/tree-cache.ts`, `context/strategies/`                    |
| **Eval harness**           | `eval/` — spec `2026-08-23-eval-harness.md`, Phases 0–5 (Phase 3's judge is built but needs `FREECODE_JUDGE_PROVIDER`/`FREECODE_JUDGE_MODEL` pointing at a provider that is **not** the one under test; §12's live OTLP export is deliberately unbuilt). Cases live in `evals/*.jsonl` (one JSON object per line) and **run a real agent turn**; anything that doesn't is a `*.test.ts` and belongs next to its code. Three suites: `trajectory.jsonl` (did the right tool fire — `scorers/trajectory.ts`, pure fold, unsandboxed and read-only), `coding.jsonl` (did the end state match — `scorers/outcome.ts`, `verify`'s exit code is the score), and `judged.jsonl` (was the reply good — `scorers/judge.ts` + `judge-config.ts`, 0–5 against a markdown rubric in `evals/rubrics/`). **A `rubric` makes a case judged**, which changes the blocking rule to *mean ≥3.5 and no case <2*, absolute rather than delta. The judge **must not be the model under test** — a collision throws before any case runs. An unconfigured judge does not throw (the deterministic expectations still run) but **closes the gate**: `judgeSkipped` is set on exactly one path (`resolveJudge` → `unconfigured`), which is how `gate.ts` tells "never configured" apart from a judge that failed mid-run. **A total blackout — 0 of N cases scored — also closes it**, whatever the cause: the first real judged run used a retired Gemini model id and reported 5/5 GATE OPEN having graded nothing. §7 constraint 3 ("an outage never fails a run") survives as: an unanswered case is excluded from the mean, and a *partial* outage passes on the cases that scored. Only silence-from-everything blocks. No override flag: omitting `--gate` is already how you run the suite without blocking. **Judge model ids rot** — a retired one surfaces as a passing suite, not an error, so `SuiteReport.judge` is recorded on every run. Unscored trials are excluded from the mean, never counted as zero. Scorers fold `RunRecord { trace, prompt, response, sandboxDir? }` — `trace` from the rollout log, text from the caller, because the log deliberately carries no message bodies (OTLP export must stay leak-free). Gate is **majority-of-N + delta vs the baseline**, never absolute 100% (see spec §9.1 for why: at p=0.93 across 20 cases, pass^3 is green ~1.3% of the time). **The baseline is the last run that did NOT close the gate, on the SAME resolved model** — blocked runs are written to history with `gateBlocked: true` and skipped by `baselineFor`, or a regression becomes its own baseline and is forgiven next run. That makes the baseline **sticky** when a suite is deliberately re-scoped (fewer cases ⇒ lower `passed` ⇒ permanent "regression"); `--accept-baseline` is the escape hatch, recording `baselineAccepted: true` so history can tell a waved-through baseline from an earned one. `--gate` implies `--trials 3`; an explicit `--trials 1` is honoured with a warning. `pnpm eval` / `pnpm eval:gate` from the repo root — `eval:gate` is the release ritual and runs all three suites in cost order (trajectory → coding → judged), so it **requires `FREECODE_JUDGE_PROVIDER`** and fails without one; CI is `.github/workflows/eval.yml`, **`workflow_dispatch` only** (real paid turns) and it caches `eval_runs.jsonl`, without which a fresh runner reports "run zero" and passes unconditionally. `evals/quarantine.txt` ships with the gate — flaky cases run and report but never block. **A case may mutate only if it has a `files` fixture** — that's what earns it a `sandbox.ts` tmpdir as its project root, `build` mode, and a runner that answers permission prompts scoped to that dir; without one, `dataset.ts` refuses mutating modes, since `forbidTools` only *scores* a mutation and mode enforcement *prevents* it. `danger` is refused either way. Coding fixtures are **dependency-free by rule** (plain `.mjs` + `node:assert`, no `node_modules` in the sandbox), and `immutable` byte-guards the checker so an agent can't edit its way green. `harvest.ts` + `freecode eval add <session-id> [--turn N] [--write]` turns a recorded session into a draft case — **it reads the SESSION store (`~/.freecode/sessions/<proj>/<id>/messages.jsonl`), not the thread store**: `createTurn`/`addTurn` have no production caller anywhere, so `StoredTurn` is always empty and the spec's §5.1 table row claiming otherwise is wrong (see §8.1). Turn scoping is by timestamp, not `turnId` — a `turnId` is a loop iteration, so one user turn spans many. CLI: `freecode eval [suite] [--trials N] [--gate] [--json] [--quarantine-report]`. **Operator reference — every command and flag, and when to run which — is `EVAL.md` at the repo root; read that before running anything that costs money.** |
| **Trajectory redirection** | `agent/redirect/` — spec `2026-08-26-trajectory-redirection.md`, Phases 0–2. Turns a loop-health `warn` into evidence-backed advice for the next turn: a bounded fold of the rollout log → one small non-streaming model call → up to three directions injected as a `<system-reminder>`. **Off by default** (`redirect.enabled`, `FREECODE_DISABLE_REDIRECT=1`); Phase 2 measured it and refused to flip — see §9.1 of the spec for why the criterion is unmeasurable until the eval sandbox lands. Capped at 2/run, 1/reason, 3-turn debounce, off for subagents; fails closed on every path; tokens billed to the run so the spend breaker sees them. Rollout: `redirect.triggered`/`redirect.skipped`, carrying `evidenceEventIds` but **never the advice text**. |
| **Autonomous runs**        | `autonomous/` — spec `2026-08-10-autonomous-runs-design.md`, **Phase 0 only**: `types.ts`, `budget.ts` (four-way ceiling: turns/tokens/time/usd, first hit wins, **cache reads excluded** from the token budget), `run-store.ts` (atomic manifest under `~/.freecode/runs/<id>/`, `FREECODE_RUNS_HOME` to relocate). **Nothing executes yet** — no agent loop, no detached process, no gate runner. Do not treat this as a working feature. |

**Legacy / not wired into the primary path:** `browser/` (Playwright controller + ChatGPT DOM adapter). The default execution path is API providers, not browser automation. Don't extend the browser layer unless explicitly asked.

## Project Overview

FreeCode is a CLI-driven AI coding assistant. The architecture uses a **thin-client model**: multiple frontends (TUI, VS Code, Web, Tauri desktop) delegate all intelligence to a shared CLI backend (`apps/core`) via JSON-RPC over stdin/stdout.

The backend runs a **single agentic tool-use loop**: the model receives the prompt + project context (file tree, git head) and a set of tools, then drives work by emitting tool calls (read/write/edit/bash/grep/glob/etc.) which the loop executes — in parallel batches where safe — feeding results back until the model stops. Providers are reached through the **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`) with real streaming, native tool calling, extended thinking, prompt caching, and usage accounting.

---

## Architecture

**TUI, VS Code, and Web are pure presentation layers. All business logic lives in `apps/core`.**

> **TUI Framework**: For pi-tui customization, see [`pi-tui.md`](pi-tui.md).

```
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │     TUI      │  │   VS Code    │  │     Web      │  │  Desktop     │
        │  (apps/tui)  │  │ (apps/vscode)│  │  (apps/web)  │  │(apps/web-app)│
        │  pi-tui      │  │ React webview│  │  Next.js     │  │ Tauri + Vite │
        └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
               └─────────────────┴──── JSON-RPC ───┴─────────────────┘
                                       │ (stdin/stdout)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLI Backend (apps/core) — ALL intelligence           │
│   Effect runtime + layers · Agent loop · Tools · Context engine · Sessions    │
│   Provider registry · MCP client · Hooks · Skills · Memory · Compaction ·     │
│   Rollout (event sourcing) · Thread store · Bus (PubSub) · Permission profiles│
└──────────────────────────────────────┬────────────────────────────────────────┘
                                       │  Vercel AI SDK
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 AI Providers (API):  Anthropic · OpenAI · Gemini · MiniMax     │
│                       (legacy: browser automation via Playwright)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key principle:** Frontends only render and speak IPC. All business logic lives in `apps/core`.

---

## Project Structure

```
freecode/
├── packages/
│   ├── shared/                     # Shared domain types + IPC protocol ONLY
│   │   └── src/
│   │       ├── types.ts             # Message, MessagePart, ToolDef, ToolResult, Session/Provider types
│   │       ├── ipc/protocol.ts     # JsonRpc*, StreamEvent, StreamResponse, METHODS
│   │       └── index.ts
│   ├── ui/                         # Shared UI primitives
│   ├── eslint-config/
│   └── typescript-config/
│
├── apps/
│   ├── core/                       # CLI backend — ALL intelligence
│   │   └── src/
│   │       ├── server.ts            # JSON-RPC stdin/stdout server
│   │       ├── web-server.ts        # HTTP/WS bridge for the web frontend
│   │       ├── cli.ts + cli/        # yargs entrypoint + subcommands (mcp, session, web)
│   │       ├── agent/              # Agentic tool-use loop, subagents, recovery
│   │       ├── providers/          # API provider adapters + registry (AI SDK)
│   │       ├── browser/            # LEGACY Playwright controller + ChatGPT adapter
│   │       ├── context/            # File tree, context compilation, tree cache
│   │       ├── tools/              # Tool defs + execution (see Tools below)
│   │       ├── session/            # Session manager, service, store, prompt
│   │       ├── store/              # Thread store (sqlite / json / remote)
│   │       ├── rollout/            # Event sourcing: recorder / history / replay
│   │       ├── compaction/         # Context window compaction + summarization
│   │       ├── memory/             # Persistent cross-session memory
│   │       ├── skills/             # Skills manager / loader / registry / injection
│   │       ├── hooks/              # Lifecycle hooks (Pre/PostToolUse, Session, Subagent, …)
│   │       ├── mcp/                # MCP client registry, transport, tool conversion
│   │       ├── permission/         # Permission profiles (plan/build/review/explore/danger)
│   │       ├── bus/                # PubSub event bus + IPC bridge
│   │       ├── effect/             # Effect runtime + layers (DI) + loop-health
│   │       └── utils/
│   │
│   ├── tui/                        # Pure UI shell (pi-tui) — components, state, ipc, themes
│   ├── vscode/                     # Pure UI shell — React webview + extension host + ipc
│   ├── web/                        # Pure UI shell — Next.js
│   ├── web-app/                    # Pure UI shell — Tauri desktop (Vite + React + src-tauri)
│   ├── tui-rs/                     # Experimental Rust TUI
│   └── docs/                       # Documentation site (Next.js)
│
└── docs/
    └── superpowers/
        ├── specs/                  # Design specifications (v4 is current)
        └── plans/                 # Implementation plans
```

### Tools

Built-in tools live in `apps/core/src/tools/` and are registered in `tools/index.ts`:
`read`, `ls`, `write`, `edit`, `glob`, `grep`, `bash`, `skill`, `agent` (subagent), `question`, `webfetch`, `websearch`, `todowrite`, `lsp`, `memory`. MCP tools are registered dynamically at runtime via `registerMcpTool`. Each tool is built through `factory.ts` (`buildTool`) with `parameters`/`behavior`/`permissions`; execution and batching go through `orchestrator.ts` + `batching.ts`. Tools do **not** render — core emits `StreamEvent` data and each frontend draws it (TUI: `apps/tui/src/components/tool-result-message.ts`).

#### Adding a tool — registration checklist

`buildTool` + `index.ts` alone is **not enough**. Several permission/UI tables key off the tool *name*; miss one and the tool fails closed (blocked in read-only modes, or prompts for permission every call). When adding a tool, update:

1. **`tools/<name>.ts`** — the tool via `buildTool`. Declare a `type` on every schema property (providers like MiniMax send numbers/booleans as strings; a missing `type` yields "must be a number" reject-loops — coerce in `execute` too).
2. **`tools/index.ts`** — import + add to the `tools` map.
3. **`permission/mode-policy.ts`** — add to `READONLY_TOOLS` **if** the tool only reads (unlisted ⇒ treated as mutating ⇒ blocked in plan/review/explore).
4. **`permission/rules.ts`** — add to `PATH_TOOLS` (path arg) or `URL_TOOLS` (url arg) so path/url-scoped allow/deny rules match.
5. **`permission/suggest.ts`** — add to `DISPLAY_NAMES` for the capitalized rule label in permission prompts.
6. **Frontends (only for a custom icon; optional):** `apps/tui-rs/src/ui/tool.rs` `tool_icon()`. The TS TUI needs no change unless the tool wants Read/Bash-style content rendering (`apps/tui/src/components/tool-result-message.ts`). Both have catch-all fallbacks, so a tool works without touching them.

---

## Boundary: What Lives Where

| Concern                                    | core | TUI | VSCode | Web |
| ------------------------------------------ | ---- | --- | ------ | --- |
| Agent loop + tool execution                | ✅   | ❌  | ❌     | ❌  |
| Provider adapters (Anthropic/OpenAI/…)     | ✅   | ❌  | ❌     | ❌  |
| Sessions, store, rollout, compaction       | ✅   | ❌  | ❌     | ❌  |
| Context collection (file tree)             | ✅   | ❌  | ❌     | ❌  |
| Hooks, skills, memory, permission profiles | ✅   | ❌  | ❌     | ❌  |
| MCP client                                 | ✅   | ❌  | ❌     | ❌  |
| File read / write / diff                   | ✅   | ❌  | ❌     | ❌  |
| Browser automation (legacy Playwright)     | ✅   | ❌  | ❌     | ❌  |
| Rendering (pi-tui / React / Next.js)       | ❌   | ✅  | ✅     | ✅  |
| IPC client                                 | ❌   | ✅  | ✅     | ✅  |

---

## IPC Protocol

`apps/core` exposes a JSON-RPC 2.0 interface over stdin/stdout. All frontends use the same protocol. Method signatures are declared in `packages/shared/src/ipc/protocol.ts` (`METHODS`); handlers live in `apps/core/src/server.ts`.

### Methods

| Group        | Methods                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **Tools**    | `tools.list`, `tools.call`                                                                             |
| **Session**  | `session.start`, `session.send` (streaming), `session.stop`, `session.list`, `session.resume`, `session.switch`, `session.fork`, `session.archive`, `session.delete`, `session.export`, `session.import`, `session.upload`, `session.download` |
| **Providers**| `providers.list`, `models.list`                                                                        |
| **Config**   | `config.get`                                                                                           |
| **Memory**   | `memory.list`, `memory.get`, `memory.save`, `memory.delete`, `memory.query`                            |
| **Question** | `question.answer`, `question.reject`                                                                   |
| **Usage**    | `usage.get`                                                                   |

### Streaming

`session.send` streams **`StreamEvent`** values (the modern protocol) back to the frontend:

```typescript
type StreamEvent =
  | { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_output"; toolCallId: string; content: string }
  | { type: "tool_complete"; toolCallId: string; toolName: string; result: string; success: boolean; duration_ms?: number }
  | { type: "thinking"; content: string }        // full reasoning (turn end)
  | { type: "thinking_delta"; delta: string }    // incremental reasoning (streaming)
  | { type: "text"; content: string }            // full assistant text (turn end)
  | { type: "text_delta"; delta: string }        // incremental text (streaming)
  | { type: "done"; content: string }
  | { type: "error"; content: string }
  | { type: "question_asked"; requestId: string; sessionId?: string; questions: QuestionSpec[] };
```

The older `StreamResponse` union still exists in `protocol.ts` for backward compatibility — prefer `StreamEvent` for new work.

---

## Type Sharing

Core domain types live in `packages/shared/src/types.ts` (`Message`, `MessagePart`, `ToolDef`, `ToolResult`, `ToolContext`, `ProviderInfo`, `SessionConfig`, `SessionInfo`). No duplicate type definitions in frontends. Provider-internal types (`ExecuteOptions`, `ExecuteResult`, streaming) live in `apps/core/src/providers/types.ts` and stay in core.

---

## Architectural Principles

### Core Design Principles

1. **SOLID** — Single responsibility, Open-closed, Liskov substitution, Interface segregation, Dependency inversion
2. **YAGNI** — Only implement what's needed now; avoid speculative generalization
3. **DRY** — Don't repeat yourself; extract shared logic to single sources of truth
4. **Decomposition** — Each file/module does one thing well; avoid bloated files

### Thin Client Principles

1. **Zero business logic in frontends** — TUI, VSCode, and Web do only rendering and IPC. No provider calls, no file reading, no tool execution.
2. **IPC is the only bridge** — All frontend↔backend communication goes through JSON-RPC. No shared state.
3. **Core owns everything** — Providers, agent loop, context engine, tools, sessions, hooks, skills, memory all live in `apps/core`.

---

## Key Design Decisions

### 1. Long-Running CLI Daemon

`apps/core` stays alive between turns, maintaining session state, the provider connection, and the project context cache. This enables fast subsequent turns without re-initialization.

### 2. Single Agentic Tool-Use Loop

There is no "ask which files, then send them" pre-pass. The loop collects lightweight project context (name, path, cached file tree, git head — see `context/tree-cache.ts`, invalidated after any mutating tool) and hands the model a tool set. The model then drives the work by emitting tool calls, executed in parallel batches where safe (`tools/batching.ts`, `tools/orchestrator.ts`) and looped back until the model stops.

### 3. Provider Abstraction over the AI SDK

Providers implement a common `AIProvider` interface (`providers/types.ts`) and self-register into the registry (`providers/registry.ts`). Swapping Anthropic ↔ OpenAI ↔ Gemini ↔ MiniMax requires no change to the loop. Streaming, tool calls, extended thinking, and prompt caching are normalized in `providers/streaming.ts`.

### 4. Loop-Health Monitoring

The loop tracks repeated identical tool calls, stagnant turns (no file changes), and oscillation (editing the same file repeatedly) to detect and break stuck patterns (`effect/loop-health.ts`, `updateLoopHealth` in `agent/loop.ts`).

### 5. Permission Profiles & Diff Preview

Tool execution is gated by permission profiles (`permission/profiles.ts`: plan/build/review/explore/danger) and surfaced through the `PermissionRequest` hook. Mutating changes are shown before writing.

### 6. Durable Sessions

Sessions are persisted through the thread store (`store/`, sqlite/json/remote) and rollout event sourcing (`rollout/`), enabling `resume`, `fork`, `export/import`, and `upload/download`. Long contexts are compacted (`compaction/`).

---

## File Naming Conventions

| Type                 | Convention | Example                          |
| -------------------- | ---------- | -------------------------------- |
| React components     | PascalCase | `ChatLayout.tsx`, `CodePart.tsx` |
| Stores               | kebab-case | `chat-store.ts`                  |
| IPC client           | camelCase  | `ipc/client.ts`                  |
| Provider adapters    | camelCase  | `anthropic.ts`, `gemini.ts`      |
| Tool implementations | camelCase  | `read.ts`, `write.ts`            |
| Hook handlers        | PascalCase | `PreToolUse.ts`, `SessionStart.ts` |

---

## Adding New Features

### 1. Identify the domain

- **Providers** (`apps/core/src/providers/`) — AI SDK adapters, model routing
- **Agent** (`apps/core/src/agent/`) — the tool-use loop, subagents, recovery
- **Tools** (`apps/core/src/tools/`) — tool definitions and execution
- **Context** (`apps/core/src/context/`) — file tree, context compilation
- **Session/Store/Rollout** (`apps/core/src/{session,store,rollout}/`) — persistence, lifecycle
- **Hooks / Skills / Memory / MCP** (`apps/core/src/{hooks,skills,memory,mcp}/`) — extensibility
- **UI** (`apps/tui`, `apps/vscode`, `apps/web`, `apps/web-app`) — rendering only

### 2. Check existing patterns

Before adding code, verify:

- Does a similar pattern exist? Follow it. (Tools → copy an existing tool + `factory.ts`; providers → copy an existing adapter + self-register.)
- Is this functionality needed in more than one frontend? Types go in `packages/shared`.
- Does this component do more than one thing? Decompose.

### 3. File limits

If a file exceeds ~150 lines, decompose (extract sub-components, move helpers to utils, split logic). Note `agent/loop.ts` is an intentional exception — the loop is a cohesive state machine.

---

## Key Invariants

1. **Frontends are dumb** — TUI/VSCode/Web only render UI and send/receive IPC. All logic is in `apps/core`.
2. **IPC is the only bridge** — No shared state between frontends and backend.
3. **Types are centralized** — Core domain types live in `packages/shared`. No duplicate definitions.
4. **Providers are swappable** — Adapters in `providers/` implement `AIProvider` and self-register; the loop never hard-codes a provider.
5. **Tools are uniform** — Every tool is built via `factory.ts` and executed through the orchestrator; MCP tools register through the same registry.

---

## Binary Builds & Distribution

- **Release binary = `pnpm build:bun`** (`scripts/build-bun.mjs`). This is the only distributable binary: it bakes `FREECODE_BUNDLED=1` and bundles core, so it runs from anywhere. The release workflow (`.github/workflows/release.yml`) publishes these.
- **`pnpm build:sea`** (`scripts/build-sea.mjs`) is a **TUI-shell-only, repo-root-only** dev artifact. It does *not* set `FREECODE_BUNDLED` and does *not* bundle core, so it spawns core from disk and only works inside the monorepo.
- **Never `cp apps/tui/dist/freecode` (the SEA build) into `~/.freecode/builds/versions/`.** That directory is managed by the installer and expects the bun release binary; dropping a SEA build there breaks `freecode` everywhere except the repo root. For local end-to-end testing use `pnpm build:bun` (produces the self-contained `dist/freecode-bun`), or just run from the repo.

---

## Deferred Items

- **MCP server (expose)** — an MCP *client* exists (`mcp/`); serving FreeCode tools *as* an MCP server is not done.
- **Rust TUI** — `apps/tui-rs` is experimental; pi-tui remains the primary TUI.
- **Browser providers beyond ChatGPT** — the browser path is legacy; extend only if explicitly requested.
- **Autonomous run execution** — `autonomous/` has Phase 0 (types, budget, storage) and nothing else. Detached execution, the verification gate runner, task cards and `report.md` are designed but unbuilt; building them means an agent running unattended against a repo, so it wants explicit sign-off per phase.

Don't implement these unless explicitly requested.

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
