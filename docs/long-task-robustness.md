# Long-Task Robustness (Agent Loop Hardening)

> Status: Phase 1, Phase 2, and the Phase 3 verification subagent implemented.
> Remaining Phase 3 (auto-decomposition) deferred; server-side loop detection is N/A.
> Scope: `apps/core/src/agent/` (the agentic tool-use loop).

## Why this exists

On long, multi-step tasks the loop used to degrade in specific, reproducible
ways (observed: a ~1300s run that ended with uncompiled code and stray debug
scripts). Root causes, all verified in the code:

1. **The plan evaporated.** `todowrite` wrote to an in-memory store, but
   `getTodos()` had **zero consumers** — the list was never fed back into the
   prompt, so once it scrolled out of context (or was compacted) the model went
   blind to its own plan.
2. **Hard iteration cap of 100** killed long tasks mid-work.
3. **Blunt loop-health hard-stops** (`repeatedIdenticalThreshold: 3`,
   `oscillationScoreThreshold: 4`) terminated the session on patterns that are
   normal in real work (re-reading a file, editing one file several times).
4. **No completion discipline.** The loop declared "Done" the instant the model
   stopped emitting tool calls — no check that the work compiled, tested, or
   even matched the stated plan.

## How professional agents handle this (reference research)

Read from local copies of `opencode`, `grok-build`, and `claude-code`. The
consistent pattern: **persistent todos + system-reminder nudges + a completion
gate + a prompt-level honesty contract** — *not* a harness that hard-codes
`tsc`/`cargo build` as an automatic gate.

| Mechanism | claude-code | grok-build | opencode |
|-----------|-------------|------------|----------|
| Persistent todo list | `TodoWrite` / `TaskCreate` (first-class) | first-class todos | `session/todo.ts` |
| Todo *nudge* | `<system-reminder>` "TodoWrite hasn't been used recently…" | `todo_nudge`: nudge after 3 turns, min 5 apart | `session/reminders.ts` |
| Completion gate | verification subagent assigns PASS/FAIL before "done" | `todo_gate`: force another turn while todos pending/unbacked | overflow/step handling |
| Verify-before-done | prompt: "verify it actually works… if you can't, say so" | delegates all builds/tests/verification to a subagent | — |
| Loop detection | iteration cap + model | **server-side** `doom_loop` signals | step limits |

Key takeaway: verification is enforced by **prompting the model to verify and
report honestly**, plus a **structural gate tied to the todo list** — both of
which build directly on a persistent todo list. The deterministic "harness runs
the build itself" idea is a backstop, not the core mechanism.

---

## Phase 1 — keep the plan alive, stop killing long runs

Commit: `feat(agent): harden long-task loop (phase 1)`

| Change | File(s) | Notes |
|--------|---------|-------|
| **Persistent todo block** | `tools/todo.ts` (`renderTodoPromptBlock`), `agent/loop.ts` (`executeTurn`) | Re-renders the todo list into a `cache:false` system block **every turn, from the store** (not from history). Because it's rebuilt each turn, it survives context compaction for free. |
| **Iteration cap 100 → 250** | `server.ts`, `cli/commands/run.ts`, `agent/types.ts` (`totalIterationLimit`), `agent/loop.ts` (ctor default) | All four in-sync sites bumped together. Subagent (20) and agent-tool (50) caps left as-is. |
| **Two-tier loop-health braking** | `agent/loop.ts` (`evaluateLoopHealth`), `effect/loop-health.ts` | Repeated-tool / oscillation breaches now **warn** at the threshold and only **hard-stop at 2×**. Preserves a runaway safety net without killing legitimate work. |
| **Deleted dead code** | `agent/loop.ts` | Removed unused `buildContinuationPrompt`. |

Tests: `tools/todo.test.ts`.

## Phase 2 — completion gate, nudge, honesty contract

Modeled on grok-build's `todo_gate` / `todo_nudge` and claude-code's prompt
contract. All three items are cheap and build on Phase 1's persistent todos.

| Item | File(s) | Behavior |
|------|---------|----------|
| **Todo-completion gate** | `agent/reminders.ts` (`evaluateTodoGate`), `agent/loop.ts` (loop exit) | When the model tries to stop (no tool calls) but todos are still `pending`/`in_progress`, inject a `<system-reminder>` listing the unfinished items and force another turn. Capped at `TODO_GATE_MAX_FORCES` (3) per run so a stubborn list still terminates. |
| **Todo nudge** | `agent/reminders.ts` (`shouldNudgeTodo`, `todoNudgeReminder`), `agent/loop.ts` | After `TODO_NUDGE_TURNS` (3) turns with no `todowrite`, and no more often than `TODO_NUDGE_GAP` (5) turns apart, inject a reminder to keep a plan. |
| **Verify / honesty contract** | `session/prompt/system.md` (Goal-driven execution) | Prompt now instructs: verify the build/tests for changed code before reporting done; report failures with output; never claim green when red; don't end a turn with unfinished todos unless genuinely blocked. |

