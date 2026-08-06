# Caching Architecture

> Every cache in the core, organized by lifetime tier, with keys, invalidation
> triggers, and why each one exists. Reference for future work on hit rates,
> staleness bugs, and "where did this stale value come from?" investigations.

## Tier Model

The runtime has two independent tiers, each with its own purpose and invalidation discipline:

| Tier | Lifetime | Invalidated by | Purpose |
|---|---|---|---|
| **Provider-side** | one model request → next request on the same prefix | the next request's prompt prefix changing | cut input-token cost (Anthropic charges ~10% for cached tokens) |
| **Agent-side** | one session, or one process boot | explicit event from the loop, or TTL fallback | skip recomputing things that haven't changed |

The two tiers are deliberately decoupled: a provider-side cache hit is
observable only by what the SDK reports back in usage; an agent-side cache
hit is observable only by what the loop *doesn't* recompute. Mixing them
(e.g. caching the rendered prompt locally) buys nothing the provider cache
doesn't already buy, and risks divergence if the agent-side copy is stale.

```
┌───────────────────────────────────────────────────────────────┐
│                     Provider-side (Tier 1)                     │
│                                                               │
│   System prompt + tools + history ──▶ marker (read anchor)     │
│                                     ──▶ marker (write anchor) │
│                                     ──▶ upstream prompt cache  │
│                                                               │
│   Lifetime: until prefix bytes change or upstream TTL expires │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                     Agent-side (Tier 2)                        │
│                                                               │
│   file tree ─┐                                                 │
│   tool defs ─┤                                                 │
│   repo map ─┼──▶ module-level Map / disk JSON                 │
│   skills  ──┤                                                 │
│   models   ─┘                                                 │
│                                                               │
│   Lifetime: process boot, or invalidated by bus event / TTL   │
└───────────────────────────────────────────────────────────────┘
```

---

## Tier 1 — Provider-side cache

Lives in `apps/core/src/providers/`. Stamps breakpoint markers onto the
outgoing `ModelMessage[]` so Anthropic (and Anthropic-shaped gateways) can
cache the prefix on the upstream side. We never store the prefix
ourselves; the upstream provider does, keyed on the bytes of the prompt.

### 1.1 Breakpoint placement — `utils.ts:146 applyMessageCaching`

Two anchors per request:

- **Write anchor** on the last message (the tail), so the full prefix of
  *this* request is stored for next time.
- **Read anchor** on the message immediately before the newest assistant
  message, i.e. exactly where the previous request ended.

A single marker on the tail alone only ever describes a prefix the model
has never seen — it writes but never reads. The previous request ended at
a different point than where opencode's `.slice(-2)` rule lands because
the AI SDK v6 expands one logical turn into two messages (`assistant` +
`tool`), so the read anchor has to be one further back. See the comment
block on `utils.ts:131-142` for the measured rationale; on MiniMax-M3
that rule pinned reads at ~7K (the system prefix) while input grew to
81K, never scaling with history. The naive `.slice(-2)` version left
reads at 0 even on identical prefixes.

### 1.2 Multi-provider `providerOptions` table — `utils.ts:115`

One marker, five providers:

```ts
const CACHE_PROVIDER_OPTIONS = {
  anthropic:        { cacheControl: { type: "ephemeral" } },
  openrouter:       { cacheControl: { type: "ephemeral" } },
  openaiCompatible: { cache_control: { type: "ephemeral" } },
  alibaba:          { cacheControl: { type: "ephemeral" } },
  bedrock:          { cachePoint:     { type: "default"   } },
} as const;
```

The AI SDK routes `providerOptions` by key and ignores the rest, so
setting them all costs nothing and means a request reached through
OpenRouter or an OpenAI-compatible gateway caches identically to a
direct Anthropic one. Bedrock uses its own shape (`cachePoint`).

### 1.3 Tool-array caching — `utils.ts:46 buildToolsParam`

