# Changelog

## v0.25.15

The 0.25.14 fix registered `uncaughtException` / `unhandledRejection` handlers in `cli.ts` so the terminal output stayed clean, but `cli.ts` has no way to know which session was mid-turn when the fault hit — it just logs to stderr and returns. The active session's `activeLoops` entry sat forever, and the `session.send` promise never resolved, so the frontend spinner kept spinning on a turn that was already dead. The handler needed to live on the session side too: at the same `process.on(...)` registration site as the 0.25.14 fix, but with access to `activeLoops`. On fault, walk every in-flight loop, interrupt it, surface a clean `session.error` so the frontend shows a failure instead of a stuck spinner, and drop the entry from `activeLoops`. The 0.25.14 handler is still the right place for the CLI-side cleanup; this is just the matching session-side recovery that was missing from the same fix.

### Fixed
- **Escaped provider error left the session's `session.send` promise pending forever** (`apps/core/src/server.ts`). The 0.25.14 `cli.ts` handler formatted the error to stderr but couldn't reach `activeLoops` — every in-flight loop was orphaned, the spinner never resolved, and the frontend kept waiting for a turn that had already died. New `handleEscapedProviderError` runs at the same `process.on("uncaughtException"/"unhandledRejection", ...)` registration site as the 0.25.14 fix and walks `activeLoops`: `loop.interrupt()`, `BusEvents.sessionError(sessionId, message)`, drop the entry. Frontend now sees a failure instead of a stuck spinner.

## v0.25.14

The `freecode serve` daemon only registered an `unhandledRejection` handler, so a provider error that surfaces through a stream/event-emitter path (an SDK `Readable` emitting `error` with no listener, the kind of thing Vercel AI SDK streams do under network failure) bypassed our handler entirely. Node still terminates the process on an uncaught exception by default, and Bun's reporter steps in: the raw SDK error object plus a minified-binary stack trace, then the whole daemon — every session, not just the one that hit the blip — dies. The fix is a paired handler at the same `process.on(...)` registration site as the existing `unhandledRejection` one; it does the same thing (`formatFatalError` to stderr, no `process.exit()` because `serve` is long-running), and registering it is itself what stops Node from killing the process.

### Fixed
- **`uncaughtException` killed the `serve` daemon** (`apps/core/src/cli.ts`). Provider errors that surface through an event-emitter path (no listener attached, stream emits `error`) hit `process.on("uncaughtException", ...)` instead of `unhandledRejection`. Without a handler, Bun's reporter prints a raw SDK object plus a minified-binary stack and the whole daemon terminates — every session, not just the one that hit the blip. Paired handler added next to the existing `unhandledRejection` one, same `formatFatalError`-to-stderr path, no `process.exit()` (long-running daemon).

## v0.25.13

A test that was always wrong finally met CI on `main`. The bus → frontend bridge has been re-attaching `sessionId` from every `StreamRelayEvent` wrapper onto the unwrapped inner event since 0.25.11, but the test that asserted the unwrap result expected the inner event to come back unchanged — same shape, just no `sessionId` on the result. CI ran the suite, the assertion failed, and the implementation turned out to be the side of the disagreement that matched the changelog. The bridge itself is unchanged; this release only updates the test to assert the post-unwrap shape explicitly so the suite matches the contract the bridge has been honoring all along.

### Fixed
- **`busEventToClientEvent` relay test asserted the pre-0.25.11 shape** (`apps/core/src/bus/bridge.test.ts`). The bridge has always re-attached `sessionId` from the relay wrapper (see 0.25.11 changelog) — the test was the stale artifact. Updated to assert `{ type: 'text_delta', delta: 'hi', sessionId: 's1' }` so the suite matches the implementation.

## v0.25.12

The Anthropic usage accounting had been over-counting cache writes by a small but compounding amount on every turn. The AI SDK already publishes `result.usage.inputTokens` as the inclusive prompt total — it folds `cache_creation_input_tokens` and `cache_read_input_tokens` in by design — but the loop was treating that field as "non-cache" and adding `cacheCreationInputTokens` back on top, so every Anthropic turn billed cache writes twice in the per-turn total and a third time in the cache-warmth heatmap. The effect on a normal session was modest (typically a few hundred extra tokens per turn, invisibly because Anthropic's API does not charge for cache writes today) but the math was wrong and would have started mattering the moment Anthropic changed that policy. The fix rides a small refactor: every provider now publishes the same additive `ExecuteUsage` shape (built once by a new `mapUsage` helper that mirrors opencode's `Usage` design), so the loop accumulates by reading each input field once instead of composing a derived total that could drift from what the SDK actually sent.

### Added
- **`provider-shared` normalization module** (`apps/core/src/providers/provider-shared.ts`). Opencode-style `safe` / `sumTokens` / `subtractTokens` / `totalTokens` / `visibleOutputTokens` / `mapUsage` helpers, plus `ExecuteUsage` — the canonical shape every provider mapper now publishes (`inputTokens` inclusive of cache, `nonCachedInputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`, `outputTokens` inclusive of reasoning, `outputVisibleTokens`, `reasoningTokens`, `totalTokens`, plus `providerMetadata` for billing audit). Helper contracts: every helper returns `undefined` rather than fabricating a zero when the input does not support an answer, and `subtractTokens` / `visibleOutputTokens` are clamped to zero so a provider bug cannot silently store a negative count. Covered by `provider-shared.test.ts` (23 cases).

### Changed
- **All six provider mappers now publish `ExecuteUsage` via `mapUsage`** (`apps/core/src/providers/{anthropic,openai,gemini,minimax,deepseek,zai}.ts`). The Anthropic wire fields (`cache_creation_*`, `cache_read_*`) used to be hand-read off `providerMetadata.anthropic` — a path that drifted behind the SDK's actual surface and exposed fields no sibling provider had. They now ride through `inputTokenDetails.{noCache,cacheRead,cacheWrite}Tokens` like every other provider, so the six adapters are uniform and no field is provider-specific. `cacheCreationInputTokens` is kept on `ExecuteUsage` as an alias for `cacheWriteInputTokens` so downstream readers (loop, cache-awareness, recorder, IPC) can rename in follow-ups without another mega-diff.
- **`normaliseAiSdkStream` finish branch uses `mapUsage`** (`apps/core/src/providers/streaming.ts`). Was hand-reading `chunk.totalUsage.inputTokenDetails` *and* the Anthropic wire fields under `chunk.providerMetadata.anthropic` — duplication that drifted behind the SDK's actual surface and missed fields every other provider exposes. Now matches the `execute()` path field-for-field, including `reasoningTokens` and `nonCachedInputTokens`. The dead `providerMetadata.anthropic.cacheCreationInputTokens` fallback test is gone (every Anthropic adapter today also populates `inputTokenDetails.cacheWriteTokens`).
- **`recordDailyUsage` tracks reasoning + visible output** (`apps/core/src/usage/tracker.ts`). The daily heatmap now records `reasoningTokens` and `outputVisibleTokens` (visible = output − reasoning, clamped at zero) so the `/usage` view can show what was billed for hidden reasoning. The loop's `emitCacheWarm` honors both `cacheWriteInputTokens` and the legacy `cacheCreationInputTokens` alias.

### Fixed
- **Anthropic cache writes double-counted in loop + tracker** (`apps/core/src/agent/loop.ts`, `apps/core/src/usage/tracker.ts`). The loop accumulator was running `totalInputTokens += inputTokens + cacheCreationInputTokens` "to be safe" — but the AI SDK's `inputTokens` is already `nonCached + cacheRead + cacheWrite` for Anthropic, so every Anthropic turn added the cache writes twice (loop + context), and `recordDailyUsage` added them a third time on top of `inputTokens`. The fixed shape is `inputTokens === nonCachedInputTokens + cacheReadInputTokens + cacheWriteInputTokens` (guaranteed by `mapUsage`), so all three accumulators now read `usage.inputTokens` directly. `tracker.test.ts`'s legacy `1115` expectation was the double-count artifact; correct value is `1015`.