### Wiring details (`agent/loop.ts`)

- **Reminder delivery**: a `pendingReminders: string[]` queue is drained into a
  single `cache:false` system block each turn (alongside the todo + memory
  blocks). Reminders are **transient** — never written to the session store, so
  they don't pollute persisted history or resumes.
- **Counters** (reset per run): `todoGateForces`, `turnsSinceTodoWrite`,
  `turnsSinceLastNudge`. `executeTurn` returns `usedTodoWrite` to drive them.

Tests: `agent/reminders.test.ts`.

### Tunable constants (`agent/reminders.ts`)

```
TODO_NUDGE_TURNS     = 3   // idle turns before a planning nudge
TODO_NUDGE_GAP       = 5   // min turns between nudges
TODO_GATE_MAX_FORCES = 3   // max forced continuations per run
```

## Phase 2 — deterministic verification gate

The prompt contract asks the model to verify; this is the **deterministic
backstop** for when it doesn't. Config-driven, so it never guesses.

| Item | File(s) | Behavior |
|------|---------|----------|
| **Verify gate** | `agent/verify.ts`, `agent/loop.ts` (loop exit, after the todo gate) | When a run **mutated files** and the model tries to stop, run the project's typecheck/build. On failure, inject the output as a `<system-reminder>` and force another turn; on pass (or no command), finish. |
| **Command resolution** | `agent/verify.ts` (`resolveVerifyCommand`) | Reads `package.json` `scripts`, picks the first of `typecheck > type-check > check > build`, and detects the package manager from the lockfile (`pnpm`/`yarn`/`bun`/`npm`). Returns nothing (gate skips) when there's no match. `test` is intentionally excluded (slow/flaky) — that stays the model's job. |

Details:

- **Ordering at loop exit**: todo gate → verify gate → complete. Finish the
  plan first, *then* confirm it compiles.
- **Only after mutations**: `filesMutatedThisRun` is set when a destructive tool
  succeeds, so read-only / Q&A turns never trigger a build.
- **Bounded**: `MAX_VERIFY_ATTEMPTS` (2) forced fixes per run, a 120s per-run
  timeout, output clipped to ~4k chars. Abort-aware (Ctrl+C kills the child).
- **No new IPC events** yet — progress is `console.log` only; a `verify_*`
  StreamEvent for the UI is a future nicety.

Tunable constants (`agent/verify.ts`): `MAX_VERIFY_ATTEMPTS = 2`,
`VERIFY_TIMEOUT_MS = 120_000`, and the `SCRIPT_PRIORITY` list.

Tests: `agent/verify.test.ts`.

---

## Phase 3 — adversarial verification subagent

Where the deterministic gate proves the code *compiles*, this proves it *does
what was asked*. Modeled on claude-code: for non-trivial changes, an independent
read-only subagent renders a verdict the main agent cannot self-assign.

| Item | File(s) | Behavior |
|------|---------|----------|
| **Verifier subagent** | `agent/subagent.ts` (`verifyChanges`, `parseVerdict`, `verifierFailureReminder`, new `verifier` type in `agent/types.ts`), `agent/loop.ts` (loop exit) | For a run that edited **≥ `VERIFIER_MIN_FILES` (3)** distinct files, spawn a read-only (`explore`-mode) subagent with the original request + changed-file list. It reads the code and ends with `VERDICT: PASS \| FAIL \| PARTIAL`. **FAIL** injects the findings as a `<system-reminder>` and forces a fix; **PASS/PARTIAL** proceed (PARTIAL is surfaced honestly by the model). |

Details:

- **Ordering at loop exit**: todo gate → deterministic verify gate → verifier
  subagent → complete.
- **Trigger**: `mutatedFiles` (distinct `edit`/`write` paths) size ≥ 3. Pure
  bash-only mutations don't trigger it (no file path to count), but still hit
  the deterministic gate.
- **No recursion**: the verifier runs read-only, so it never mutates files and
  never re-triggers either verification gate inside itself.
- **Bounded**: `MAX_VERIFIER_ATTEMPTS` (2) verify→fix cycles per run; abort-aware.
- **Verdict safety**: a missing/garbled verdict parses as PARTIAL, never a false
  PASS.

Tunable constants (`agent/subagent.ts`): `VERIFIER_MIN_FILES = 3`,
`MAX_VERIFIER_ATTEMPTS = 2`.

Tests: `agent/verifier.test.ts`.

---

## Deferred (remaining Phase 3)

Do not build these unless explicitly requested:

- **Auto-decomposition** — automatically split large tasks into subagents with
  fresh contexts. Largest design surface (when to spawn, how to split, how
  results merge back); high YAGNI risk.
- **Server-side loop detection** (grok `doom_loop`) — **N/A for us**: it relies
  on the model *server* emitting loop signals over SSE, which our API providers
  don't send. We approximate it with the client-side two-tier heuristic (Phase 1).
