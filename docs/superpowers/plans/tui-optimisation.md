# TUI Optimisation Plan

> **Date:** 2026-07-13
> **Status:** Track A implemented ✅ (2026-07-13) — see §3.6 for measured outcome
> **Scope:** `apps/tui/` — cold-start latency, runtime memory, and rendering perf. Complements the broader agent-loop roadmap in [optimisation.md](./optimisation.md).

---

## TL;DR

The TUI's dominant cold-start cost is **not pi-tui itself** — it's your own top-level `sleep(800)`, eager third-party imports, and a `tsx`-transpiled server spawn. Fix those first (~1-2 days, ~4× speedup) before touching pi-tui.

**Recommended sequence:**

1. ✅ **Track A — Kill self-inflicted latency** (1-2 days) → done 2026-07-13. **Note:** the "~1,100 ms cold start" premise turned out to be a bench-harness artifact (see §3.6); real first paint was ~92 ms all along. Track A's actual win: core server answers ~280 ms sooner + model status is event-driven (no 800 ms timer).
2. **Track B — Trim + lazy-load pi-tui surface** (2-3 days) → further ~20-40 ms + smaller memory footprint
3. **Track C — Replace pi-tui with custom micro-framework** (2-3 weeks) → only if benchmarks still lag jcode meaningfully after Tracks A + B. Saves at most ~50 ms; huge cost.
4. **Track D — Node SEA / Bun compile** (phase 6/7 in [optimisation.md](./optimisation.md)) — orthogonal, stackable win.

**Do not** rewrite pi-tui first. It's the wrong lever.

---

## 1. Audit summary (facts from the source)

### 1.1 pi-tui surface actually used (`apps/tui/src/`)

**Runtime classes/functions imported:** `TUI`, `ProcessTerminal`, `Editor`, `Text`, `Spacer`, `Box`, `Markdown`, `SelectList`, `CombinedAutocompleteProvider`, `matchesKey`, `Key`, `truncateToWidth` — **10 runtime symbols + 1 helper.**

**Never used but pulled in via barrel import:** `Input`, `TruncatedText`, `Loader`, `SettingsList`, `Container`, `Image`, `Focusable`, `visibleWidth`, `wrapTextWithAnsi`, `CURSOR_MARKER`, `CancellableLoader`, all overlay APIs.

**Types-only (no runtime cost):** `Component`, `SelectItem`, `SelectListTheme`, `EditorTheme`, `MarkdownTheme`, `AutocompleteItem`, `SlashCommand`.

### 1.2 Cold-boot path — `apps/tui/src/index.ts`

The self-inflicted latency, in order of execution before first paint:

| # | Location | Cost | Notes |
| - | -------- | ---- | ----- |
| 1 | `index.ts:2-60` — top-level ESM imports | Module load | pi-tui bundle + `chalk` + `themes` |
| 2 | `commands/built-in.ts:3` | Module load | Static top-level `@thisisayande/terminal-heatmap` — loaded even when `/usage` is never invoked |
| 3 | `themes.ts:8-60` | ~1-3 ms | 15+ chalk closures constructed at module-load |
| 4 | `info-box.ts:11-17` | Module load | Logo colouring at module scope |
| 5 | `index.ts:672` — **top-level `await import("./commands/freecode/index.js")`** | Blocks first paint | Waits for `sessionSendStreaming`, `alert`, `sound` to load before `tui.start()` |
| 6 | `index.ts:649` — `loadCurrentModel()` | ✋ **`await sleep(800)`** | Fire-and-forget but blocks that path; if awaited anywhere becomes 800 ms of dead time |
| 7 | `ipc/client.ts:70` — `startCli()` | Variable | Spawns `npx tsx apps/core/src/server.ts` — **tsx re-transpiles core on every boot** |

### 1.3 Subfolder inventory