## v0.25.11

Two transport-level bugs had been masking themselves as routine failures: the recovery loop was treating Bun/undici's native `DOMException` timeout as fatal and aborting the turn, and the core logger had been writing JSON-RPC frames into the same `stdout` channel the protocol itself rides. The classification bug had a real user-visible cost — a single stalled connection in the middle of a long task would end the run instead of backing off and retrying — and the logger bug was a latent wire-format corruption that would only have surfaced when a stricter JSON-RPC client refused to read past a stray log line. The multi-session `sessionId` thread ran alongside: every `StreamEvent` variant now carries an optional `sessionId` that the bus re-attaches from the `StreamRelayEvent` wrapper, so multi-session consumers can route each line to the right session without every event author having to remember to stamp it themselves. The TUI is unaffected (single-session); the field is implicit for old code paths.

### Added
- **`sessionId` on every `StreamEvent` variant** (`packages/shared/src/ipc/protocol.ts`). Optional on the wire, populated by `busEventToClientEvent` (`apps/core/src/bus/bridge.ts`) from the `StreamRelayEvent` wrapper so multi-session consumers can correlate each line without event authors having to stamp it. Carried through `tool_start` / `tool_output` / `tool_complete` / `thinking` / `text` / `text_delta` / `thinking_delta` / `done` / `error` / `message_queued` / `message_dequeued` / `memory_injected` / `cache_status` / `notice` / `usage_totals` / `compaction_start` / `compaction_complete`. The TUI is already scoped to one session and ignores the field; the new threaded binary design (the same `freecode serve` speaking JSON-RPC over stdout to multiple frontends) is the consumer that needs it.
- **`scripts/freecode-serve-dev.sh`** — runs the core CLI straight from source via `bun run apps/core/src/cli.ts`, bypassing the ~95MB `bun build --compile` step. Lets contributors iterate on a single source fix (e.g. the bridge change above) without paying for a full bundle rebuild on every iteration. Hardcodes the mise-managed `bun` path with a `command -v bun` fallback for environments where the shim is on `PATH`.

### Fixed
- **`isTransientError` misclassified native timeouts as fatal** (`apps/core/src/agent/recovery/manager.ts`). Bun/undici raise a native `DOMException` (name `TimeoutError`, numeric `code` 23) when a fetch's underlying connection stalls, ahead of and independent of the `createTimeoutFetch` AbortController layered on top. Its message ("The operation timed out.") doesn't contain the substring "timeout" and its `code` is a number rather than one of `NETWORK_ERROR_CODES`' strings, so neither existing check caught it — a plain network hiccup in the middle of a long task ended the run instead of backing off and retrying. A new `isNativeTimeoutError` helper matches the `name`/`code` pair, and the loose-message path picks up "timed out" for unwrapped errors.
- **Logger wrote JSON-RPC frames into `stdout`** (`apps/core/src/utils/logger.ts`). Core speaks JSON-RPC over `stdout` (`freecode serve`), so a log line at the wrong time was indistinguishable from a protocol frame — strictly-compliant clients would skip the bogus message or tear down the reader entirely. `ConsoleLogger` now writes to `process.stderr`; frontends already surface stderr as chatter, so the user-visible effect is unchanged.

## v0.25.10

The agent loop had two overlapping iteration caps — `AgentLoopConfig.maxIterations` (the per-call ceiling a caller passes, used by subagents and `claude -p`-style headless runs) and `LoopHeuristics.totalIterationLimit` (a default of 250 baked into `DEFAULT_LOOP_HEURISTICS`). Both ran on the same tool-call counter, but only one was actually load-bearing: the repeated-tool, stagnation, and oscillation heuristics above it already catch the genuinely stuck patterns, and any caller that *wanted* a hard cap was passing `maxIterations` explicitly — which trips before `totalIterationLimit` would. The 250 default was a safety net nobody was asking for; on a long-running task with many distinct tool calls it would fire mid-turn and the user would see the loop abort with no obvious reason. `totalIterationLimit` is now `Infinity` so the heuristics alone decide when a turn is stuck, and `maxIterations` is the one knob callers reach for when they actually want a turn cap. The behavior is unchanged for any caller that already passed `maxIterations`; interactive TUI turns just stop having a hidden 250-iteration trip wire.

### Changed
- **`totalIterationLimit` defaults to `Infinity`** (`apps/core/src/agent/types.ts`). The previous default of 250 was a redundant ceiling — `AgentLoopConfig.maxIterations` is what callers like subagents and headless invocations use to set a real turn cap, and the loop's repeated-tool / stagnation / oscillation heuristics already short-circuit genuinely stuck patterns. The default now matches the policy the heuristics already enforce; callers that want a hard turn cap pass `maxIterations` explicitly.

## v0.25.9

The memory-graph auto-injection path used to be silent — saved memories surfaced into the prompt with no visible cue, so a recall either happened or it didn't and the user had to trust the model's behavior to know which. A new `memory_injected` stream event (`packages/shared/src/ipc/protocol.ts`, emitted from `apps/core/src/agent/loop.ts`) fires once per user message that lands a hit, not every inner-loop tool-call turn, and the TUI renders it as `*Recalled N things from memory: type/name, …*` so the user can see what was pulled in. The dedup key is the query text, so a repeated call with the same user message doesn't spam the notice. While moving the recall out of the "skip on same text" fast path, the underlying `MemoryGraphService.prepareMemories` was changed to be safe to call every turn instead of every user-text-change — a cold-start miss whose background retrieval lands just after `COLD_BUDGET_MS` gives up now surfaces on the very next inner-loop turn instead of being lost until the user types again.

### Added
- **`memory_injected` stream event** (`packages/shared/src/ipc/protocol.ts`). Emitted from the agent loop when an automatic (non-`memory`-tool) retrieval surfaces one or more saved memories into a turn's prompt. Carries `{ type, name }` per memory so the UI can name them without fetching the bodies. Deduplicated per user message text — one notice per request, regardless of how many tool-call turns the inner loop runs. Wired into the TUI (`apps/tui/src/index.ts`) as `*Recalled N thing(s) from memory: …*` so the auto-injection is no longer silent.

### Changed
- **`MemoryGraphService.prepareMemories` is now safe to call every turn** (`apps/core/src/memory/graph/index.ts`). Previously skipped when the user text was unchanged, so a cold-start retrieval whose background fetch completed just after the `COLD_BUDGET_MS` wait timed out never got a chance to surface until the next user message. A new per-session `resolved` flag means once a query is "resolved" (hit or confirmed miss), the call is a cheap synchronous stash read — no re-fetch — so the always-call pattern costs nothing on warm turns while still letting a late-arriving miss land.

## v0.25.7

A supervising process wrapping the TUI in a PTY (e.g. agent-board) now has a guaranteed way to ask for a clean shutdown: a new `InterruptController.forceExit()` runs the same shutdown + resume-hint sequence as a confirmed double Ctrl+C, without needing the double-press to land first. The race was that the first Ctrl+C could be consumed by an in-flight turn's `cancelTurn` instead of arming exit, so the second Ctrl+C only armed it and the resume hint never printed before SIGTERM killed the process. `forceExit` lets a SIGTERM handler run that sequence directly, so the hint lands regardless of where the first Ctrl+C went.

### Added
- **`InterruptController.forceExit()`** (`apps/tui/src/interrupt-controller.ts`). Public method that delegates to the existing private `exit()` — runs `shutdown()`, prints the `freecode --resume <sessionId>` hint on TTY, then `process.exit(0)`. Wired from `apps/tui/src/index.ts`'s SIGTERM handler so a wrapper process can guarantee a clean shutdown even when its first Ctrl+C is swallowed by an active turn. Covered by `interrupt-controller.test.ts` (3 tests: hint + shutdown + exit code path, no `isTurnActive()` precondition, normal Ctrl+C during an active turn still cancels rather than exiting).

