# Quality Benchmark Plan — Track B

> **Date:** 2026-07-13
> **Status:** Proposed
> **Scope:** implementation-grade plan for the three quality-axis suites from [optimisation.md](./optimisation.md) §5.2.2 / Phase 8 — custom micro-bench, Terminal-Bench 2.1, SWE-bench-verified subset — plus the §5.3 internal per-commit metrics.
> **Prereqs:** Phases 1-7 landed (parallel tools, streaming, DI, recovery, caching, SEA/Bun binaries). Axis A is done; this doc is Axis B.

---

## TL;DR

Track A made FreeCode fast. Nothing in this repo yet measures whether it **finishes tasks correctly** — the axis the "world's best" claim is settled on. Ship, in order:

1. **M1 — Headless run harness** (1-2 days): drive the core over JSON-RPC in a sandboxed workspace. Everything else builds on this.
2. **M2 — Custom uncontaminated micro-bench, 5 tasks** (2-3 days): `pnpm bench:quality`, continuous scoring, seed-parameterized so it stays uncontaminated even after the repo is public.
3. **M3 — Results pipeline** (0.5 day): JSON out + `Benchmark.md` "Task Quality" section.
4. **M4 — Internal per-commit metrics** (1 day): first-token latency, turn latency, tools/turn, tokens-per-edit from real runs.
5. **M5 — Terminal-Bench 2.1** (5-7 days): the number that goes head-to-head with jcode's 92%.
6. **M6 — SWE-bench-verified subset** (7-10 days): n=50, official evaluation harness.

**What benchmarks do and don't do:** they *measure*; they don't *improve*. The value is (a) an honest scoreboard, (b) regression detection per commit, and (c) a ranked list of failure modes to fix. Expect the first runs to be humbling — that's the point.

---

## 1. Ground truth — how to drive FreeCode headlessly

Facts from the source that constrain every suite:

| Fact | Source | Consequence for the harness |
| --- | --- | --- |
| Core speaks JSON-RPC over stdin/stdout: `session.start` → `session.send` → `LoopResult { success, content, turnCount, usage }` | `apps/core/src/server.ts` | No TUI needed. Spawn `node apps/core/dist/server.js` per task. |
| Tools execute with `cwd: process.cwd()` **of the server process** | `agent/loop.ts` (`executeTool` context), `server.ts` (`tools.call`) | Spawn the server with `cwd` = the task workspace. One server per task = full isolation. |
| Provider/model come from `~/.freecode/config.json` `current`, fallback to session provider | `server.ts` `session.send` | Harness must pin provider/model explicitly per run and record them in results. |
| `question` tool blocks on a Bus answer with a **5-minute timeout** | `bus/index.ts:251` | A benched agent that asks a question burns 5 min of its budget. Bench system-prompt suffix forbids questions; harness also enforces its own hard timeout via `session.stop` (which aborts in-flight work since Phase 3) + SIGKILL. |
| `agentMode: "danger"` bypasses permission prompts; `"build"` may hit PermissionRequest hooks | `agent/loop.ts` `executeTool` | Bench runs use `danger` inside the sandbox (tasks own their throwaway workspace); record the mode in results. |
| Streaming events (`text_delta`, `tool_start`, ...) are written to stdout interleaved with JSON-RPC responses | `server.ts` `emitEvent` | Harness gets first-token latency and tool counts for free by timestamping events. |
| RecoveryManager retries 429/5xx and can fall back providers | Phase 4 | Benchmarks tolerate rate limits without dying; record retry counts so runs are comparable. |

**Nondeterminism:** LLM sampling makes single runs meaningless. Every suite reports **median of N trials** (default N=3) plus per-trial raw data. Never publish an n=1 number.

**Cost:** each micro-bench task ≈ 1 session of 2-10 turns. A full 5-task × 3-trial run ≈ 15 sessions. Budget guard: harness records tokens per run and refuses to start if a `--max-total-tokens` ceiling would be exceeded.

---

## 2. M1 — Headless run harness

**Files:** `apps/core/benchmarks/harness/run-task.ts` (new), `apps/core/benchmarks/harness/types.ts` (new)

The one primitive every suite shares:

```ts
interface TaskRun {
  workspace: string;        // temp dir seeded with task files
  prompt: string;
  provider: string;         // pinned, recorded
  model?: string;
  timeoutMs: number;        // hard wall — session.stop + SIGKILL
}

interface TaskRunResult {
  success: boolean;         // LoopResult.success
  content: string;
  turnCount: number;
  usage: { inputTokens: number; outputTokens: number };
  wallMs: number;
  firstEventMs: number;     // first text_delta/tool_start after send
  toolCalls: number;        // counted from tool_start events
  timedOut: boolean;
}
```