The last tool's `providerOptions` gets the same marker, so the entire
`{ name, description, parameters }` array caches as one block. Without
this, the cached system prompt sits *above* an uncached tool array, and
the whole tools section re-bills at full price on every turn.

### 1.4 System-block caching — `utils.ts:62 buildAnthropicSystemParam`

When a `SystemBlock.cache === true`, the block is wrapped with
`providerOptions.anthropic.cacheControl`. The prompt compiler sets
`cache: true` only on the static half of the system prompt — the part
that doesn't change between turns. See `context/compiler.ts` for which
blocks qualify.

### 1.5 Cold-cache warning — `providers/cache-awareness.ts`

Anthropic's prompt cache has a ~5-minute TTL. If more than that elapses
between turns, the next request re-reads the full context as fresh
input — real money on long contexts.

- `noteSendAndCheckCold(sessionId, provider, now?)` — returns a
  warning string when this send will likely miss, `null` otherwise.
  First send of a session returns `null` (nothing was cached yet).
- `summarizeCache(usage)` — computes
  `{ readTokens, writeTokens, hitRatio }` from `cacheReadInputTokens`
  and `cacheCreationInputTokens`, surfaced on the `cache_status` event.
- `disposeCacheAwareness(sessionId)` — drops the per-session timestamp
  on session close.
- `CACHING_PROVIDERS = new Set(["anthropic"])` — OpenAI/Gemini caching
  is either automatic-without-TTL-signal or absent here, so no warning
  is surfaced.

### 1.6 Per-segment debug hashing — `utils.ts:93 debugSegment`

`FREECODE_DEBUG_CACHE=1` writes a per-segment length + 32-bit content
hash to stderr. A read only happens when the whole prefix up to a
breakpoint is byte-identical, so when the hit rate drops the question is
always "which segment moved?" — and counters can't answer it. Comparing
the hash lines across two consecutive turns answers it directly:
whichever hash changed is the one breaking the prefix.

Output goes to stderr, not stdout: core speaks JSON-RPC over stdout,
so anything `console.log`'d there is swallowed by the frontend's
protocol reader and never reaches the user. stderr is the channel the
TUI actually surfaces.

### 1.7 TTL — upstream-controlled

Not surfaced in core. Defaults to provider's `ephemeral` (5m for
Anthropic). If a future task needs a longer horizon, the marker shapes
above accept `ttl` directly; the AI SDK ignores it on providers that
don't understand it.

---

## Tier 2 — Agent-side cache

Lives in `apps/core/src/` outside `providers/`. All local resources
the loop would otherwise re-read or re-compute on every turn. Six
distinct caches; four use a process-local `Map`, one is on disk, one is
the cross-turn file-content cache inside `SessionStore`.

### 2.1 Project context (file tree + git HEAD) — `context/tree-cache.ts`

```ts
const cache = new Map<string, { ctx: ProjectContext; timestamp: number }>();
const TTL_MS = 5 * 60 * 1000;
```

- **Key**: `projectPath` (absolute).
- **Value**: `{ name, projectPath, tree, gitHead }`.
- **TTL**: 5 minutes (safety net).
- **Invalidation**:
  - Event-driven — `invalidateProjectContext(projectPath)` is called by
    the loop after any mutating tool (`write`, `edit`, `bash`, `agent`).
  - `context/tree-watcher.ts` also invalidates when external writes
    happen — chokidar watches depth-0 + `.git/HEAD`, debounced 200ms.
    Edits inside files don't matter (the cached shape only depends on
    the top-level entry list and git HEAD), so those are ignored.

The watcher is best-effort: if chokidar is unavailable, it silently
degrades to the TTL. It uses `persistent: false` deliberately — the
server is held open by stdio anyway, and `persistent: true` would hang
short-lived processes (tests, one-shot CLI) instead of exiting cleanly.

### 2.2 File-tree strategy — `context/compiler.ts:55 fileTreeCache`