| Folder | Files | LOC | Purpose |
| ------ | ----- | --- | ------- |
| `components/` | 11 | 1,113 | Message rows, pickers, info-box, tool progress/result renderers |
| `commands/` | 5 | 423 | Slash commands + `/freecode` flow (alert/sound) |
| `state/` | 1 | 194 | Observable `MessageStore` singleton |
| `ipc/` | 1 | 329 | JSON-RPC bridge, spawns core server |
| `utils/` | 5 | 200 | Formatting helpers |
| `lib/` | 2 | 86 | logger + result helpers |
| `assets/` | 1 | 5 | ASCII logo |
| Root (`index.ts`, `themes.ts`, `models.ts`) | 3 | 752 | Entry (675) + theme closures + model list |
| **Total** | **29** | **~3,102** | |

---

## 2. Bottleneck ranking — what actually hurts

Ranked by realistic wallclock impact on cold start, worst-first:

| Rank | Bottleneck | Est. cost | Effort to fix |
| ---: | ---------- | --------: | ------------- |
| 1 | `await sleep(800)` in `loadCurrentModel()` | **~800 ms** | 30 min — replace with event-driven ready signal |
| 2 | `startCli()` spawns via `tsx` (transpiles core on every boot) | ~150-300 ms | 1 hr — spawn pre-built `apps/core/dist/server.js` via `node` |
| 3 | Top-level `await import()` at `index.ts:672` | ~30-80 ms | 30 min — move behind first-use lazy load |
| 4 | Static import of `terminal-heatmap` in `built-in.ts:3` | ~20-50 ms | 15 min — dynamic-import inside `/usage` handler |
| 5 | pi-tui barrel import (paying for 10+ unused components) | ~30-80 ms | 1-2 days — subpath imports OR fork trimmed pi-tui |
| 6 | `themes.ts` module-load work | ~1-3 ms | Not worth optimising |
| 7 | Node runtime cold start | ~150-250 ms fixed | Only fixable via SEA / Bun compile (see [optimisation.md](./optimisation.md) Phase 6/7) |

**Totals:**

- Sum of #1-#4 alone: ~1,000-1,230 ms of avoidable latency **inside your code**, not in pi-tui.
- Current measured cold-start: ~1,100 ms (`Benchmark.md`).
- Realistic target after Track A: **~250-350 ms**.
- Adding Node SEA on top (Track D): **~150-250 ms**.
- Full pi-tui replacement (Track C) saves only ~30-80 ms more.

**The framework is not the bottleneck. Your own eager work is.**

---

## 3. Track A — Kill self-inflicted latency (do this first) ✅

### 3.1 Remove `await sleep(800)` ✅

**File:** `apps/tui/src/index.ts:649` (search: `loadCurrentModel`)

The 800 ms sleep exists because the model list isn't ready when the TUI wants to render the status bar. Fix: subscribe to a `providers.ready` event from the core server, or lazy-render the model status once the first `providers.list` reply arrives. Do **not** block on a fixed timer.

**Success:** grep-verify no `sleep` remains in the TUI cold path.

> ✅ **Done.** The sleep is gone; `getCurrentModel()` now resolves whenever the
> core replies — the JSON-RPC request sits in the stdin pipe until the server
> boots, so no ready-event was needed. (Note: `loadCurrentModel()` was
> fire-and-forget, so the sleep never blocked first paint — it only delayed
> the model status line by 800 ms.)

### 3.2 Ship a pre-built core, spawn with `node`, not `tsx` ✅

**File:** `apps/tui/src/ipc/client.ts:70` (`startCli()`)

Current: `spawn("npx", ["tsx", "apps/core/src/server.ts"])` or similar → tsx re-transpiles ~20K LOC of core on every boot.

Fix:

1. Add a build step: `pnpm --filter @thisisayande/freecode-core build` produces `apps/core/dist/server.js`.
2. `startCli()` resolves that path first; falls back to `tsx` only when dist doesn't exist (dev-mode).
3. Add a check that dist is up to date (mtime > source mtime) — warn if not.