Implementation: spawn `node apps/core/dist/server.js` with `cwd: workspace`; write `session.start` + `session.send`; parse the stdout line stream (JSON-RPC responses + stream events — same framing the TUI's `ipc/client.ts` already parses); enforce `timeoutMs` with `session.stop` then SIGKILL after a 5 s grace.

**Success:** a `run-task.ts` unit test drives a trivial prompt against a fake provider (registered via the Phase 3 test-layer pattern) end-to-end without network.

---

## 3. M2 — Custom uncontaminated micro-bench (`pnpm bench:quality`)

**Files:** `apps/core/benchmarks/micro/<task>/spec.md`, `apps/core/benchmarks/micro/<task>/verify.ts`, `apps/core/benchmarks/micro/<task>/baseline.ts`, `scripts/bench_quality.ts`

### 3.1 Anti-contamination design (the part jcode got right)

jcode's insight: published benchmarks leak into training data; small, novel, *exhaustively verifiable* tasks with *continuous* scoring can't be gamed. Copying jcode's tasks (`float-print`, `json-unescape`, `utf16-transcode`) would defeat the purpose — they're published, therefore contaminated for us.

**Our twist — seed parameterization:** every task spec embeds constants (alphabets, polynomials, framing bytes, carry rules) derived from a seed in `benchmarks/micro/seed.json`. Regenerating the seed regenerates the specs and the verifiers together. Even after this repo is public, bump the seed and the tasks are novel again. This is the mechanism that keeps the suite honest long-term.

### 3.2 The five tasks

Small enough to verify exhaustively, deep enough to have an optimization gradient:

| Task | What the agent must build | Correctness verification | Continuous score |
| --- | --- | --- | --- |
| `varint-zigzag` | Streaming decoder for a custom varint framing with zigzag ints + seed-chosen checksum | Exhaustive over all 16-bit values + 10k seeded random frames | Decoded MB/s vs `baseline.ts` |
| `base-n-codec` | Round-trip encoder/decoder for a seed-chosen 37-char alphabet with custom padding | Exhaustive round-trip over all 3-byte inputs | Encoded MB/s vs baseline |
| `rle-escape` | Parser for run-length encoding with seed-chosen escape/sentinel bytes | Exhaustive over all 2-byte sequences + adversarial fixtures | Throughput vs baseline |
| `duration-format` | Humanizer with exact seed-chosen carry/rounding rules (spec reads like an RFC) | Exhaustive over 0..10M seconds | Output-exactness is the gate; score = code size (smaller = better, ties broken by speed) |
| `bitpack-bloom` | Bloom filter with specified hash mixing and bit order | Determinism check: exact bit-image match against verifier for 1k seeded inserts | Queries/s vs baseline |

Scoring per task: **correctness is a gate** (any verifier failure → 0). Passing solutions get `score = log2(candidate_perf / baseline_perf)` — jcode-style continuous scoring where +1.0 means "2× the reference implementation". Suite score = sum across tasks, reported per-trial and as median.

### 3.3 Runner

`scripts/bench_quality.ts` (run with `tsx`; add root script `"bench:quality"`):

1. For each task × trial: seed a temp workspace with `spec.md` (the agent's only input: *"Read spec.md and implement solution.ts to satisfy it"*), run via M1 harness, then execute `verify.ts` against the produced `solution.ts` in a `node:test` subprocess with its own timeout.
2. Output: `benchmarks/results/quality-<date>.json` — per task: pass/fail, score, wall time, turns, tokens, retries.
3. `--tasks`, `--trials`, `--provider`, `--max-total-tokens` flags.

**Success criteria:**
- `pnpm bench:quality --tasks varint-zigzag --trials 1` completes end-to-end against the configured provider and produces a scored JSON result.
- All five `verify.ts` files pass against their own `baseline.ts` (the reference implementation must score exactly 0.0 by construction).
- A deliberately-broken solution scores 0 (gate works).

---

## 4. M3 — Results pipeline into Benchmark.md

Add a **"Task quality"** section *above* "Latest results" in `Benchmark.md` (per optimisation.md §5.5): micro-bench table (task, median score, pass rate, median turns/tokens), with provider+model+seed+date on every row. No number goes in the table without N≥3 and the raw JSON checked into `benchmarks/results/`.

---

## 5. M4 — Internal per-commit metrics (optimisation.md §5.3)

**Files:** `apps/core/src/agent/metrics.ts` (new, ~60 LOC), `scripts/bench_internal.py` (new)

The loop already knows everything §5.3 asks for — it just doesn't persist it. Emit one JSONL line per turn to `~/.freecode/metrics/turns.jsonl`: `{ sessionId, turn, firstTokenMs, turnMs, toolCalls, parallelBatches, inputTokens, outputTokens, retries, provider, model }`. Hook points: `sendToProvider` (first chunk timestamp — already streaming), `executeTurn` (wall + tool counts), RecoveryManager `onRetry`.

`scripts/bench_internal.py` prints p50/p95 per metric for the last N sessions. The 429-survival metric already has a harness: the Phase 4 recovery tests.

**Success:** after one real TUI session, `python3 scripts/bench_internal.py` prints a sane table.

---

## 6. M5 — Terminal-Bench 2.1

**Files:** `scripts/bench_terminal.py` (new), `benchmarks/terminal-bench/agent-adapter/` (new)

- Use the **official harness** (`terminal-bench` on PyPI; tasks run in Docker, agent gets a tmux session, 15-min cutoff). Never reimplement the runner — comparability is the whole point.
- Write a FreeCode agent adapter using the harness's custom-agent interface: it installs the **Bun binary + bundled core** into the task container and drives it with the task instruction as the prompt in `danger` mode. This is the forcing function for making the compiled binaries standalone (core must ship next to the TUI binary — currently they spawn `apps/core/dist/server.js` from the repo).
- Report **both** jcode metrics: finished-in-time pass rate and 15-min-cutoff pass rate. Start with a 10-task smoke subset before paying for the full n=75.
- Targets (from §5.4): 88% first, then 92%+ to match jcode.

**Risks:** Docker required; a full run costs real provider tokens (budget flag mandatory); expect the first run to expose interactive-tool failures (the question-tool rule from §1) and long-horizon compaction issues — that's the actionable output.

---

## 7. M6 — SWE-bench-verified subset

**Files:** `scripts/bench_swe.py` (new)

- n=50 verified instances, stratified by repo, fixed and recorded in `benchmarks/swe/instances.json` so reruns are comparable.
- Per instance: clone at base commit → M1 harness run with the issue text → collect the workspace `git diff` as the prediction patch.
- Evaluate with the **official** `swebench` Docker evaluation harness — never self-judge patches.
- Report: % resolved + median tokens per resolved issue. Target (§5.4): within 5% of opencode on the same subset.

---

## 8. Execution order

1. **M1** headless harness (1-2 days) → unit-tested against a fake provider.
2. **M2** micro-bench, tasks in this order: `varint-zigzag` first (simplest verifier), then the other four (2-3 days).
3. **M3** results pipeline (0.5 day) — publish the first honest micro-bench table.
4. **M4** internal metrics (1 day) — runs from then on double as regression data.
5. **M5** Terminal-Bench (5-7 days) — gated on making the compiled binary standalone.
6. **M6** SWE-bench subset (7-10 days).

Per optimisation.md §9: **no external #1 claim until M5 ≥ 88%.**

---

## 9. What this plan does — and does not — guarantee

Guaranteed *if implemented*: reproducible quality numbers, per-commit regression detection, and a ranked failure list (which tool errors, which turn the agent lost the plot, where compaction dropped context). Those failures are the inputs that made Phases 1-5 worth doing.

**Not guaranteed:** that the scores are good. Task success is dominated by the underlying model; the harness (your code) contributes the margin. If the first Terminal-Bench run comes back at 60%, that is the benchmark *working* — the fix list it produces (edit-tool retry messages, context selection, verification loops) is where Track B actually turns into capability.

---

## Appendix — key references

| Concern | Path |
| --- | --- |
| Headless protocol | `apps/core/src/server.ts`, `packages/shared/src/ipc/protocol.ts` |
| Question-tool timeout | `apps/core/src/bus/index.ts:251` |
| Fake-provider test pattern | `apps/core/src/effect/runtime.test.ts`, `agent/recovery/manager.test.ts` |
| Recovery/retry observability | `apps/core/src/agent/recovery/manager.ts` (`onRetry`) |
| Compiled binaries (for M5 packaging) | `scripts/build-bun.mjs`, `scripts/build-sea.mjs` |
| Strategy source | [optimisation.md](./optimisation.md) §5.2.2, §5.3, §5.4, §5.5, Phase 8 |