A second, narrower cache layered on top of `tree-cache`. Keyed by the
tuple `(projectPath, gitHead, ignorePatterns)` so it auto-invalidates on
commit without explicit bookkeeping. Used by the file-tree prompt
strategy to assemble the per-section block.

### 2.3 Tool definitions — `tools/defs-cache.ts`

```ts
let cached: ProviderToolDef[] | null = null;
```

- **Value**: `[ { name, description, parameters } ]`, sorted by name.
- **Invalidation**: bus subscription to `tools.changed` and
  `mcp.tools.changed`. Also calls `PromptCompiler.clearCaches()` since
  the compiler's file-tree cache is sensitive to tool changes.

Built lazily on first `getToolDefs()` call; subscribes once via
`ensureSubscribed()`. Tools are sent as native schemas now, so only the
compiler's file-tree cache remains; dropping it on a rare tool/skill
change is acceptable.

### 2.4 Repo-map symbols — `repo-map/index.ts`

```ts
const caches = new Map<string, SymbolCache>(); // projectPath → { symbols, gitHead, timestamp }
const TTL_MS = 5 * 60 * 1000;
```

- **Key**: `projectPath`.
- **Value**: `{ symbols, gitHead, timestamp }`.
- **TTL**: 5 minutes.
- **Invalidation**:
  - Auto on git HEAD change (`cached.gitHead !== gitHead`).
  - `invalidateSymbolCache(projectPath?)` on demand (drop one or all).

Single-file lookups parse fresh (cheap); the cache exists for the
whole-project symbol list, which would otherwise dominate the
prompt-compile budget. Single daemon can serve multiple project paths —
each path has its own entry.

### 2.5 Skills — `skills/manager.ts`

Per-project `SkillManager` instance, keyed by project path
(`PER_PROJECT_CACHE` map at the bottom of the file).

- **State**: `registry`, `lastLoadTime`, `cacheTtlMs` (default 5 min,
  configurable per-instance).
- **Invalidation**: `invalidateCache()` — drops the in-memory registry
  without reloading from disk; `reload()` — full reload.
- **Lazy miss path**: a request for a dynamically-added skill that
  isn't in the cache falls through to disk (`skills/loader.ts`) without
  invalidating the rest of the registry. Most skills are static; this
  path is only hit for skills added after boot.

The skill loader scans plugin layouts
(`cache/<mkt>/<plugin>/<ver>/skills`,
`repos/<owner>/<repo>/skills`, ...) — manifest-first, bounded deep scan
as fallback. See `skills/loader.ts:127`.

### 2.6 Model registry — `models-dev.ts`

Two-tier: in-memory + on-disk.

```ts
let cache: { data: Provider[]; timestamp: number } | null = null; // in-memory
const CACHE_FILE = "~/.freecode/cache/models-dev.json";            // on-disk
const CACHE_TTL_MS = 5 * 60 * 1000;
```

- **Read path**: in-memory hit → disk hit → `fetchFromNetwork()`.
- **Write path**: network success writes both layers; network failure
  falls back to disk even if expired (the model registry is preferable
  to a missing-registry crash). `forceRefresh` skips the in-memory
  layer but still consults disk first.

### 2.7 Session file-content cache — `session/store.ts:79 ContextCache`

Persisted as `context-cache.json` inside the session directory. Not a
runtime cache in the same sense as the others — it's a write-through
store of `{ requestedFiles, fileContents, turnCount }` that survives
across process restarts so a resumed session doesn't re-fetch the same
file contents on its first turn after resume.

The store is empty after a fresh resume; the loop degrades to
re-reading the requested files. After the first turn it's warm.

### 2.8 MCP tool catalog — `mcp/service.ts:91`

Per-server `tools: Map<toolName, ToolDef>` on the connected client.
Cache lifetime is the connection lifetime — no TTL. Connections are
created in `mcp/init.ts`, torn down in `mcp/transport.ts`. Changes to
the catalog flow through `bus` `mcp.tools.changed`, which invalidates
`tools/defs-cache.ts` (see 2.3).

