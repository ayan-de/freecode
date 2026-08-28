# AVO and FreeCode — transferable architecture lessons

> **Status:** Research comparison, not an implementation specification. Its one
> adopted recommendation (§"The best ideas to take" §1) is now **built and off by
> default** — see the outcome note under `Decision`.
> **Date:** 2026-08-26 (facts re-verified against the code 2026-08-27)
> **Primary source:** *AVO: Agentic Variation Operators for Autonomous Evolutionary Search*,
> Chen et al. (NVIDIA), arXiv:2603.24517v1, 2026-03-25 (local: `2603.24517v1.pdf`)
> **Related FreeCode designs:** `specs/2026-08-10-autonomous-runs-design.md` (design),
> `specs/2026-08-08-continual-harness-design.md` (design), and
> `specs/2026-08-23-eval-harness.md` (**Phases 0–1 shipped** — `apps/core/src/eval/`,
> `evals/`, `freecode eval`)
> **Spec derived from this document:** `specs/2026-08-26-trajectory-redirection.md`

## Executive conclusion

AVO is not a general recommendation to add evolutionary search to FreeCode. Its useful
idea is a small, evidence-driven control loop for work with an objective evaluator:

```text
candidate → verify and score → retain evidence-backed improvement → use its history next
                                  ↑
                     redirect when the trajectory stalls
```

FreeCode already has the agent loop, tools, durable rollout events, memory, git-facing
workflow, and basic stuck-loop detection. The highest-value lesson to adopt is therefore
**trajectory-aware strategy redirection**: when the current approach is demonstrably
stuck, provide the next turn with a concise, evidence-grounded instruction to change
approach. This must remain budgeted, auditable, and user-initiated in unattended modes.

The second useful lesson—**a scored lineage of accepted variants**—should be designed
only when FreeCode has a concrete feature such as “try alternatives and keep the fastest
passing implementation.” It is not needed for ordinary coding sessions.

## What the paper actually establishes

AVO replaces a fixed evolutionary pipeline, `Generate(Sample(P))`, with an autonomous
agent, `Agent(P, K, f)` (paper §3.1):

- `P` is a lineage of prior committed solutions and their measured scores.
- `K` is domain knowledge the agent may consult (in the experiment: CUDA/PTX docs and
  reference kernels).
- `f` is an external evaluation function. A candidate that fails correctness receives
  zero score regardless of throughput.

Within a variation step, the agent inspects prior versions, consults knowledge, edits,
runs the evaluator, diagnoses failures, and retries. Only candidates that pass correctness
and match or beat the current best score enter the committed lineage (paper §3.2).

For long-running work, a conditional supervisor detects stalling or repeated
non-improvement, reviews the overall trajectory, and proposes fresh optimization
directions (paper §3.3). The authors evaluated a **single lineage**, not a population,
island model, or crossover system. AVO *does* auto-commit: each accepted version is
persisted as a git commit with its score (§3.3). What it does not do — and what FreeCode
must not copy — is auto-commit ordinary coding work; AVO's commits are experiment
bookkeeping for a lineage whose admission is decided by an external evaluator.

The paper's empirical results are compelling for GPU-kernel optimization, but they do
not prove that every component benefits normal software-engineering tasks. The design
recommendations below separate the general harness lesson from its specialised benchmark.

## Current fit in FreeCode

| AVO element | FreeCode equivalent | Status and implication |
| --- | --- | --- |
| Self-directed plan → edit → test → diagnose loop | `agent/loop.ts` and tool orchestration | **Implemented.** This is already FreeCode’s core operating model. |
| Environment feedback | `bash`, LSP, file tools, MCP tools | **Implemented.** Project tests, linters, benchmarks, and other commands can supply the evaluator signal. |
| Knowledge the agent can retrieve as needed | skills, project context, persistent memory and memory graph | **Implemented.** The storage/retrieval mechanism differs from the paper’s accumulated conversation history, but serves the same role. |
| Durable work trajectory | rollout events, session/thread storage, git history | **Implemented.** Rollout supplies the audit evidence a supervisor should consume. |
| Stuck-pattern detection | `createLoopHealthEvaluator()` (`effect/loop-health.ts`), called from `agent/loop.ts:723` | **Partly implemented, and weaker than it looks.** FreeCode detects repeated tool calls, no file-change progress, and edit/revert oscillation. A `stop` ends the run; a `warn` reaches only `logger.debug` (`agent/loop.ts:737`) unless redirection is switched on. The counter defects — `no_progress` counting tool calls rather than turns, a monotonic `oscillationScore`, and a duplicate evaluator — were repaired in Phase 0 of `specs/2026-08-26-trajectory-redirection.md` (2026-08-26), so the signal is now trustworthy enough to act on. |
| Correctness-before-performance gate | `agent/verify.ts` today; autonomous-runs design’s fixed command later | **Partly implemented, and this row understated it.** A run that mutated files already runs a typecheck/build before finishing, resolved from `package.json` scripts, capped at `MAX_VERIFY_ATTEMPTS`; a failure feeds back and forces another turn. What is missing is the *admission* half of AVO’s rule: today's gate makes the agent keep working, it does not decide whether work is admitted, and the command is inferred rather than user-fixed — so the model’s own claim of “done” is still the thing that ends an ordinary run. |
| Budgeted unattended execution and review artifact | Autonomous-runs design; `autonomous/` (Phase 0) | **Budget shipped, execution not.** The four-way ceiling (turns/tokens/time/usd, cache reads excluded) and the run manifest exist as pure logic with tests. Nothing starts an agent, spawns a process, or runs a gate — so the review artifact is still design-only, and that is what AVO’s long-run behaviour would need. |
| Scored accepted-candidate lineage | No dedicated subsystem | **Not implemented.** Existing rollout records attempts, but does not model candidate baselines, score vectors, or admission rules. |
| Trajectory-level redirection | `agent/redirect/` | **Implemented, off by default** (2026-08-27). A loop-health `warn` folds the rollout log into a bounded evidence packet, buys one small model call for up to three alternative directions, and injects them as a `<system-reminder>`. Capped at 2 per run / 1 per reason, fails closed, tokens billed to the run. Spec: `specs/2026-08-26-trajectory-redirection.md` Phases 0–1. |