## v0.24.6

The assistant's code samples in chat now render like code in an editor — a dim line-number gutter and Dracula syntax colors — instead of a flat monospace block. Before, fenced code blocks (` ```ts `) fell through to pi-tui's default plain-text rendering, so a multi-line snippet looked the same as the surrounding prose and the only visual cue it was code at all was the faint gutter that some Markdown themes draw. Wiring `renderCodeBlock` into the Markdown theme's `highlightCode` hook gives every code block a uniform look regardless of which model produced it: 3-wide right-aligned line numbers, a dim vertical pipe separator, and token-level highlighting. The first attempt at this used a green `+ N` prefix — diff-style — but the `+` carried an "added to a file" implication that doesn't apply to code the model is just showing. The gutter is now neutral (`  N │`); the green stays where it actually means "added", in `renderDiff`. While moving it, `renderCodeBlock` and the shared Dracula palette were extracted out of `diff-view.ts` into a new `code-block.ts` — code-block rendering and diff rendering share styling but no logic, and the old module name implied it was the home for all colored code in the TUI.

### Added
- **Code blocks render with a line-number gutter and syntax highlighting** (`apps/tui/src/themes.ts` → `defaultMarkdownTheme.highlightCode`). The Markdown theme's `highlightCode` hook is wired to `renderCodeBlock`, so every fenced code block the model emits in an assistant message is decorated. The gutter is `  N │` (3-wide, right-aligned, dim) followed by cli-highlight output under the same Dracula palette used by `renderDiff`. Empty / whitespace-only lines are skipped past cli-highlight's tokenizer (it errors on whitespace-only input) and rendered raw so the gutter still anchors them. Unsupported / unknown lang tags fall back to plain text rather than throwing.

### Changed
- **`renderCodeBlock` and `diffTheme` moved to their own module** (`apps/tui/src/components/code-block.ts`). Both were originally exported from `diff-view.ts` alongside `renderDiff`, `looksLikeDiff`, and `getDiffStats` — code-block rendering has no `+`/`-` semantics, and the shared palette is the only thing it actually shares with diff rendering. `diff-view.ts` now re-imports `diffTheme` from `code-block.ts` for its `renderDiff` highlighting path; `themes.ts` and `tool-result-message.ts` import from the new file. Test file moved alongside to `code-block.test.ts` (10 tests: gutter shape, 1-indexed padding, lang aliases, fallback paths, malformed input).

## v0.24.5

The 0.24.4 fix for the launch-time update check shipped the new binary to disk but kept running the old TUI — the `realpathSync` guard that decided whether to re-exec was evaluated before the installer ran, so at that moment the `stable` symlink still pointed at the version the process was started from, the comparison said "no change", and the running binary restarted itself. The new version was correctly installed under `~/.freecode/builds/versions/0.24.5/` and `stable` was correctly rewritten to point at it, but the TUI that opened was the same old in-memory binary, so the user saw `[freecode] updating 0.24.3 → 0.24.4` and then the 0.24.3 TUI — and had to relaunch to get the new one. The comparison now runs after the installer finishes, so a rewritten `stable` correctly triggers a re-exec through that symlink in the same launch, and the no-op case (`stable` still matches `process.execPath`, or no bundled install exists, or dev mode) returns to the caller instead of spawning itself for nothing.

### Fixed
- **Update check ran the old TUI after the new version installed** (`apps/tui/src/entry.ts:checkForUpdate`). The `fs.realpathSync(stable) !== fs.realpathSync(process.execPath)` check that picks the re-exec target was computed before the installer had rewritten `stable`, so on every version bump the two paths agreed, the re-exec fell through to `process.execPath`, and the same old binary restarted itself. The check is now evaluated after the installer; when `stable` differs, the new binary is exec'd through the symlink in the same launch; when it doesn't, the function returns and the current process loads the TUI directly.

## v0.24.4

The launch-time update check installed the new release but kept opening the old TUI — a "have to close and re-launch" bug that defeated the point of the check. Re-exec went through `process.execPath`, which on Linux and macOS is the concrete path the kernel resolved at process start: the file inside `~/.freecode/builds/versions/<old>/`, not the symlink chain the installer had just rewritten. The freshly installed binary sat on disk and the next `freecode` invocation would have picked it up, but the post-install TUI did not. The re-exec now goes through the installer's `stable` symlink at `~/.freecode/builds/stable/freecode`, which is rewritten on every install to point at the version just unpacked, so the kernel re-resolves to the new binary and the new TUI opens in the same window. A `realpathSync` guard makes it a no-op when the symlink already agrees with `process.execPath`, so the path doesn't loop on a launch that didn't update. While the pinned header was being moved, the top-right `ContextBox` overlay was pulled flush with the top-right corner — its `offsetY` of 8 had been there to clear the now-gone pinned rows, and the `offsetX: 2` was a leftover from when the header reserved space across the full width.

### Fixed
- **Update check kept running the old TUI after a successful install** (`apps/tui/src/entry.ts:checkForUpdate`). The installer had already replaced `~/.freecode/builds/stable/freecode` to point at the new version dir, so the on-disk wiring was correct; the bug was purely in the re-exec target. Symlink-relative re-exec + `realpathSync` guard so we don't loop when already up to date, with `process.execPath` retained as the fallback for non-bundled / dev runs.

### Changed
- **Logo header scrolls with the messages** (`apps/tui/src/index.ts`). The pinned `LogoHeader` (logo + version + tools/MCP + directory) is now passed as the optional `header` slot of `VirtualMessageList`, which renders it as the first rows of the scrollable viewport. Scrolling the transcript now scrolls the header out of the way instead of leaving it fixed above an empty-looking chat.
- **`ContextBox` overlay sits flush in the top-right corner** (`apps/tui/src/index.ts`). `offsetY` and `offsetX` both dropped to `0`; the previous values were there only to clear the now-removed pinned header and to add a two-column margin that is no longer needed.

## v0.24.3

The top of the TUI gets a real header. The previous `ResponsiveInfoBox` was a per-message list entry that scrolled away with the transcript, leaving the first visible row of a fresh session empty; the only branding was the `>_ FreeCode` line in the prompt editor. A new `LogoHeader` (`apps/tui/src/components/logo-header.ts`) is pinned to the first row, shows the FreeCode wordmark in two-tone yellow, the version, and a compact `Tools: N    MCP: M    Directory: <cwd>` line. Tool and MCP counts are fetched once at startup (`listTools` + `mcpStatus` in parallel) and cached as `-1` until they resolve, so the header renders `…` instead of blocking on the daemon. The old `infoBox` slot in `VirtualMessageList` is now `undefined`, and the right-edge `ContextBox` overlay was pushed down (`offsetY: 8`) to clear the new header. The interrupted-session startup banner was removed at the same time — `--resume` and `/resume` still cover that path, and a banner that named an interrupted session on every cold boot had outlived its usefulness.

## v0.24.2

`freecode` now checks for updates on launch instead of requiring `freecode update` to be run manually.

### Added
- **Launch-time update check** (`apps/tui/src/entry.ts`). The compiled binary compares its baked-in version against GitHub's latest release tag once per launch (3s timeout, best-effort — offline or GitHub-down just skips the check). If current, the TUI opens as before. If stale, it prints `updating X → Y`, runs the same installer `freecode update` uses (with its normal progress output), then re-execs the freshly installed binary so the TUI that opens is the new version, not the one already loaded in memory. Dev (`tsx`) is unaffected — the check only runs when `FREECODE_BUNDLED=1`.

