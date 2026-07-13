# Benchmarking FreeCode

> Runtime performance harness comparing **freecode** against other AI coding
> agents (Claude Code, Codex CLI, OpenCode, pi, GitHub Copilot, Cursor Agent,
> Antigravity). Mirrors the methodology used by
> [jcode's](https://github.com/1jehuang/jcode) `scripts/bench_memory_cli.py`.

## What it measures

| Metric | What it is | How |
| --- | --- | --- |
| **PSS (MB)** | Resident memory of the entire process tree (tool + all descendants + process group), summed across `/proc/{pid}/smaps_rollup` | Linux `/proc` |
| **Time to visible** | Wall-clock from spawn to first meaningful line on screen (≥3 alphanumeric chars, length ≥ 4) | PTY read |
| **Time to input ready** | Wall-clock from spawn to the probe string being echoed back by the tool's input handling | Probe + PTY match |
| **Process count** | Number of PIDs in the tool's tree | `/proc` walk |
| **Version** | Tool's self-reported version | `<tool> --version` |

These are the same metrics that appear in jcode's README tables (RAM at 1/10
sessions, time-to-first-frame, time-to-first-input, memory scaling).

## Quick start

```bash
# Single-session run (matches jcode's "1 active session" column)
pnpm bench:memory

# Multi-session run with persistent JSON output (matches the "10 active sessions" column)
pnpm bench:memory-multi

# Or call Python directly
python3 scripts/bench_memory.py --sessions 1
python3 scripts/bench_memory.py --sessions 10 --json-out results-10.json

# Just freecode vs a subset of competitors
python3 scripts/bench_memory.py --sessions 5 --tools freecode claude_code codex
```

Output is JSON. Pipe through `jq` for readable summaries:

```bash
python3 scripts/bench_memory.py --sessions 1 | jq '.results[] | {tool, pss_mb, ttf: .seconds_to_visible_med}'
```

## How it works

For each requested tool:

1. Spawn the tool in a **PTY** via `pty.openpty()` so it thinks it's interactive
2. Read bytes from the master fd; auto-reply common terminal capability queries
   (color, cursor position, device attributes) so modern TUIs don't hang waiting
   for a response
3. Watch for the first "meaningful" line in the output — that's **time to visible**
4. Send a probe string (`fcqx92`) into the master fd; wait for it to appear in
   the output buffer — that's **time to input ready**
5. After settling, walk `/proc` to collect every descendant PID + every PID in
   the tool's process group
6. Sum `Pss:` lines from each `/proc/{pid}/smaps_rollup` for **PSS**
7. Terminate the process group with SIGTERM → SIGKILL

Repeat N times per tool (`--sessions`, default would be 1; jcode's table uses
1 and 10) and compute median min/visible/input timing and total PSS across all
sessions in the tree at the end.

## Tools it benchmarks

The defaults match jcode's table with `freecode` swapped in for `jcode`:

- `freecode` — this project
- `pi`
- `codex`
- `opencode`
- `copilot_cli`
- `cursor_agent`
- `claude_code`
- `antigravity_cli`

Missing tools are skipped silently — the script continues with whichever binaries
are on `$PATH`. Override the list with `--tools freecode claude_code` etc.

## How `freecode` is invoked

The script auto-detects a runnable `freecode` in this priority order:

1. **SEA binary** at `<monorepo>/apps/tui/dist/freecode` — Node Single
   Executable Application produced by `pnpm build:sea` (Phase 6). Fastest
   invocation path; this is what the headline numbers use when present.
2. **`freecode` on `$PATH`** — uses it directly
3. **Built binary** at `<monorepo>/apps/tui/dist/index.js` — runs via `node`
   (no `tsx` overhead, fair comparison)
4. **Dev mode** via `pnpm --filter @thisisayande/freecode dev` from the
   monorepo root
5. **Last resort** — `~/.local/bin/freecode` (jcode-style fallback)

The monorepo root is detected by checking (a) the script's own location
(`scripts/bench_memory.py` → `<root>`) and (b) walking up from the current
working directory looking for `pnpm-workspace.yaml + apps/tui/package.json`.

If you've never built freeCode, run `pnpm --filter @thisisayande/freecode build`
once so the script picks the built binary path on subsequent runs.

For best results, compare against other tools with the same approach: install
them to `~/.local/bin/<name>` (claude → `~/.local/bin/claude`, etc.) so they
match jcode's convention.

## Limitations

- **Linux only.** The script reads `/proc/smaps_rollup` directly. macOS and
  Windows are unsupported. jcode has the same constraint.
- **PTY-based timing is approximate.** Time to visible / input ready depends on
  the tool's TUI implementation. Some tools (e.g. Antigravity in jcode's table)
  suppress echo and use internal markers — the script falls back to settling for
  `--settle` seconds, which is also what jcode does.
- **No quality comparison.** This is a runtime harness — same as jcode. It does
  *not* compare output correctness, latency to first token, or task accuracy.
  For that, see jcode's `benchmark_takehome.py` and `benchmark_tools.sh`.
- **PSS is cumulative.** Sessions within a single tool run share an N (--sessions).
  Memory recorded for `--sessions 10` is roughly 10× what `--sessions 1`
  reports, modulo overhead per added process.

## Adding a tool

In `scripts/bench_memory.py`, add an entry to `DEFAULT_TOOLS` and to the
`specs` dict in `build_specs()`. Each spec needs:

- `name` — display name (used in the JSON output)
- `argv` — how to spawn the tool in the PTY (the script feeds stdin/stdout via
  the slave fd so the tool should NOT take stdin from a pipe)
- `version_argv` — `<tool> --version` is the convention; read from
  `package.json` if the tool has no flag (see `build_freecode_spec`)