**Success:** `startCli()` spawns `node` on a compiled bundle in packaged installs.

> ✅ **Done.** `startCli()` prefers `apps/core/dist/server.js` via `node`, warns
> through the stderr channel when dist is older than the newest file in
> `apps/core/src`, and falls back to `npx tsx` when dist is absent. This
> required fixing ~100 extensionless relative imports across 42 core files
> (`./factory` → `./factory.js`) — `tsx` tolerates them but Node ESM refuses
> to run the compiled output. Measured: core boot → first JSON-RPC reply
> dropped ~712 ms → ~430 ms.

### 3.3 Remove the top-level `await import()` ✅

**File:** `apps/tui/src/index.ts:672`

Move `await import("./commands/freecode/index.js")` into first-use lazy load inside the `/freecode` command handler. The entry module no longer blocks.

**Success:** first paint no longer waits for the freecode command module.

> ✅ **Done.** The module is now lazy-loaded on first `/freecode` invocation and
> the `stopSound` exit hook is wired through a nullable ref. Bonus fix: the
> lazy path also calls `registerFreecodeCommand()`, which was **never called
> anywhere before** — `/freecode` was silently unregistered.

### 3.4 Lazy-load `terminal-heatmap` ✅

**File:** `apps/tui/src/commands/built-in.ts:3`

Change:

```ts
import { renderHeatmap } from "@thisisayande/terminal-heatmap";
```

to:

```ts
// Inside the /usage handler only:
const { renderHeatmap } = await import("@thisisayande/terminal-heatmap");
```

**Success:** `terminal-heatmap` isn't in the module graph until `/usage` runs.

> ✅ **Done.** Dynamic `import()` inside the `/usage` handler (the symbol is
> `startInteractiveHeatmap`, not `renderHeatmap` as originally written above).

### 3.5 Cold-start bench before/after ✅

Run `pnpm bench:memory` before Track A, note `Time to visible`. Repeat after each of §3.1–§3.4. Update `Benchmark.md` with the new number.

**Expected result after Track A:** ~1,100 ms → **~250-350 ms**. This closes most of the gap with `pi` (596 ms) and `Codex CLI` (882 ms). Still ~10-20× behind jcode's 14 ms — that gap requires SEA or a native binary (Track D).

> ✅ **Done — but the premise was wrong; see §3.6.**

### 3.6 Measured outcome (2026-07-13) ✅

Benching before/after exposed a bug in `scripts/bench_memory.py`: it computed
`seconds_to_visible` **after** the 1.0 s `--settle` sleep, so every number it
ever reported was inflated by ~1 s. The "~1,100 ms cold start" this plan was
built on was ~92 ms of real first paint + ~1,000 ms of harness sleep. The
harness now timestamps at the moment of detection (fixed in this pass).

Honest numbers with the fixed harness (`--sessions 3`, built TUI via `node`):

| Metric | Before Track A | After Track A |
| --- | ---: | ---: |
| Time to first visible content | 92 ms | 92 ms |
| Time to input ready | 104 ms | 103 ms |
| Core boot → first JSON-RPC reply | ~712 ms (`npx tsx`) | **~430 ms** (`node` + dist) |
| Model status line | after fixed 800 ms sleep | as soon as core replies |

Implications for the rest of this plan:

- First paint (~92 ms) already beats `pi` and `Codex CLI`; the remaining gap
  to jcode is Node runtime boot — only Track D (SEA/Bun) moves that needle.
- Tracks B and C would shave a slice of ~92 ms, not of 1,100 ms. Their
  cost/benefit is even worse than §5.2 estimated; park both unless Track D
  lands and the benchmark story still demands more.
- The bench comparison tables in `Benchmark.md` need re-capturing for all
  tools — competitor timings carry the same +1 s inflation.

---

## 4. Track B — Trim + lazy-load pi-tui surface

Do this after Track A ships and you've captured baseline.

### 4.1 Subpath imports if pi-tui supports them