## v0.24.1

Fatal CLI errors now print a clean, formatted message instead of a raw stack trace.

### Added
- **`formatFatalError` utility** (`apps/core/src/cli/format-fatal-error.ts`), used by `cli.ts` and `apps/tui/src/entry.ts` to render uncaught startup errors consistently.

## v0.24.0

Clicking a node in `/graph` now shows the memory behind it. It previously did nothing, and there was nothing it could have done: the graph payload carried no content.

### Added
- **Node detail in the graph explorer.** `/api/graph` sends `{ id, kind, label }` per node — three strings, enough to draw a circle and nothing to read. The graph is a *derived index*; the description, body, tags and timestamps live in the memory store and were never served, and `graph.js` wired drag and a `<title>` hover tooltip but no click handler. A new `GET /api/node?id=…` resolves a node id back to its `MemoryEntry` plus its immediate neighbours, and clicking a node opens a panel with the description, type, created/updated, tags, the full content, and a clickable list of what it connects to. Escape or a background click closes it. Fetched on demand rather than folded into `/api/graph`, so the initial payload stays small on a large graph. Tag and Cluster nodes are synthetic groupings with no stored entry — they return `entry: null` and say they group the memories below, rather than rendering an empty panel that reads as broken. All panel text goes through `textContent`: memory bodies are user text and must never reach `innerHTML`. The explorer still binds to `127.0.0.1` only.

### Note
- The explorer page ships as the optional `graph-ui.tar.gz` addon, so this needs `freecode memory ui-install` after upgrading — the new page calls an endpoint older binaries don't serve.
- Memories carrying no `tags` and no `[[wikilinks]]` produce no edges, so a fresh graph is a set of disconnected nodes and every `connected` list is empty. That is the derivation working as specified, not a rendering fault.

## v0.23.1

Fixes two false positives in v0.23.0's observability work, one of them capable of aborting healthy requests. Both had the same root cause: a detector placed at the layer that was convenient to instrument rather than the layer carrying the signal.

### Fixed
- **The stall guard could abort a healthy request mid-write.** It bounded silence between `ProviderChunk`s — downstream of `normalizeAiSdkStream`, which forwards 5 part types and drops the rest. The AI SDK streams a tool call's *arguments* as `tool-input-delta` parts and only emits `tool-call` once they are complete, so a model writing a large file produced a continuous stream at the wire and total silence at the measurement point. With no preceding prose the entire tool-argument generation fell under the 120s first-chunk budget, and `OUTPUT_TOKEN_CAP` is 32,000 tokens — a large `write` on a slow provider was a plausible false kill. Thinking boundaries, `start-step` and SSE keep-alives were invisible for the same reason. Timeouts now live in a `fetch` wrapper below the SDK (`providers/fetch-timeout.ts`), where every byte counts: 300s for response headers (cleared the instant they arrive, so it never caps generation time) and 180s of total silence on a live SSE stream. `FREECODE_HEADER_TIMEOUT_MS` and `FREECODE_SSE_STALL_TIMEOUT_MS`, `0` disables either. This is the structure opencode arrived at (`timeoutController` + `wrapSSE`). The old `FREECODE_FIRST_CHUNK_TIMEOUT_MS`, `FREECODE_STREAM_STALL_TIMEOUT_MS` and `FREECODE_REQUEST_TIMEOUT_MS` are gone.
- **`freecode trace` called every in-flight request a hang.** `buildTrace` had no state between "terminated" and "hung", so under `--follow` a request one second old rendered as `HUNG — request never terminated` and then "recovered" when the response landed. A warning that fires on healthy runs teaches you to ignore it. An open span is now `in_flight` until it has been open past `HANG_THRESHOLD_MS` (300s, matching the header timeout), and only then `hung`.

## v0.23.0

FreeCode could not tell you why it was slow. A session was measured at 34 minutes wall clock, of which all 27 tool calls accounted for under one second; the remaining ~31 minutes went somewhere the system had no name for. The rollout log had twelve event types covering tools, hooks, skills, subagents, compaction and parse errors — and none for the provider round trip, so the slowest and most failure-prone step in the loop was the one step that left no trace. Worse, nothing bounded how long a request could take: a provider that accepted the connection and then went silent parked the loop indefinitely, with no error, no timeout and no event. Because the TUI shows the last thing that emitted an event, that rendered as "stuck on `todowrite`" — the todo list was a symptom, not the problem. Design in `docs/superpowers/specs/2026-08-10-agent-observability.md`.

### Added
- **Model calls are recorded.** Four new rollout events — `model.request`, `model.first_token`, `model.response`, `model.error` — carrying provider, model, message count, prompt size, time-to-first-token, duration, token counts, cache hits, tool calls and error kind. `model.request` is written *before* the call rather than after, which is the load-bearing decision: a request with no matching terminator is what a hang looks like in the log, and an absence is only detectable if the opening line was recorded first. `promptChars` is a character count rather than a token estimate, because it exists to make runaway context growth visible turn-over-turn and a cheap comparable number beats an expensive precise one — `JSON.stringify` over a 100KB prompt every turn is not worth it.
- **A stall guard.** Provider requests are now bounded on *silence*, not total time: a long reasoning turn that keeps emitting thinking deltas is healthy and must not be killed, while a stream that says nothing for a minute is not. 120s for the first chunk, 60s between chunks, 300s for a whole non-streaming call, each overridable via `FREECODE_FIRST_CHUNK_TIMEOUT_MS` / `FREECODE_STREAM_STALL_TIMEOUT_MS` / `FREECODE_REQUEST_TIMEOUT_MS`, with `0` disabling. On expiry the loop aborts a per-call `AbortController` chained to the session's, so the socket actually dies rather than being orphaned. The guard's own iterator close is deliberately not awaited: `return()` on an async generator parked inside an `await` does not settle until that await does, so awaiting it when a provider has gone silent would hang in the cleanup path — reintroducing the exact bug.
- **`freecode trace`.** Reads the log back as a timeline: a waterfall of model and tool spans, and a where-the-time-went breakdown across model, tools and idle. `--follow` redraws every second, which is the only way to watch a hang happen. Also `--slow <ms>` to filter long sessions down to the calls that matter, `--list`, `--json`, and `--tools=false`. When a log contains no model events at all it says so explicitly instead of reporting "no hangs" — silence there means nothing was recorded, not that nothing went wrong.
- **OTLP export.** `freecode trace <id> --otlp [url]`, falling back to `OTEL_EXPORTER_OTLP_ENDPOINT`, ships a session to Langfuse, Phoenix, Jaeger, Tempo or any OTLP/HTTP collector. Attributes follow the OpenTelemetry GenAI semantic conventions, which is what makes the spans render as LLM calls rather than anonymous blobs. Two deliberate constraints: it exports from the log rather than the hot path, because an exporter inside the agent loop is one more thing that can block, buffer or throw inside the request we are trying to make faster; and it carries no SDK dependency, since OTLP/HTTP accepts plain JSON and the whole exporter is a `fetch` and a shape. Because the log records sizes and token counts rather than message bodies, no prompt or completion text leaves the machine.

### Known
- A stall is retried by `RecoveryManager` like any other transient error, so a genuinely dead endpoint now fails after roughly `3 × 120s` rather than never. Whether a stall should be retried fewer times than a 429 is left open rather than decided silently.

## v0.22.0

Memory gets a write path. The knowledge graph — embeddings, cascade, clustering, `/graph` — has been implemented since v0.7.0 and was retrieving from an empty directory: nothing in FreeCode ever created a memory. There was no tool, no prompt telling the model memory existed, and no frontend caller of `memory.save`. The store now fills itself, from the model during a turn and from an extractor after it. Design in `docs/superpowers/specs/2026-08-09-memory-write-path.md`; the whole subsystem, read and write, is written up in `docs/superpowers/MEMORY_SYSTEM.md`.