## The best ideas to take

### 1. Redirect on evidence, rather than merely warn or stop

Extend loop-health from a circuit breaker into a bounded recovery point. On a warning
threshold, derive a small evidence packet from the rollout: the relevant failed commands,
tool-call pattern, changed files, verifier results, and current plan. Ask a supervisor
policy for *several materially different next directions*, then inject one concise
direction into the following turn.

The supervisor must be advisory, not an unbounded second agent. It should not edit files,
relax permissions, alter the verifier, or silently extend a run budget. Its output should
be recorded in rollout and shown in the final unattended-run report.

This is more valuable than simply raising iteration limits: it attacks the reason for the
extra iterations instead of funding the same loop for longer.

**Acceptance criteria for a later spec:**

1. A loop-health warning produces a recorded redirection or an explicit “no safe
   redirection” result.
2. The redirection cites the exact trajectory evidence used to form it.
3. The same reason cannot trigger unlimited supervisor calls; it has a per-run cap and
   consumes the normal token/USD/time budget.
4. The verifier and permission profile remain system-controlled.
5. Tests cover repeat calls, no-progress work, oscillation, supervisor failure, and the
   case where the agent ignores the advice.

**Met as of 2026-08-27** (`agent/redirect/`), with one qualification:

| # | Status |
| --- | --- |
| 1 | ✅ `redirect.triggered` on success, `redirect.skipped` with a reason on every other path — including "the feature is off", once per run, which is what makes the trigger rate measurable before anyone turns it on. |
| 2 | ✅ `evidenceEventIds` on the triggered event. `buildEvidence()` is pure, so those ids reconstruct the exact packet the advice was formed on. |
| 3 | ✅ 2 per run, 1 per reason, 3-turn debounce; tokens folded into the run totals and `recordDailyUsage()` so the spend breaker sees them; USD/time ceilings apply once a run budget owns the loop (`RunLimits.maxRedirects`). |
| 4 | ✅ D9 — the supervisor is one text completion with no tools, no permission surface, and no access to `resolveVerifyCommand()`. |
| 5 | ⚠️ Four of five. Repeat calls, no-progress, oscillation and supervisor failure are covered. **"The agent ignores the advice" is deliberately not a test**: there is no code path for it — the reminder is fire-and-forget and the loop behaves identically either way. It is a *measurement* (advice-ignored rate), and it needs the eval sandbox. |

### 2. Make verification an admission gate, not a completion claim

For a bounded autonomous run, the agent should not be authoritative about “done.” A
user-configured, fixed verification command is the admission gate for a claimed outcome.
This aligns directly with AVO’s correctness-first scoring and is already the direction of
the autonomous-runs design.

For performance-oriented tasks, the gate may be a benchmark, but its protocol must be
explicit: baseline, environment, repetitions, noise tolerance, and whether the objective
is scalar or a score vector. “The benchmark looked faster once” is not a safe admission
rule.

This does **not** mean automatically committing ordinary coding changes. In v1, a passing
gate is evidence presented for human review; worktree isolation and explicit approval
remain the safe default.

### 3. Add scored lineage only for explicit variant-search tasks

A separate `variant search` capability becomes justified when a user asks for a bounded
objective such as:

> Try up to five implementations, keep the one that passes the tests and improves this
> benchmark by at least 2%.

That feature needs a compact, durable record per candidate:

```ts
interface CandidateRecord {
  id: string;
  parentId: string;
  revision: string;             // git commit or immutable patch reference
  evaluator: { command: string; version?: string };
  correctness: "pass" | "fail";
  scores: Record<string, number>;
  admitted: boolean;
  evidenceEventIds: string[];   // rollout + verification events
}
```

Admission should be deterministic and system-owned: correctness must pass, the score must
meet the declared comparison rule, and a regression on a required score dimension rejects
the candidate. The model can propose an experiment; it cannot rewrite the score rule or
admit its own work.