Check `node_modules/@earendil-works/pi-tui/package.json` for `exports` map. If it exposes per-component paths (e.g. `@earendil-works/pi-tui/editor`), rewrite the imports in `index.ts`, `components/*.ts` to import only what's used. Falls back to no-op if the package is bundled as one entry.

### 4.2 Fork + trim (only if §4.1 isn't available)

If pi-tui only ships as a single barrel:

1. Vendor pi-tui into `apps/tui/src/pi-tui/` (or fork under `packages/pi-tui-lite/`).
2. Delete unused surface per §1.1 (**Input, TruncatedText, Loader, SettingsList, Container, Image, Focusable, CancellableLoader, all overlay APIs**).
3. Keep: `TUI`, `ProcessTerminal`, `Editor`, `Text`, `Spacer`, `Box`, `Markdown`, `SelectList`, `CombinedAutocompleteProvider`, `matchesKey`, `Key`, `truncateToWidth`.
4. Result: 30-50% smaller pi-tui footprint, marginal cold-start improvement.

**Verdict on §4.2:** only worth the fork if you're committed long-term. Otherwise upgrades from upstream become painful.

### 4.3 Dynamic import `Markdown` for tool result rendering

`Markdown` is the heaviest pi-tui component. It's only used inside message rows (`components/message-row.ts:3`), not before first paint. Wrap the import in a lazy factory:

```ts
let MarkdownCtor: typeof import("@earendil-works/pi-tui").Markdown | null = null;
async function getMarkdown() {
  if (!MarkdownCtor) MarkdownCtor = (await import("@earendil-works/pi-tui")).Markdown;
  return MarkdownCtor;
}
```

Only meaningful if pi-tui exposes subpath exports for tree-shaking. Skip if not.

---

## 5. Track C — Custom lightweight TUI framework (LAST RESORT)

Only pursue if **Tracks A + B + D combined** don't get you within 2-3× of jcode's cold start on the same box, AND your benchmark story requires it.

### 5.1 What you'd have to reimplement

From audit §1.1, **10 runtime classes/functions**:

| Class/Function | Difficulty | LOC estimate |
| -------------- | ---------- | -----------: |
| `TUI` (root controller, diff renderer, CSI 2026 sync output) | High | 300-500 |
| `ProcessTerminal` | Low | 60-100 |
| `Editor` (multi-line, autocomplete, paste handling, IME) | **Very High** | 500-800 |
| `Text` (multi-line, padding, background) | Low | 40-80 |
| `Spacer` | Trivial | 10-20 |
| `Box` (padding, background) | Low | 30-60 |
| `Markdown` (headings, bold, code, lists, links, syntax highlight) | **Very High** | 400-700 |
| `SelectList` (nav, filter, scroll info) | Medium | 150-250 |
| `CombinedAutocompleteProvider` (slash commands + file paths) | Medium | 150-250 |
| `matchesKey` + `Key` constants | Low | 100-200 |
| `truncateToWidth` (ANSI-aware) | Low | 50-100 |
| **Total** | | **~1,800-3,000 LOC** |

### 5.2 Actual expected gain

Once Track A + B are done and `terminal-heatmap` is lazy, pi-tui is already ~40 ms of cold start. Replacing it entirely saves at most **~30-80 ms**. Compare to the ~1,000+ ms gains in Track A.

### 5.3 Reasonable scope if you go ahead

Two paths, in order of increasing ambition:

**5.3.1 Micro-framework at `packages/tui-lite/`** — write your own from scratch, ~2,000 LOC. Skip Markdown (fall back to plain text with basic ANSI); skip autocomplete overlay (use inline suggestions). Target: <15 KB gzipped.

**5.3.2 Adopt an existing lighter framework** — `@clack/prompts` for prompts, hand-rolled renderer for the rest. Faster to ship than 5.3.1.

Neither is worth doing before Tracks A + B benchmarks are in.

---

## 6. Track D — Node SEA / Bun compile