### Added
- **A `memory` tool** — `save` / `delete` / `list` over `MemoryStore`, so the model can record a durable fact when it learns one. It wraps the store rather than instructing the model to hand-write files with `write`: that keeps frontmatter valid, `MEMORY.md` regenerated, and the derived graph incrementally updated, none of which survive a model typing YAML by hand. `save` is idempotent on name and reports `created` vs `updated` with the previous description, so the model can see when it has just clobbered something it didn't mean to. `list` returns names, descriptions and types only, never bodies — it is the dedup check before a save, not a bulk-recall path; recall is what the graph is for.
- **The model is told it has memory,** in the cached static prefix. The guidance is constant text — what memory is, the four types, what not to save — so it is paid for once per session at cache creation and read at ~10% thereafter. `MEMORY.md` is deliberately *not* injected: semantic retrieval already surfaces the relevant memories per turn, and injecting the index would rewrite the static prefix on every save, busting the entire cached prefix for the rest of the session. A user with 500 memories pays the same ~150 tokens as a user with none.
- **Turn-end extraction.** A model that forgets to call the tool is the common case, so after a run completes naturally a one-shot provider call mines the transcript for durable facts and saves up to 3. It is fire-and-forget — the loop returns immediately, errors are swallowed at debug level, and a memory failure is never visible in your task. Subagents don't extract: `executeSubagent` passes `memoryExtraction: false`, otherwise every verifier and explorer would fire its own call against a transcript of delegated machine work.
- **A notice when something is remembered for you.** Tool saves already render as an ordinary tool call, but extraction was writing files describing the user with nothing anywhere in the UI. Each extracted memory is now named in a system notice, with pointers to `/graph` and to the off switch. It rides the bus rather than the turn stream, because extraction finishes after the turn's `done` and the stream is already closed by then.
- **Secrets are refused at write time.** `containsSecret()` was consulted only before embedding, so a secret-bearing memory was never vectorized but *was* still written to disk in plaintext and still injected through the keyword fallback. The tool now runs the same check on description + content and refuses the save with an explanation.

### Changed
- **Extraction is gated rather than run on every completion.** claude-code can afford per-turn extraction because its forked agent shares the parent's prompt cache; ours is a fresh full-price call, so copying the cadence without the cache would be a real per-turn cost. Four gates, cheapest first: skip if the `memory` tool already ran this run (the model has said what it wants kept — a second model second-guessing it is the least valuable call available); skip transcripts under 200 chars or 2 turns; otherwise every 8 runs (`memory.extractEveryNRuns`) or on topic change. Throttling loses nothing, since the transcript is rebuilt from the session's whole history rather than the current run, so a skipped run is covered by the next extraction. Measured on a simulated 20-run session: 20 provider calls down to 3. Off entirely with `"memory": { "autoExtract": false }` in `.freecode/settings.json` or `FREECODE_DISABLE_MEMORY_EXTRACTION=1`; an unparseable settings file falls through to defaults rather than silently disabling memory.
- **`memory` is a mutating tool** and is not in `READONLY_TOOLS`, so it is blocked in `plan`, `review` and `explore` like every other tool that writes to disk. The accepted cost is that a preference stated during a planning session isn't captured by the tool; extraction runs on its own profile and is unaffected by the parent's mode.

## v0.21.0

The observability follow-up to v0.20.0. That release made prompt caching work; this one makes it legible — the hit rate is reported rather than left as a division you do per turn, the daily record keeps enough detail to see a regression, and a detector names the turn that broke the prefix instead of leaving it to be found by hand months later. Design in `docs/superpowers/specs/2026-08-09-cache-observability.md`.

### Added
- **The prompt-cache hit rate, per run and per session.** The TUI already showed `cached: 89.2k` next to `↓12.3k` — an 88% hit rate, if you did the arithmetic every turn and never across the session. The run footer now reports `cache 88% (89.2k read, 4.1k write) · session 84%`. Writes are shown alongside because they bill at ~1.25x: a rate bought by constant rewriting is not a win, and the raw read count hides that. Session totals reset on resume rather than inheriting the previous session's numbers.
- **`/cost`.** The rate was visible only for the run in front of you; `usage.json` stored one `tokencount` per day, so there was no way to see whether the rate regressed or when. The daily record now splits into input/output/cacheRead/cacheWrite, and `/cost` reads it back as session, today, last 7 days and all time. Session leads because it is the number you can act on, and is omitted before the first run completes rather than printing a 0% that reads as a cache failure. Days recorded before this have no breakdown and are excluded from the sums instead of counted as zero — folding a real 5M-token day in as 0 read / 0 input would drag every rate toward 0% and make a working setup look broken. `tokencount` keeps its meaning, so existing heatmap history stays comparable.
- **An idle-return nudge.** After a gap longer than the cache TTL, the next message re-sends the whole conversation as fresh input at full price. When that context is also large (≥100k, `FREECODE_IDLE_NUDGE_TOKENS`, `0` disables), the TUI says so before sending and lets you decide — only you know whether the next message continues the old task. Idle is measured against the configured TTL, so it stays true under `FREECODE_CACHE_TTL=1h` instead of contradicting the cold-cache warning that shares its clock. A hint, never a blocking dialog.
- **A prompt-cache miss detector.** A hit rate says money was lost; this says which turn lost it. After each response the detector compares cache usage against the previous call — reading none of a known prefix, or less than was cached, means bytes at an earlier position changed. Sites that knowingly change the prefix (compaction, a system-prompt hook rewrite) record why in an invalidation journal, and a documented miss stays at debug; an undocumented one raises a notice, because silence in the journal means something mutated an already-sent message. That is exactly the bug class RC3/RC4 in v0.20.0, both found by hand long after they landed. Detection is deliberately conservative: first call, post-compaction rebuild, and providers that report no cache fields are all silent, since a detector that cries wolf gets switched off before it catches anything.
- **Byte and line limits on `read`,** with errors that say which limit was hit, and adaptive truncation that snaps its cut to a line boundary instead of mid-token.

### Changed
- **Tools no longer render.** The per-tool UI layer is gone from core (~1,400 lines): core emits `StreamEvent` data and each frontend draws it, which is what the architecture already claimed and what every frontend except the TUI was already doing.

### Fixed
- **`/clear` was a no-op.** It printed `*Messages cleared*` and touched neither the transcript nor core, so the entire conversation kept being re-sent on every later request — the command most likely to be reached for on a cost warning was the one doing nothing about it. It now clears the transcript, starts a fresh core session, and resets the session-scoped counters.
- **A prompt starting with an absolute path was dispatched as a slash command.** `/home/me/repo check this` came back as `Unknown command: /home/me/repo` instead of reaching the model, because a leading `/` alone decided. The first token must now also look like a command name, so anything carrying a path separator is a prompt. Single-segment paths (`/tmp check this`) are still read as commands.

## v0.20.0

The token-efficiency release. Prompt caching was measured at ~5% hit rate across six live sessions; it now runs at 90–99.8% on steady-state turns. Every cause was ours, none was the provider. Full write-up in `docs/superpowers/2026-08-06-prompt-caching-findings.md`, architecture in `docs/caching-architecture.md`.