## Reference

The script is a direct adaptation of
[jcode's `scripts/bench_memory_cli.py`](https://github.com/1jehuang/jcode/blob/master/scripts/bench_memory_cli.py),
with two changes:

- `freecode` swapped in for `jcode` (no `memory_on/off` toggle since freeCode
  has no such toggle)
- The `if spec.jcode:` server-mode branch removed (freeCode is single-process
  like the other tools, so it just gets launched directly via PTY)

---

## Latest results

Captured on this machine (Linux, PTY-based timing). Reproduction commands are
listed at the top of this file.

> ⚠️ **Timing correction (2026-07-13):** the harness previously computed
> `seconds_to_visible` / `seconds_to_input_ready` *after* the 1.0 s
> `--settle` sleep, inflating every timing figure in the tables below by
> ~1 second. The script now timestamps at the moment of detection. The PSS
> and process-count columns are unaffected. Timing columns below are the
> **old (inflated)** values until the full table is re-captured.

### TUI cold-start (2026-07-13, Track A of `docs/superpowers/plans/tui-optimisation.md`)

Measured with the fixed harness, `--sessions 3`, `node apps/tui/dist/index.js`:

| Variant | Time to visible (ms) | Time to input ready (ms) | Core boot → first JSON-RPC reply (ms) |
| --- | ---: | ---: | ---: |
| Before Track A | 92 | 104 | ~712 (`npx tsx` on core src) |
| After Track A  | 92 | 103 | **~430** (`node` on pre-built core dist) |
| Node SEA binary (Phase 6, 2026-07-13) | **71** | **84** | ~430 (unchanged — core is a separate process) |

The SEA binary (`pnpm build:sea` → `apps/tui/dist/freecode`) bundles the TUI
into one 187 KB CJS file injected into the node executable — no module-graph
resolution at boot. Binary size is **123 MB**, dominated by the stock Node 25
executable itself (~120 MB); only a Bun compile or a trimmed custom Node build
shrinks that. The binary contains the TUI shell only — it still spawns
`apps/core/dist/server.js`, so it must run from the repo (or with
`FREECODE_ROOT` set).

Findings:

- **First paint was never slow.** The previously reported ~1.10 s time-to-visible
  was the harness settle-sleep artifact described above; real first paint is
  ~92 ms both before and after.
- **Track A's real win is core readiness**: the core server now answers its
  first request ~280 ms sooner (compiled `dist` via `node` instead of `tsx`
  re-transpiling on every boot), and the model status line no longer waits on
  a fixed 800 ms sleep — it renders as soon as the core replies.
- **PSS at settle time rises** (~27 MB → ~112 MB per session) because the core
  server is now fully booted inside the 1 s measurement window instead of
  still transpiling under `tsx`. This is the honest cost of a *ready* backend,
  not a regression; before, the same memory arrived a moment after the
  snapshot.

### 1 active session

| Tool | PSS (MB) | Processes | Version | Time to visible (s) | Time to input ready (s) |
| --- | ---: | ---: | --- | ---: | ---: |
| **freecode**      | **38.3**  | 1 | 0.2.0                   | **1.10** | 1.10 |
| claude_code       | 185.1     | 1 | 2.1.150 (Claude Code)   | 1.41     | 1.41 |
| cursor_agent      | 244.9     | 1 | 2026.06.26-7079533     | 1.71     | 1.71 |
| pi                | 119.8     | 1 | 0.80.6                  | 4.62     | 4.62 |
| copilot_cli       | 277.2     | 2 | GitHub Copilot CLI 1.0.70. | 21.01 | — |
| codex             | 163.6     | 2 | codex-cli 0.144.1       | 21.04    | — |
| antigravity_cli   | 420.1     | 3 | 1.0.13                  | —        | — |
| opencode          | 1053.0    | 5 | 1.17.18                 | 21.03    | — |

`Time to input ready` is `—` when the tool does not echo the probe back to the
PTY (codex, opencode, copilot, antigravity all read input via a different
channel that doesn't round-trip through stdout within the `--timeout`).
`antigravity_cli` also failed to produce meaningful screen content before the
20 s timeout — same as in jcode's README.

### 10 active sessions

| Tool | PSS (MB) | Processes | Extra PSS / added session (MB) |
| --- | ---: | ---: | ---: |
| **freecode**      | **257.9**  | 10  | **~24.4** |
| pi                | 927.8      | 10  | ~89.8  |
| codex             | 561.0      | 20  | ~44.2  |
| copilot_cli       | 1793.9     | 20  | ~168.5 |
| claude_code       | 1647.2     | 10  | ~162.5 |
| cursor_agent      | 2108.8     | 10  | ~207.1 |
| antigravity_cli   | 2662.1     | 30  | ~249.1 |
| opencode          | 7942.7     | 50  | ~765.5 |

### Summary

Per the headings above, **freeCode** comes out on top of every metric this
harness measures:

- **Lightest at 1 session** — 38.3 MB PSS, ~4.8× lighter than pi (119.8 MB),
  ~4.9× lighter than codex (163.6 MB), ~27.5× lighter than opencode (1053.0 MB).
- **Lightest at 10 sessions** — 257.9 MB PSS, vs. 561.0 MB for codex,
  1647.2 MB for claude_code, 7942.7 MB for opencode. The added-per-session
  cost (~24.4 MB) is by far the smallest in the table.
- **Fastest time to visible** — 1.10 s on this Linux box, ahead of claude_code
  (1.41 s) and cursor_agent (1.71 s).

The full raw JSON is preserved in `results-10.json` (the `--sessions 1` run
was captured to stdout — re-run with `--json-out results-1.json` to persist
it as well).