Covered in [optimisation.md §3](./optimisation.md) Phases 6 + 7. Orthogonal to this doc — stack it on top of whichever combo of A/B/C you pick.

- **Phase 6 — Node SEA:** single-file executable, cuts require overhead. ~200-400 ms floor.
- **Phase 7 — Bun compile:** native binary boot ~40-80 ms. Only path to sub-100 ms on Node/TS.

Do Phase 6 after Track A. Phase 7 only if benchmark story still requires it.

---

## 7. Rendering runtime perf (out of scope for cold start, worth logging)

Not urgent, but track once cold-start is fixed:

- **Differential render efficiency.** pi-tui claims 3-strategy diff renderer. Is `VirtualMessageList` (`components/virtual-message-list.ts`) actually virtualising, or re-rendering the full history every update? Grep for `render()` invocations in the message store subscribe path.
- **Component `invalidate()` correctness.** From `pi-tui.md`, custom components must cache and call `invalidate()` explicitly. If any of your 11 components forget to invalidate, you get stale content or spurious re-renders.
- **CSI 2026 support.** Silently skipped in older Konsole / iTerm. Confirm target terminals support synchronized output; otherwise flicker.
- **Streaming tokens per second.** Once Phase 2 client update lands (`optimisation.md` §3 Phase 2), profile `text_delta` handler throughput — if the append triggers a full re-render per token, cap append rate to <60 fps.

---

## 8. What's already good (don't touch)

- Component decomposition is clean — 11 files averaging ~100 LOC each.
- `MessageStore` is a simple observable — no unnecessary React/state library.
- IPC client is one file, tight surface.
- No global mutable state beyond the store and a couple of module-level refs.
- No React runtime — pi-tui is class-based, cheaper than Ink.

---

## 9. Execution order — what to do this week

1. ✅ **Day 1 morning:** capture baseline cold-start via `pnpm bench:memory` — record in `Benchmark.md` under a new "TUI cold-start baseline" heading.
2. ✅ **Day 1:** Track A §3.1 (kill `sleep(800)`) + §3.4 (lazy-load heatmap). Bench. **Expected: -820 ms.** *(Actual: first paint unchanged — the sleep never blocked paint, see §3.6; model status now event-driven.)*
3. ✅ **Day 2:** Track A §3.2 (pre-built core, node not tsx) + §3.3 (kill top-level await). Bench. **Expected: -180 ms.** *(Actual: core ready ~280 ms sooner.)*
4. **Day 3:** run TUI end-to-end; verify no regressions. Update `Benchmark.md` with new cold-start row **and** add jcode to the same table honestly. *(Partially done: cold-start section added to `Benchmark.md`, core smoke-tested over JSON-RPC, bench run 3×; full interactive end-to-end + re-capturing competitor rows with the fixed harness still pending.)*
5. **Week 2:** Track B if pi-tui exposes subpath exports; else park.
6. **Week 3+:** Track D (Node SEA / Bun) per [optimisation.md](./optimisation.md).
7. **Track C:** only revisit after Tracks A + B + D land and benchmark still lags.

**Do not touch pi-tui internals in Week 1.** All wins are in your own code.

---

## 10. Appendix — key file references

| Target | Path |
| ------ | ---- |
| TUI entry | `apps/tui/src/index.ts` |
| Boot-blocking sleep | `apps/tui/src/index.ts:649` (`loadCurrentModel`) |
| Top-level await import | `apps/tui/src/index.ts:672` |
| Heatmap eager import | `apps/tui/src/commands/built-in.ts:3` |
| IPC/spawn | `apps/tui/src/ipc/client.ts:70` (`startCli`) |
| Theme closures | `apps/tui/src/themes.ts:8-60` |
| pi-tui docs | `pi-tui.md` (repo root) |
| Broader roadmap | `docs/superpowers/plans/optimisation.md` |
| Bench harness | `Benchmark.md`, `scripts/bench_memory.py` |