### Added
- **Queued follow-up messages.** Sending a prompt while a turn was still running started a second agent loop on the same session and corrupted the message history. Mid-turn prompts now park in a per-session FIFO, show a dim `queued` badge, and drain when the active turn ends; `Ctrl+Backspace` pulls the most recent one back into the editor for editing. Adds the `session.dequeue` IPC method and queue stream events.
- **Live usage counters in the TUI.** The in-progress row previously showed a ~4-chars-per-token guess for the whole run — exactly the long multi-turn runs whose cost matters most. It now prefers the provider's own reported totals, falling back to the estimate only where nothing authoritative has arrived yet.
- **A turn spend circuit breaker.** Loop-health could see an oscillating or stuck loop but nothing capped actual spend, so a runaway run could burn a plan's quota quietly. `FREECODE_MAX_TURN_TOKENS` (off by default) aborts the run once billed input+output crosses it and names the count in the stop message.
- **Configurable prompt-cache TTL.** `FREECODE_CACHE_TTL=1h` keeps cache entries alive across long gaps between turns. The default stays `5m` and is byte-identical to what shipped before the knob existed, so upgrading can't invalidate a live cache: 1h moves writes from 1.25x to 2x base, which one cold rewrite an hour pays for but a gapless run does not.
- **Per-request token usage is now recorded** in the session transcript, and `pnpm analyze:session` reports cache read/write/uncached counts, the hit ratio with a verdict band, a billed-equivalent cost, and a tool-calls-per-response histogram. Sessions recorded before this say "no usage recorded" rather than reporting 0%, which would read as a broken cache.
- **`read` no longer re-sends a file the model is already holding.** An identical re-read of an unchanged file returns a pointer instead of the body, and `edit` warns when the file changed on disk since the model last looked. Gated on the same line window, on the file not having been written by `edit`/`write`, and on the earlier result still being in context. `FREECODE_READ_DEDUP=0` disables it — this is the only change in this release that alters what the model sees rather than only what it is billed.
- `FREECODE_DEBUG_CACHE=1` fingerprints each cacheable prompt segment on stderr. When a hit rate drops, the question is always "which segment moved?", and token counters can't answer it.

### Changed
- **Auto-compaction now triggers on cost, not only on fitting.** It fired only when the next request wouldn't fit the model's context window — on a 1M-window model that put the trigger near 968K, so a session peaking at 270K never compacted and every request carried the full history. The threshold is now capped at 120K (`FREECODE_COMPACT_TARGET_TOKENS`). This binds on any model whose usable window exceeds the cap, 200K models included; smaller windows are unaffected.
- The system prompt now leads its tools section with parallel tool calls rather than burying it in a trailing clause. Adherence is model-dependent and measured between 0% and 71% of responses across four sessions — the instruction is advisory, and nothing in core prevents parallel tool use.

### Fixed
- **Seven separate bugs kept the prompt cache from ever being read.** Only the final message was marked as a cache breakpoint, so every breakpoint described a prefix ending in content the model had never seen — a request could write an entry but never read one. The read anchor, once added, was placed two messages back, which misses whenever a tool-using turn expands into two wire messages. Dynamic content (file tree, memory, clock) sat inside the cached system region, so it invalidated the prefix from that point on every turn; moving it to the first user message then re-introduced the same failure through `recentMessages`, which grow every turn, at the single most cache-sensitive position in the request. Adding the second anchor pushed the request to five breakpoints against a provider limit of four, which the AI SDK silently drops one of rather than erroring. Cache markers were also set on the Anthropic provider key alone, so the same model reached through a gateway cached differently from a direct connection. And the counters reporting all of this read the Anthropic wire names instead of the AI SDK v6 usage shape, so every turn recorded 0 reads and 0 writes — the work was unmeasurable end to end while it was being done.
- **The cached prefix was rewritten from byte zero on most turns.** History pruning re-derived its decisions from a sliding window, so a tool result sent whole on one turn went out truncated on the next — mutating the prefix two turns back, every turn, in the region holding the largest results, to save ~250 tokens. Decisions are now recorded and re-applied verbatim. Separately, every `write`/`edit`/`bash` call invalidated the cached project tree, and the process-level tree cache could refresh mid-session from its TTL or file watcher; the tree, git head and clock are now snapshotted once per session. The existing watcher and TTL still catch genuine external changes for everything else.
- **Idle pauses threw away the whole conversation cache and the model's working memory.** A five-minute gap cleared every tool result over 200 chars across the entire history — including the turn that had just completed — replacing each with a bare marker and no way to retrieve what was dropped. So the next request missed the cache 100% *and* the model re-read what it had just been shown. Removed; size- and age-in-turns-based pruning already covers what this was for.
- **The built core ran on a 71-character system prompt.** `tsc` emits only JS, so `system.md` never reached `dist/` and the prompt loader fell through to a stub fallback. The TUI prefers `dist` over `tsx`, so every `pnpm dev` run drove the agent with no tool guidance, no coding standards and no mode behaviour — degrading quality invisibly instead of failing. Release binaries were never affected (they bake the prompt in). A copy-assets step now runs after `tsc`, and the fallback logs a warning instead of passing silently.
- OpenAI-family requests now carry a stable per-session prompt cache key, so a conversation's turns keep landing on the machine where its own prefix is already warm. Subagents route on their own id, not the parent's.
- Cache instrumentation was written to stdout, which is core's JSON-RPC channel — the frontend's protocol reader swallowed all of it. It goes to stderr now.
- `analyze:session` reported roughly double the real input cost (it charged per persisted message, but one provider response is stored as several) and roughly half the real hit rate (it double-counted cached tokens, which AI SDK v6 already includes in `inputTokens`). It also reported "no parallelism" for any session with nothing to batch, and could not see parallel tool calls at all.

## v0.19.1

### Fixed
- **The released binary served no web UI.** `freecode web` (and therefore `freecode mobile` and every phone client) returned 404 for every page: the compiled binary bundles JavaScript but not static assets, and nothing shipped the web app alongside it. The desktop never noticed — the TUI doesn't use the web UI and the API answered normally, so pairing a phone even reported success — while the phone, which has no interface of its own and simply displays what the desktop serves, showed a blank screen with no error anywhere. The web app now travels with the binary, the packaging step refuses to build without it, and the server says so loudly if it's ever missing again.

## v0.19.0

### Added
- **Prompt from your phone.** `freecode mobile` is one command from nothing to a paired phone: it checks Tailscale (installing, starting and signing in with your confirmation — never silent `sudo`), resolves your MagicDNS hostname, serves the UI over your tailnet, prints a QR, and confirms when the phone actually connects. No port is opened to the internet and the `127.0.0.1` default bind is unchanged; remote exposure still requires an explicit `--host`.
- **Android client** (`apps/android`) — a Compose shell hosting the existing web UI, with QR pairing, an encrypted token vault, and a foreground service that keeps the approval window alive while the screen is off. Not distributed yet: build it yourself with `./gradlew assembleDebug`. See `docs/mobile-remote-setup.md`.
- Lost agent output is now visible. When you reconnect after being offline longer than the server's replay buffer, the transcript shows an explicit "output lost while disconnected" marker instead of silently closing over the hole.

### Changed
- **Blocking prompts now time out after 30 minutes instead of 5.** This applies everywhere, not just on mobile. A timeout is not a retry — permission prompts treat it as *deny* — and 5 minutes assumed someone sitting at the keyboard. The trade-off is that an unattended local loop can now sit blocked for 30 minutes before unwedging itself; a hung loop is visible and interruptible, a silent deny is neither.
- The web UI derives its viewport height by measurement rather than `100vh`, which is unreliable in mobile webviews.

### Fixed
- The web UI hard-coded `http://127.0.0.1:4096` for its API and event-stream calls, so serving it to any other device made that device fetch its own loopback. It now resolves the daemon from the page origin, which is what made remote access work at all.
- `freecode web` printed the pairing URL but never the QR code — three separate bugs in the terminal QR call, each failing silently.
- The Android pairing probe ran blocking network I/O on the main thread, so pairing could never succeed.
- A page loaded into a not-yet-measured webview had every `100vh` frozen at zero, rendering a fully-laid-out app inside a zero-height box: a black screen with a perfectly healthy DOM behind it.
- Several Android foreground-service defects that together meant a blocked-approval notification could never reach you: the service never actually entered the foreground, posted its escalation to a channel that cannot alert, and lacked the notification permission entirely.

