# jcode Benchmarks — Reference & Head-to-Head Plan

Source: `~/Projects/githubProjects/jcode` + <https://jcode.sh/bench>. This is every
benchmark jcode publishes or runs internally, with methodology and their numbers,
so FreeCode can be run through the same tests and presented as a stronger coding agent.

Two buckets: **(A) coding-agent capability benchmarks** (what matters for "best coding
agent") and **(B) internal engineering perf benchmarks** (jcode's own binary speed —
useful for parity claims, not agent intelligence).

---

## A. Coding-Agent Capability Benchmarks

### 1. jcode bench v1 — "optimization depth" (their flagship)

Their headline benchmark. Marketed as *uncontaminatable* — it measures **how much faster**
an agent can make a primitive, not pass/fail, so it never saturates.

- **Page:** <https://jcode.sh/bench>, model comparison at <https://jcode.sh/models>
- **Tasks (3):**
  - `float-print` — shortest round-trip float printing
  - `json-unescape` — JSON string unescaping
  - `utf16-transcode` — UTF-16 transcoding
- **Scoring:** `score = log2(speedup)` under a published cost model. `+1.0` = 2× faster,
  `+2.0` = 4×, `+3.0` = 8×, etc. Combined score = **geometric mean** of the 3 task scores
  (so one high-headroom task can't dominate).
- **Correctness gate:** each solution must pass full correctness verification across the
  **entire 2³² input space** — a fast-but-wrong answer scores nothing.
- **jcode vs Claude Code (float-print, Opus 4.8, high thinking):**
  - jcode: **+8.64 (398× speedup)**
  - Claude Code: **+7.17 (144× speedup)**

**Frontier model comparison (July 19, 2026 — all 18 runs passed final correctness):**

| Model            | json-unescape | float-print | utf16-transcode | Geomean   | Typical speedup |
| ---------------- | ------------- | ----------- | --------------- | --------- | --------------- |
| Claude Fable 5   | +2.83         | +12.01      | +2.55           | **+4.43** | **21.5×**       |
| GPT-5.6 Sol      | +2.29         | +7.81       | +2.11           | +3.35     | 10.2×           |
| Claude Opus 4.8  | +2.00         | +7.18       | +2.11           | +3.12     | 8.7×            |
| GPT-5.5          | +1.98         | +7.20       | +1.34           | +2.68     | 6.4×            |
| GPT-5.4          | +1.57         | +7.03       | +1.03           | +2.25     | 4.8×            |
| Claude Sonnet 5  | +1.22         | +6.82       | +1.24           | +2.17     | 4.5×            |

**To beat them:** run FreeCode (same model, e.g. Opus 4.8) on the 3 tasks, verify full
2³² correctness, report `log2(speedup)` per task + geomean. A higher geomean than their
+3.12 (Opus) or +4.43 (Fable) row is the headline win.

---

### 2. Terminal-Bench 2.0 / 2.1

Standard, external agentic benchmark (real terminal tasks in containers) run via **Harbor**.

- **Docs:** `jcode/docs/TERMINAL_BENCH.md`; scripts `run_terminal_bench_harbor.sh`,
  `run_terminal_bench_campaign.py`, `run_terminal_bench_claude.sh`,
  `audit_terminal_bench_submission.py`.
- **Their config:** `gpt-5.4`, high reasoning effort, priority service tier; fresh
  isolated `JCODE_HOME` per trial for fairness.
- **Validated pilot tasks:** `regex-log`, `largest-eigenval`, `cancel-async-tasks` — all
  passed in-container with verifier reward **1.0**.
- **Terminal-Bench 2.1 (Opus 4.8, "confidence stepping"):**
  - Before: 242/275 trials finished in time (**88%** pass); 50/118 cut off at 15 min (42%)
  - After: 205/222 finished (**92%** pass); 103/220 cut off (47%)
  - Hill-climbability audit over 2,012 submissions: mean **91.29**, median 90, 18% below the 90-point gate.

**To beat them:** run FreeCode through Terminal-Bench 2.x via Harbor with a matching agent
adapter; report finished/pass rate and per-task verifier reward. This is the most
credible external number to publish (it's an industry-recognized benchmark).

---

### 3. Anthropic Performance Take-Home (single agent vs swarm)

A VLIW SIMD kernel optimization challenge — jcode uses it to show multi-agent ("swarm")
coordination beating a single agent.

- **Scripts:** `benchmark_takehome.py`, `benchmark_swarm.py`
- **Metric:** kernel runtime vs a **baseline of 147734** (lower = better); timed trials
  (default 10-min timeout), single-agent vs swarm.

**To beat them:** run FreeCode single-agent (and its subagent/parallel mode) on the same
kernel, report improvement over baseline and single-vs-swarm delta.

---

## B. Internal Engineering / Perf Benchmarks (binary speed, not agent IQ)

Useful only for "our tool is as fast / faster" parity claims. Reproduce with FreeCode's
equivalents where they exist.

| Benchmark            | jcode script                          | Measures                                  |
| -------------------- | ------------------------------------- | ----------------------------------------- |
| Startup time         | `bench_startup.py`, `bench_startup_visible_ready.py` | cold client startup (ms, isolated HOME)   |
| Tool-call latency    | `benchmark_tools.sh`                  | per-tool exec time (CSV, N iterations)    |
| Compile time         | `bench_compile.sh`                    | cold/warm cargo check/build/release       |
| Self-dev build       | `bench_selfdev_build.sh`, `bench_selfdev_checkpoints.sh` | incremental dev build timing              |
| Memory footprint     | `bench_memory_cli.py`, `docs/MEMORY_BUDGET.md` | memory usage/budget                       |

FreeCode already has a token/tool-output benchmark (`benchmark` scripts, recent commit
`485a865`) — line that up against jcode's `benchmark_tools.sh` for a tool-efficiency story.

---

## C. Not coding-capability (jcode marketplace features — skip for "best agent" claim)

These exist in the repo but measure jcode's discovery/attribution product, **not** coding
ability. Listed for completeness; don't use them in a coding-agent comparison.

- **Attribution benchmark** — `benchmark_attribution.py`, `docs/ATTRIBUTION_BENCHMARK.md`
- **Discovery benchmark** — `benchmark_discovery.py`, `docs/DISCOVERY_BENCHMARK.md`

---

## Suggested presentation order for FreeCode

1. **Terminal-Bench 2.x pass rate** — external, credible, apples-to-apples.
2. **jcode bench v1 geomean** (same model) — directly rebuts their headline number.
3. **Take-home kernel speedup** — shows optimization + multi-agent strength.
4. **Tool-call latency / startup** — "and we're just as fast."

For every claim: same model, same reasoning effort, published transcripts + graders, full
correctness verification. jcode's whole pitch is "no hidden test sets" — match that or the
comparison won't land.