Start with a single lineage. AVO itself only evaluates that setting. Population archives,
MAP-Elites/islands, crossover, and automatic exploration scheduling add complexity without
an identified FreeCode use case.

### 4. Preserve failed attempts as evidence without promoting them as knowledge

AVO distinguishes internal failed attempts from its committed lineage. FreeCode should
make the same distinction:

- rollout retains the full audit trail, including failures;
- candidate lineage contains only objectively admitted variants;
- persistent memory/continual-harness entries require separately reviewed, generalisable
  lessons—not raw benchmark logs or an agent’s unsupported conclusion.

This prevents noisy failed experiments from poisoning later context while preserving the
diagnostic data needed for a supervisor or human review.

## Recommended sequencing

1. ~~Add trajectory redirection as a small, bounded extension of loop health, inside the
   ordinary interactive loop, then measure it.~~ **Done 2026-08-26/27**
   (`specs/2026-08-26-trajectory-redirection.md`, Phases 0–2). Built, measured, and
   **left off by default** — the measurement returned *do not flip*, because with no
   sandbox the suite cannot reach a baseline where tool repetition is non-zero, so §9's
   criterion has nothing to compare. That is the designed outcome of a failed criterion,
   not a stalled task. Two harness bugs were fixed on the way: a `question` tool call
   ended the suite at exit 0 (so no gated suite had ever completed), and `no_progress`
   fired on healthy read-only exploration.
2. **In progress.** Ship and validate the bounded autonomous-run foundations: explicit
   budgets, fixed verification gate, isolated worktree, rollout checkpoints, and review
   report. **Phase 0 shipped 2026-08-27** — `autonomous/` has the four-way budget ceiling
   and the run manifest as pure logic; nothing executes yet. A Tier A run then reuses the
   redirection mechanism from step 1 as its supervisor rather than growing a second one,
   and the seam for that already exists (`RunLimits.maxRedirects`).
3. Only then design a narrow variant-search mode around a real request with a stable,
   reproducible evaluator. Reuse the autonomous-run budget, gate, worktree, rollout, and
   report rather than creating a second execution path.

Steps 1 and 2 are deliberately in this order, which is the reverse of the obvious
reading. Redirection is the cheap, measurable half of AVO's supervisor and needs no
unattended-execution machinery to be useful; autonomous runs are the large unshipped
spec. Sequencing the small one first also means the autonomous-run report has something
concrete to show when it lands.

## Deliberate non-adoptions

- **No GPU-specific optimisation subsystem.** CUDA/PTX and profiler reasoning belong to
  the paper’s domain knowledge, not FreeCode’s architecture.
- **No open-ended self-scheduling or seven-day runs.** AVO’s continuous execution is not
  safe to copy while FreeCode’s Tier B ambient mode remains deferred and API usage is
  metered.
- **No automatic git commits or pushes.** AVO’s commits preserve an experiment lineage;
  FreeCode should first preserve candidate revisions in an isolated worktree and require
  human approval for repository-integrating actions.
- **No population management.** The paper leaves it for future extensions and presents no
  evidence that it is needed for the single-lineage process that produced its results.
- **No “improvement” based on an LLM judgment alone.** Use deterministic verification and
  declared metrics wherever possible; a judge can supplement review, not replace the
  admission gate.

## Decision

Treat AVO as confirmation of FreeCode’s existing agent-loop direction and as motivation
for one enhancement: **bounded, trajectory-aware recovery backed by verifier evidence**.
Do not start an AVO clone. The measurement harness for it already ships (eval, Phases
0–1); the unattended-execution work it eventually plugs into is described by the
autonomous-runs design; scored variant lineage stays a separate, on-demand capability
until a concrete user workflow warrants it.

### Outcome (2026-08-27)

The recommendation was taken and it holds up, with one honest caveat.

**Built:** trajectory redirection (`agent/redirect/`) — a loop-health warning folds the
rollout log into a bounded evidence packet, buys one small model call for up to three
alternative directions, and injects them into the next turn. Advisory, capped,
fail-closed, tokens billed to the run, no advice text in the log. Plus the budget half of
autonomous runs, which is what a Tier A supervisor will be capped by.

**Not shown:** that it *helps*. The machinery is proven by unit tests and by an
end-to-end test that drives the real loop; what no measurement can yet demonstrate is a
benefit on real work, because the eval harness has no sandbox and therefore cannot
provoke the stuck states redirection exists for. The default stays off until it can.

**What the exercise was worth regardless.** Reading AVO against this codebase produced
five defects that had nothing to do with AVO and would not have been found by building
the feature alone: `no_progress` counting tool calls rather than turns; a monotonic
oscillation score; a duplicated loop-health evaluator; an eval suite that silently died
at exit 0 on any clarifying question; and `no_progress` firing on read-only modes that
cannot, by construction, make progress. Four are fixed, and the fifth (the eval sandbox)
is now the named blocker for the rest. That is the return on a comparison document —
not the feature it recommends, but the questions it forces you to ask about what you
already have.