## v0.18.2

### Fixed
- The `/graph` explorer hides Tag/Cluster node labels by default to avoid crowding the layout, but had no fallback — their names were undiscoverable in the UI (only visible via the raw `/api/graph` JSON), which worked against the feature's educational goal. Every node now gets a native hover tooltip (`name (kind)`) via an SVG `<title>` element, so nothing in the graph is a mystery dot anymore.

## v0.18.1

### Fixed
- `freecode memory ui-install` failed against the real published release with `EXDEV: cross-device link not permitted`. The addon was staged in `os.tmpdir()` (`/tmp`, frequently a separate filesystem from `$HOME`) before an atomic `rename()` into `~/.freecode/addons/graph-ui/` — `rename()` can't cross filesystems. Staging now happens inside the addon directory's own parent, guaranteeing the same filesystem.
- The addon-version override option was named `--version`, colliding with yargs' built-in `-v`/`--version` flag and emitting a runtime warning on every install. Renamed to `--addon-version`.

## v0.18.0

### Added
- **`/graph` — a local browser UI for the memory knowledge graph.** Renders your project's memory graph (tags, wikilinks, clusters) as a force-directed diagram, with a live search box that runs the real cascade retrieval pipeline and highlights which memories it would surface for a prompt, with per-hop decayed scores — an educational, read-only view into the same retrieval every real turn already uses. Distributed as an optional addon rather than baked into the binary: `freecode memory ui-install` downloads it (~280 KB, sha256-verified against the release), `freecode memory ui-uninstall` removes it. See `docs/superpowers/specs/2026-08-04-memory-graph-explorer-design.md`.

## v0.17.3