### 2.9 Memory graph vector cache — `memory/graph/vector-store.ts`

Content-hash → packed f32 dedupe. Embedding the same content twice
returns the cached vector without a second ONNX inference. No TTL:
embeddings are content-addressed, so a hash collision is the only
invalidation.

---

## What is *not* cached

These are opencode-style mechanisms that freecode deliberately does not
ship. Documented here so future work doesn't re-litigate the decision.

### No `Effect.cached` for in-flight dedupe

Opencode uses `Effect.cachedWithTTL` to collapse concurrent callers of
the same expensive computation onto one in-flight fiber. freecode has no
equivalent. In practice the loop is single-threaded per turn, so two
prompt compiles never race — but if a future feature (parallel tool
results, async UI renderers) ever triggers concurrent
`getToolDefs()` / `getProjectContext()` calls, both will pay the cost
independently. Worth revisiting if a profile shows redundant work.

### No `ScopedCache` for per-project lifecycle

Opencode's `effect/instance-state.ts` keys a `ScopedCache` by directory
and auto-disposes on project close. freecode's TTL-on-`Map` caches
(2.1, 2.4) leak when a project is "closed" — there's no teardown
hook. The CLI is single-process, so the leak is bounded to one
project's worth of state and is released on process exit; the only
scenario where this matters is a long-lived server (`serve` command)
toggling between project directories. Worth revisiting if `serve` grows
multi-project support.

### No LSP layer

Opencode runs language servers for in-editor symbol resolution, hover,
go-to-def, and diagnostic push. freecode's `repo-map` covers a slice of
what an LSP server would give you (whole-project symbol list) but no
per-file AST, no incremental diagnostics, no live type info. Not on the
critical path for the CLI use case; would be needed for IDE integration.

---

## Invalidator map

| Bus event | Caches it invalidates |
|---|---|
| `tools.changed` | `tools/defs-cache` (2.3), `context/compiler` file-tree cache (2.2) |
| `mcp.tools.changed` | `tools/defs-cache` (2.3) |
| Any mutating tool completion | `context/tree-cache` (2.1) for that project |
| `.git/HEAD` change (watcher) | `context/tree-cache` (2.1) |
| Top-level add/unlink (watcher) | `context/tree-cache` (2.1) |
| Git HEAD change | `repo-map` symbol cache (2.4) for that project |

Anything not in this table falls back to its TTL.

---

## File index

```
apps/core/src/
├── providers/
│   ├── utils.ts                    # 1.1, 1.2, 1.3, 1.4, 1.6
│   ├── cache-awareness.ts          # 1.5
│   └── streaming.ts                # usage → cache_status event
├── context/
│   ├── tree-cache.ts               # 2.1
│   ├── tree-watcher.ts             # 2.1 invalidation
│   ├── compiler.ts                 # 2.2, 1.4 (cache: true)
│   └── strategies/file-tree.ts     # 2.2 consumer
├── tools/
│   └── defs-cache.ts               # 2.3
├── repo-map/
│   └── index.ts                    # 2.4
├── skills/
│   ├── manager.ts                  # 2.5
│   └── loader.ts                   # 2.5 disk scan
├── models-dev.ts                   # 2.6
├── session/
│   └── store.ts                    # 2.7 (ContextCache)
├── mcp/
│   └── service.ts                  # 2.8
└── memory/
    └── graph/vector-store.ts       # 2.9
```

---

## See also

- `agent-loop.md` — the loop that calls these caches between turns and
  triggers their invalidation events.
- `AGENTS.md:34` (Memory Graph), `AGENTS.md:37` (Context Engine) — the
  project-level descriptions of the subsystems that own 2.9 and 2.1–2.2.
- `agent/loop.ts:248` — the `lastMemoryQueryText` /
  `lastMemoryBlock` short-circuit: same family of "skip the work if
  nothing changed" cache as above, but in-process state on the loop
  rather than a module-level `Map`.