### Fixed
- macOS: the installer only cleared the Gatekeeper quarantine flag on the `freecode` binary itself, not on the onnxruntime `.dylib` shipped alongside it since v0.17.2 — the memory graph embedder could still be blocked from loading its dependency. `install.sh` now clears quarantine recursively over the whole extracted install directory. (Not verified on real macOS hardware — this repo's dev/verification happened on Linux; flagging that honestly.)

## v0.17.2

### Fixed
- **v0.17.1's embedder fix was broken by the release pipeline itself.** All five cross-compiled targets built into one shared flat `out/` directory, so each target's same-named onnxruntime shared libs (e.g. every Linux arch producing `libonnxruntime.so.1`) silently overwrote the previous target's copy — only the last-built architecture's library actually made it into the release, and `install.sh`/`install.ps1` never downloaded those sidecar files at all regardless, since they only ever fetched the bare binary. Each release target now builds into its own staging directory and is packaged as a single `.tar.gz` (`.zip` on Windows) containing the binary and its onnxruntime libs together; the installers now download and extract that archive instead of a bare binary. Verified against the real archive → extract → run path.

## v0.17.1

### Fixed
- **Memory knowledge graph embeddings never actually worked in the distributed binary.** `bun build --compile` embeds the memory graph's onnxruntime native addon but not the shared library it `dlopen()`s at runtime (`libonnxruntime.so.1` / `.dylib`), so every released `freecode` binary silently fell back to keyword-only retrieval instead of real vector search — the graph's tags/wikilinks/clusters worked, but semantic similarity never did. `build-bun.mjs` now ships that shared library as a loose file next to the compiled binary, and the binary re-execs itself once at startup with `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH` pointed at it (the dynamic linker only reads that variable at process start, so it can't be set lazily once the embedder needs it). Windows and dev/tsx runs are unaffected and need no change.

## v0.17.0

### Fixed
- `grep` had no default result cap — an unbounded pattern in a large repo returned every ripgrep match straight into context. Now defaults to `--max-count=100` per file unless the model passes an explicit `head_limit`.
- `glob` had no result cap at all — a broad pattern (e.g. `**/*.ts`) on a large tree could flood context with thousands of paths. Now caps output at 200 entries with a truncation notice, matching the pattern already used by `ls`.
- **Memory knowledge graph: tags written in YAML-array syntax (`tags: [editor]`, `tags: [tooling, package-manager]`) produced malformed tag nodes.** The frontmatter parser only split on commas without stripping brackets, so `[editor]` became the literal tag `"[editor]"`, and a multi-item bracketed list split into fragments each keeping a stray `[` or `]` (`"[tooling"`, `"package-manager]"`). Tags now parse correctly whether written as `tags: a, b` or `tags: [a, b]`, so every user who wrote tags in bracket syntax will get correctly-tagged graph nodes and `HasTag` edges once they update.

## v0.16.0

### Fixed
- **Long tasks no longer stop early with `oscillation_detected`.** The loop-health oscillation heuristic scored repeated edits to the same file *path* rather than actual edit/revert cycles, and its score was a session-lifetime accumulator with no decay — every edit past the third to a given file added a point, so the tenth edit to a single file reached the hard-stop threshold. That is routine for any multi-file feature, and a run doing real work would be killed mid-task. The detector now scores genuine reverts: an edit is a content transition (`oldString` → `newString`), and only an edit that inverts an earlier one on the same file counts. Both sides are hashed and the search window is bounded, so nothing large is retained. Steady forward progress on one file no longer scores at all, while a real edit/revert/edit cycle still escalates and stops the loop.
- Loop-health state is reset per run. The `AgentLoop` instance is reused across turns, so the accumulated oscillation score used to carry into the next prompt — once a session tripped the threshold, every later prompt in it stopped at the health check before ever reaching the provider.
- Token usage is now reported on every loop exit path. Abnormal stops (loop health, max iterations, interrupt) discarded the accumulated totals, so a run that had spent minutes of real work displayed as `↓0 ↑0`.
- Repaired a `.gitignore` entry that had been corrupted by a missing trailing newline: appending a new pattern fused it onto the previous line, which silently dropped the `bench/jcode-bench/target` rule and exposed hundreds of build artifacts as untracked.

## v0.15.0

### Added
- Prompt history persistence: previously typed prompts are now saved per-project and recallable with the up-arrow, mirroring shell history.
- `/theme` slash command with a token-based theme system (default / solarized-dark / monokai), applied through a chalk/pi-tui apply layer and persisted to `~/.freecode/config.json` with hot-reload.
- `lastAgentMode` is now persisted in config, so the TUI reopens in the agent mode it was last left in instead of always defaulting to build.

### Changed
- The question flow now renders as a centered `QuestionModal` overlay instead of the old inline question picker, matching the permission-picker's presentation.
- The in-progress status line's `↓` (input token) counter now grows live during multi-tool-call turns instead of sitting flat at the initial estimate until the turn finishes — each tool result bumps it by its own size (~4 chars/token), corrected by the real usage once the turn completes.

### Fixed
- The `ModeLine` no longer flashes the wrong agent mode on startup before config has loaded (`modeLoaded` gate).

## v0.14.0

### Changed
- **MCP tools now respect the permission system.** `toolKind()` classified every `mcp__*` tool as read-only, contradicting the doc comment directly above it, so MCP tools skipped the permission prompt entirely in build mode and were waved through `plan`/`review`/`explore` by `modeEnforcement`. An MCP server is arbitrary third-party code, so they now fail closed: a tool is treated as read-only only when its server declares `readOnlyHint: true` in its annotations, which `convertMcpTool` previously discarded. Read-only tools (search, fetch, list) behave as before; anything unannotated prompts on first use in build mode. The escape hatch is a server-level allow rule — `mcp__linear` covers every tool that server exposes. Read-only claims are cleared when a server disconnects, so a later server reusing a tool name can't inherit the exemption.

### Added
- Uncaught exceptions and unhandled rejections are now handled. Previously Node's default handler painted the stack into the alt screen, which was then wiped on restore — the TUI vanished with no explanation and the spawned core backend was left for the OS to reap. The handler restores the terminal first so the report survives, stops the backend, prints the trace, and points at `freecode --resume <id>` since the session is already persisted.
- The core backend is respawned when it dies, with bounded retries (3, backing off 250ms/1s/3s) so a backend that can't start reports it instead of fork-bombing. A process that stayed up more than a minute refreshes the budget rather than spending one accumulated over a long session. Because core keeps its session map in memory, a respawned backend has never heard of the session still on screen, so the frontend re-resumes it server-side — without reloading messages, which would duplicate the visible history.
- API keys are masked at the prompt. They were typed into a plain input and sat on screen in clear text; the alt screen keeps them out of shell scrollback but not out of screenshots, recordings, screen sharing or `tmux capture-pane`.
- CI on every push and pull request (lint, typecheck, build, test). The only workflow was `release.yml`, which fires on a `v*` tag and goes straight to `bun --compile` — nothing ran tests, types or lint before a release shipped.
- MIT `LICENSE` files. Three published packages declared `"license": "MIT"` with no LICENSE anywhere in the repo.

### Fixed
- Bash tool output was never displayed. `isFileRead` had gained `"bash"`, which suppressed the entire result branch, so every command rendered as a bare `● Run(ls)` header with no output and not even the `(no output)` fallback.
- A core crash left the TUI frozen forever. In-flight JSON-RPC calls were never rejected and there was no request timeout, so callers waited indefinitely with no way back short of quitting. Calls are now rejected on backend death and carry a deadline. `session.send` uses an idle deadline reset by each stream event rather than a flat one, since it settles only when the whole turn is done — a total timeout would kill any turn longer than it.
- The core exit/error handlers wrote through `console.log`/`console.error`, injecting raw text into the alt-screen frame and corrupting the differential renderer that `render-guard.ts` exists to protect.
- Message history grew without bound. `messageStore` was constructed with no options, so its `maxMessages` cap never applied and every message — each holding its component and full tool-result strings — was retained for the life of the process. This is the growth behind long-session degradation.
- MCP tool calls could be silently re-run. `behavior.isDestructive` was hardcoded `false`, and both retry paths (`tools/orchestrator.ts`, `agent/recovery/manager.ts`) read that as "safe to retry" — so a transient failure could re-issue a mutation and create the same issue twice. It now derives from `readOnlyHint`.
- The npm package was 93.1 MB packed / 247.6 MB unpacked across 147 files. npm resolves ignore files from the package directory and `apps/tui` has no `.gitignore`, so nothing was excluded — the tarball carried the compiled `dist/freecode` and `dist/freecode-bun` binaries the GitHub release already distributes, all of `src/`, and leftover Next.js config. A `files` allowlist brings it to 76.1 kB / 266.9 kB across 59 files.
- Test suites are green and actually run. `apps/tui` declared no `lint`/`check-types`/`test` scripts, so turbo skipped it entirely; `session/manager.test.ts` and `session/store.test.ts` imported from `vitest`, which isn't a dependency, so 27 tests had never once executed; and two interruption tests in `runtime.test.ts` slept a fixed 50/200ms hoping the loop had reached the provider, which failed under parallel load.

### Removed
- The 4.7 MB commercial music track bundled in `apps/tui/src/assets/`, redistributed under a license we have no standing to grant over someone else's recording. Nothing was lost: `playSound()` had no callers, and `tsc` never copied the `.mp3` into `dist`, so the feature could only ever have run under `tsx src/`.

## v0.13.0

### Added
- Claude Code tab in `/resume`. The session picker now has two tabs — Freecode and Claude Code — switched with `←` / `→` (or `h` / `l`). Core scans `$CLAUDE_CONFIG_DIR` (defaults to `~/.claude`, matching upstream Claude Code), merges `sessions-index.json` with a jsonl fallback, and returns a `ClaudeSessionMeta[]` for the list. The preview pane renders the full transcript as markdown via the new `session.claudeTranscript` IPC method. The tab is read-only for this iteration — Enter on the Claude Code tab shows a "coming soon" message and the modal stays open; the actual import-and-resume flow is a follow-up.

## v0.9.1

### Fixed
- Bash tool could hang forever on any command that left descendants running (`npm test` / `pnpm test` → test runner → workers). The tool resolved only on the child's `close` event, which fires once every stdio pipe is closed — a surviving grandchild still holds the write end, so `close` never arrived and the turn spun indefinitely. This also made the v0.8.2 timeout-as-failure fix unreachable in practice, since that code ran inside the `close` handler. The shell now starts in its own process group (`detached`) and the timeout signals the whole group, so descendants go down with it; the result also settles shortly after `exit` as a fallback if `close` never fires. Timed-out runs no longer strand orphaned processes.
- Project tree watcher (`context/tree-watcher.ts`) started chokidar with `persistent: true` and nothing ever called `stopWatching`, so the watcher handle kept the event loop alive. Any short-lived process that ran a turn hung instead of exiting — most visibly the core test suite, which passed every assertion and then never terminated. Now `persistent: false`; the server is held open by its stdio anyway and change events still fire.

## v0.9.0

### Added
- Docs command with user command examples

## v0.8.2

### Fixed
- Bash tool could hang indefinitely on commands that blocked reading stdin (interactive prompts, `read`, `git push` over HTTPS, `sudo`, `apt`) — the child got a pipe that no one wrote to, so the configured timeout was the only escape. The child now starts with stdin attached to `/dev/null` and the prompt-blocking env vars (`GIT_TERMINAL_PROMPT=0`, `DEBIAN_FRONTEND=noninteractive`) are set, so such commands exit cleanly instead. The SIGKILL escalation timer is now also cleared on `close`/`error`, and a timeout is reported as `success: false, code: "TIMEOUT_<ms>"` so the loop doesn't conclude the command ran successfully.

## v0.8.1

### Fixed
- Tool calls truncated by the output-token cap (notably MiniMax's previous 4096 default) were stored in session history as a raw JSON string, which providers then rejected as `tool_use.input: Input should be a valid dictionary` — bricking the session on every subsequent request. The streaming normalizer now rejects malformed tool-call inputs with an actionable error instead of letting them into history, and the request-layer conversion sends `{}` for any pre-existing poison in loaded history.
- MiniMax provider default `maxOutputTokens` raised from 4096 to 65536 (the endpoint's own ceiling is 524288 on M3 / 196608 on M2). Larger `write` and `edit` calls no longer cut off mid-JSON.

## v0.8.0

### Added
- Syntax highlighting in `ToolResultMessage` rendering, with extended file-read detection

### Changed
- Consistent duration formatting (`formatDuration`) across `freecode` command, main entry, and message components

## v0.7.1

### Added
- Hooks configuration loader (`hooks/settings.ts`): define hooks in `.freecode/settings.json` without touching source, with Claude Code nested-shape compatibility
- `FREECODE_DEBUG` env var gates debug-level logger output
- Syntax highlighting in TUI diff rendering; mention highlighting in prompt editor

### Changed
- Replaced ad-hoc `console.warn` calls across core with the shared logger for consistent log handling

## v0.7.0

### Added
- Memory Graph Service with vector store, knowledge graph builder, and cascade retrieval
- Memory Graph CLI commands (`memory graph stats|rebuild`)
- Context Engine with tree-cache and collection strategies
- Secret filter for memory embeddings
- Deterministic k-means clustering for memory
- Embedder support (local ONNX/fastembed, optional dependency)

### Fixed
- Improved permission profiles and mode policies
- Enhanced MCP client transport and tool conversion
- Better session management with fork and archive support

### Changed
- Updated provider registry with MiniMax support
- Improved agent loop with loop-health monitoring
- Enhanced rollout/event sourcing with replay capabilities

### Infrastructure
- Effect runtime with Layer DI system
- Updated Vercel AI SDK to latest
- Improved SQLite thread store
