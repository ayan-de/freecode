# Autonomous Runs — Bounded and Ambient Unattended Work for FreeCode

> **Status:** Design
> **Date:** 2026-08-10
> **Prior art:** Prime Intellect's Prime Agent (`/autonomous`), Apache-2.0, TypeScript,
> local clone `~/Projects/githubProjects/agents/prime-agent`, primary file
> `packages/coding-agent/src/core/autonomous.ts` (594 lines). jcode's `overnight` mode
> (shipped Rust) and `Ambient Mode` (unshipped design doc), local clone
> `~/Projects/githubProjects/agents/jcode`, primary files
> `crates/jcode-overnight-core/src/lib.rs` (952 lines) and `docs/AMBIENT_MODE.md`.
> **Companion spec:** `2026-08-08-continual-harness-design.md` ("Layer 1" — the agent
> editing its own prompt/memory/skill/subagent state). This spec ("Layer 2") is about
> the agent *running without a human present*. They are separable and separately
> shippable; see §4.7 for how they interact.
> **Related specs:** `2026-07-26-memory-knowledge-graph.md`, `2026-07-18-permission-rules.md`,
> `2026-08-09-memory-write-path.md`

---

## 0. Read this first (plain language)

Layer 1 (`/refine`-equivalent) answers "how does the agent remember what it learned?"
Layer 2 answers a different question: **"who is watching while it works, and what stops
it if nobody is?"** Every tool call FreeCode makes today happens because a human is
sitting there, watching the diff, able to hit stop. Layer 2 is about the mode where
that is no longer true — either because the user said "go, I'll check back in two
hours" (**bounded autonomous run**), or because nobody said anything and the agent
decided to act on its own (**ambient run**). These are different enough in risk profile
that this spec treats them as two tiers of the same mechanism, not one feature:

| Tier | Who starts it | Duration | Ships when |
| --- | --- | --- | --- |
| **Tier A — Bounded autonomous run** | User, explicitly, with a budget | Minutes to a few hours, hard-capped | This spec, v1 |
| **Tier B — Ambient run** | The agent, on its own schedule | Indefinite, self-renewing | Deferred — see §11 |

The three reference systems split cleanly across these tiers. Prime Agent's
`/autonomous` and jcode's `overnight` are both Tier A: a human explicitly starts them
with a budget and comes back later to review. jcode's `Ambient Mode` is Tier B — and
critically, **jcode has not shipped it either**. Its own doc is headed `Status: Design`.
That is the single most important fact this spec is built around: even the project that
designed the self-scheduling daemon has, as of this reading, only designed it. Building
Tier B before Tier A is proven would mean building the least observable, hardest to
debug, and easiest-to-regret part of this feature first, with no working smaller
version underneath it to fall back to. §8 sequences accordingly.

### Why FreeCode specifically has a smaller Tier A cliff than the reference projects

FreeCode has no OAuth/subscription provider auth — `providers/config.ts` is
`setApiKey`/`hasApiKey` only (I checked). jcode's Ambient Mode design and Prime Agent's
"strongest available OAuth model" default both lean on the fact that a subscription
plan makes background token spend feel free to the user. For FreeCode, every autonomous
turn is a metered API call. This changes the honest default from "on, budget-limited"
to "off, and when on, show the user a cost estimate before it runs." §9 is stricter
than either reference project's defaults for exactly this reason.

FreeCode also has no OS-level persistent daemon. `apps/core` (`server.ts`) runs until
the process exits — I found no idle timeout and no `serve`/daemonize subcommand in
`cli.ts`. It is spawned when a frontend launches and dies when the frontend closes. jcode
assumes something closer to "always resident, like a phone app." Tier A survives this
gap by detaching its own child process (§4.4); Tier B does not have an answer to this
gap yet, which is a second, independent reason it is deferred.

---

## 1. Problem

Every long-running task in FreeCode today dies with the terminal. Concretely:

1. **No unattended continuation.** If a task takes three hours and the user closes the
   laptop, the session simply stops. There is no equivalent of "keep working, I'll check
   the results later."
2. **No budget concept for a multi-turn goal.** The agent loop (`agent/loop.ts`) runs
   turn by turn with a human deciding when to stop. There is no `maxTurns`/`maxTokens`/
   `timeoutMs` ceiling that lets a human hand off a bounded amount of trust and walk away
   with a guarantee about the blast radius.
3. **No verification-gated "done."** Nothing currently stops the agent from declaring
   success without evidence. `permission/profiles.ts` gates *what* a tool can touch, not
   *whether the claimed outcome is true*.
4. **No maintenance ever runs unattended.** The memory graph (`memory/graph/`) has
   `computeClusters` and `deriveGraph` but nothing calls them periodically to merge
   duplicates or prune stale entries — that only happens if a human thinks to run it.
5. **No audit trail for unsupervised work.** `rollout/` records every turn of an
   attended session. There is no equivalent record built for "here is exactly what
   happened while nobody was watching, so a human can review it afterward with
   confidence, not just trust."

The risk of *not* building this is not "FreeCode falls behind" — it's that anyone who
wants this today reaches for a shell `while true` loop around the CLI with none of the
budget, gating, or audit properties below, which is strictly worse.

## 2. Goal

Add **Tier A: bounded autonomous runs** — a user-initiated, budget-capped, verification-
gated unattended session that produces a reviewable report and never merges to the
default branch without an explicit human action.

### Success criteria

1. A user can start a run with an explicit budget (turns, tokens, wall-clock) and a
   verification command, walk away, and come back to either a passing, reviewable
   result or a clearly-reported reason it stopped short.
2. The run cannot exceed its budget under any code path, including provider errors,
   infinite tool-call loops, and crash-restart.
3. Every action taken during the run is in the audit trail (`rollout/`), attributable
   to the specific run, replayable, and diffable against the pre-run state.
4. The run never pushes to `main`/`master` and never merges without a human action —
   verification passing is not the same as approval.
5. If the process hosting the run dies (crash, OOM, laptop closed the wrong way), the
   run is resumable or cleanly marked incomplete — never silently lost, never left in
   an ambiguous "maybe still running" state.

### Non-goals (this spec)

- **Tier B (ambient, self-scheduling background loop).** Deferred — §11. This spec's
  design should not preclude it, but does not build it.
- **Editing FreeCode's own source and hot-reloading** (jcode's `selfdev`). Different
  risk profile — you can brick the install. Out of scope entirely; if wanted later it
  is its own spec.
- **Weight training / fine-tuning on run trajectories.** Not this feature.
- **A general-purpose scheduler/cron system.** Tier A is user-triggered "run now with
  this budget," not "run every night at 2am." That's Tier B territory.
- **Choosing the verification strategy for the user.** The run needs *a* verification
  command (tests, typecheck, lint — whatever the project already uses); this spec does
  not invent a universal correctness oracle.

---

## 3. Prior art

### 3.1 Prime Agent `/autonomous` — the budget and gate model (adopt directly)

`autonomous.ts` is small, self-contained, and the best-designed piece of prior art
across both reference repos for this spec. Four independent ceilings, whichever is hit
first stops the run (`DEFAULT_AUTONOMOUS_LIMITS`, `:48-55`):

```typescript
maxContinuations: 3,       // how many times the *system* re-prompts the model
maxTurns: 12,               // assistant turns
maxTokens: 80_000,          // input+output+cacheWrite (cache reads excluded, :190-193)
timeoutMs: 30 * 60 * 1000,  // wall clock
```

Why cache-read tokens are excluded from the token budget (`:190-193`, verbatim
reasoning in their comment): counting them cumulatively would make long verifier loops
exhaust budget from *repeated context*, not *new work*. This is directly relevant to
FreeCode, which just spent a full release on cache hit rate — steal this exact
exclusion rule (§4.3).

**Quality gates** (`:273-348`) are shell commands run after each turn. On failure, the
result is turned into a continuation message telling the model exactly what failed and
to keep going (`buildAutonomousGateFailureContinuation`, `:350-360`). The clever part:
before re-running a gate, it hashes the git worktree (`captureGitWorktreeSnapshot`,
`:374-423` — `git status --porcelain` + `git diff` + a content hash of untracked files)
and compares it to the snapshot at the last failure. **If nothing changed, it does not
re-run the gate** — it just increments the retry counter with a canned "workspace
unchanged" message (`:296-311`). This stops a stuck model from burning budget re-running
an expensive test suite against code it hasn't touched.

**The continuation prompt is the whole safety culture in one string** (`:45-46`):

> "No human input is available in autonomous mode. Continue working until the host
> evaluator, verifier, or configured autonomous limits stop the run... Do not end the
> session yourself; the verifier/evaluator decides completion when configured gates
> pass."

The model is explicitly told it does not get to decide it's done. A gate does.

### 3.2 jcode `overnight` — the report and resource model (adopt the shape, not the mechanism)

Real, shipped Rust (`jcode-overnight-core`), not a design doc. User starts it explicitly:
`/overnight <hours>[h|m] [mission]`, 1 minute to 72 hours (`parse_duration`, `:332-364`).
Worth stealing:

- **`OvernightManifest`** (`:46-82`) — one struct records everything about the run:
  coordinator session id, start/target-wake/grace times, status
  (`Running`/`CancelRequested`/`Completed`/`Failed`), provider/model, and paths to every
  artifact (events log, review HTML, task-cards dir, issue-drafts dir, validation dir).
  This is the manifest shape to imitate for `run.json` in §4.2.
- **`OvernightTaskCard`** (`:203-233`) — structured before/after/validation/outcome per
  unit of work, not just a wall of log lines. `before.problem` + `before.evidence`,
  `after.change` + `after.files_changed`, `validation.commands` + `validation.result`.
  This is a genuinely good idea independent of the Rust: it turns "what did the agent do
  for three hours" into something a human can skim in two minutes instead of reading a
  transcript.
- **Resource-aware pacing** (`ResourceSnapshot`, `UsageProjection`, `:98-152`) —
  memory/CPU/battery/disk snapshots plus a usage-rate projection with a `risk` and
  `confidence` field, checked before continuing. FreeCode does not need the
  memory/CPU/battery part (that's for jcode running as a resident desktop app); it does
  need the **usage projection** part, because FreeCode autonomous runs cost real API
  dollars per §0.
- **`build_review_html`** (`:569-699`) — a self-contained HTML report with a timeline
  and rendered task cards. Good end state; not v1 (§8 — start with markdown).

### 3.3 jcode `Ambient Mode` — the vision, explicitly unshipped

`docs/AMBIENT_MODE.md` is headed `> **Status:** Design` and `> **Updated:** 2026-02-08`.
Reading it is still useful for two ideas worth carrying into Tier B's *eventual* design
(not built now, recorded so §11 isn't starting from nothing):

- **Two-layer memory consolidation** — cheap per-turn reinforcement (their "sidecar",
  already effectively what FreeCode's memory write path does) plus a separate, deeper
  "garden" pass that runs graph-wide dedup, contradiction resolution, and pruning. Maps
  directly onto `memory/graph/clusters.ts` + `builder.ts`, which already compute the
  graph but have no consolidation pass that writes back (§4.6).
- **The system proposes a schedule, a resource calculator constrains it** — the agent
  calls a `schedule_ambient` tool with a proposed wake time, and a separate, non-LLM
  component clamps it based on rate-limit headroom and whether the user is currently
  active. The separation (agent proposes, system decides) is the right shape *if* Tier B
  is ever built — noted for §11, not designed further here.

---

## 4. Design (Tier A only)

### 4.1 Where it lives

```
apps/core/src/autonomous/
├── types.ts        # RunManifest, RunLimits, RunStatus, TaskCard, GateResult
├── budget.ts        # port of autonomous.ts §3.1 — four-way ceiling + cache-read exclusion
├── gate.ts           # verification command runner + worktree-unchanged skip
├── supervisor.ts     # process detach/respawn, PID file, crash recovery (§4.4)
├── run-store.ts       # manifest read/write, atomic (reuse Layer 1's tmp+rename pattern)
├── report.ts          # markdown report from task cards + rollout events (§4.5)
└── prompts.ts          # continuation prompt, task-card extraction prompt
```

New top-level directory, parallel to `harness/` (Layer 1) rather than inside `agent/`,
because this wraps a whole session lifecycle (start a session, keep it alive unattended,
tear it down, report), not a single loop concern.

### 4.2 Storage layout

```
~/.freecode/runs/<run_id>/
├── manifest.json          # RunManifest — status, budget, limits used, paths
├── report.md              # human-readable summary (§4.5)
├── task-cards/*.json       # one per unit of work, jcode-shaped (§3.2)
└── worktree -> <path>      # symlink to the git worktree this run operates in
```

The turn-by-turn event log is **not** a new file format — it rides the existing
`rollout/` event stream (`rollout/recorder.ts`), same call made in Layer 1 for local
refinement history (§4.2 of that spec). `rollout/types.ts`'s `RolloutEvent` union
(`turn.started`, `turn.aborted`, `function.call`, `function.output`, `compact.occurred`,
`subagent.start/stop`, `skill.invoked`, `hook.triggered/blocked`, `context.overflow`,
`parse.error`) gets four new members:

```typescript
| RunStartedEvent      // { type: "run.started"; runId; limits; verifyCommand }
| RunCheckpointEvent    // { type: "run.checkpoint"; runId; budgetUsed; usdEstimate }
| RunGateResultEvent    // { type: "run.gate_result"; runId; command; passed; attempt }
| RunEndedEvent         // { type: "run.ended"; runId; reason; taskCardCount }
```

`aggregateID` is the run id, same pattern as a normal session — this is *deliberate*: a
run is not a new kind of thing in the event-sourcing model, it's a session whose turns
happen to be system-continued instead of human-continued. That reuse is what makes
replay (`rollout/replay.ts`) work on a run for free.

### 4.3 Budget — direct port of §3.1, one addition

```typescript
export interface RunLimits {
  maxTurns: number;       // default 20 — see §9, more conservative than PA's 12
  maxTokens: number;       // default 150_000, excluding cache reads (§3.1)
  timeoutMs: number;        // default 60 * 60 * 1000 (1h) — see §9
  maxUsd?: number;          // NEW — not in Prime Agent, required because we have no OAuth free tier
}
```

`maxUsd` is checked at the same `run.checkpoint` cadence as the other three, computed
from provider-reported usage (`usage.get` IPC, per the existing method table) against
the session's model pricing. Whichever ceiling is hit first stops the run — same
"first one wins" logic as `autonomousLimitReason` (`autonomous.ts:254-271`), just with
a fourth branch. This is the single most important FreeCode-specific addition over the
Prime Agent design, because Prime Agent's OAuth-first default means a runaway loop
mostly wastes time, not money; ours wastes both.

### 4.4 Surviving the terminal closing

This is the piece with no direct FreeCode precedent and the largest net-new engineering
in this spec. `apps/core` has no daemon mode (§0). Two workable shapes:

**(a) Detached child process, PID-file supervised.** When a run starts, the core
process that received the `autonomous.start` call spawns a **detached** child running
the run's agent loop (`spawn(..., { detached: true, stdio: "ignore" })`, matching the
pattern already used in `autonomous.ts:494-499` for gate commands, just applied to the
whole run instead of one command). The child writes its PID into `manifest.json`. The
parent CLI can exit; the child keeps running, writing to `rollout/` and `manifest.json`
independently. Any later `freecode` invocation (or `freecode runs status <id>`) reads
the manifest and, if the PID is alive, reports "running"; if dead without a terminal
status, marks it `crashed` and surfaces the last good checkpoint.

**(b) Require the user to run a long-lived host process explicitly** (`freecode serve`,
which does not currently exist — would need a new `cli/serve.ts` subcommand parallel to
the existing `mcp`/`session`/`web` ones) and route `autonomous.start` through it.

**Recommend (a) for v1.** It requires no new persistent-service concept, no init-system
integration (systemd/launchd), and no "is the daemon running" precondition before a run
can even start — which matters because a user's first experience of this feature should
not be "install a service first." (b) is worth revisiting if Tier B (§11) is ever
built, since an ambient loop genuinely wants a resident process rather than a spawned
one — but that's a Tier B decision, not this one.

Consequence of (a): the run's git worktree, provider credentials, and MCP connections
must all be independently re-derivable by the child without the parent's in-memory
state — nothing can be passed by reference across the process boundary. Pass a
self-contained `RunManifest` as the child's argument, not a live object.

### 4.5 Reporting

v1: `report.md`, generated at run end from the task cards and the terminal `run.ended`
event — no HTML (jcode's `build_review_html`, §3.2, is real but the template plus
timeline plus escaping is ~200 lines for a v1 that has zero users yet; markdown renders
fine in every frontend FreeCode already has and costs a fraction of that). Task cards
follow jcode's shape (`before`/`after`/`validation`/`outcome`, §3.2) but are populated
by the run's own agent — after each meaningful unit of work, a lightweight instruction
in the continuation prompt tells the model to write a task card, not by a separate
extraction pass (that would be a second LLM call per unit of work; too expensive at
this budget scale — contrast with Layer 1's dedicated planner, which can afford it
because it runs once per ~25 turns, not once per unit of work).

### 4.6 The one piece of Tier B pulled forward: memory garden

Not gated behind Tier A vs Tier B — this is small, safe, and useful on its own. Add
`memory/graph/garden.ts`:

```typescript
export function findDuplicates(entries: MemoryEntry[], threshold = 0.95): DuplicatePair[]
export function findStale(entries: MemoryEntry[], halfLifeDays: number): MemoryEntry[]
export function garden(entries: MemoryEntry[]): GardenResult  // merges + prune candidates, no writes
```

Pure functions over `computeClusters`/`deriveGraph`'s existing output — `garden` itself
never writes; it *proposes*. Wire it as an optional step at the end of a Tier A run
(cheap, since the graph is already loaded for context) and, separately, as a manual
`memory graph garden` CLI command a human can run today with no autonomy involved at
all. This gives real usage data on the consolidation logic before anything unattended
ever calls it — same "prove the primitive attended before trusting it unattended"
principle as the rest of this spec.

### 4.7 Interaction with Layer 1 (continual harness)

Soft dependency, not a hard one. A Tier A run **can** call the Layer 1 `refine` tool at
its own turn boundaries if Layer 1 has landed — a three-hour run that discovers "this
repo's test suite needs `--runInBand`" should be able to write that down the same way
an attended session would. But Tier A does not require Layer 1 to exist: if it hasn't
landed yet, the run just doesn't have a Layer 1-provided harness to draw on or write to,
and behaves as a longer, budget-gated ordinary session. Recommend landing Layer 1
phases 0-2 first only because the *audit and rollback culture* they establish
(`applyRefinementProposal`'s baseline-conflict rejection, the append-only refinement
log) is exactly the culture this spec needs for `RunManifest`/`report.md`, and it's
cheaper to establish once and reuse than to invent twice.

### 4.8 Permission profile

New profile in `permission/profiles.ts`, stricter than every existing one:

```typescript
unattended: {
  name: "unattended",
  fileRead: true,
  fileWrite: true,   // scoped to the run's worktree only, enforced by rules below
  network: false,      // opt-in per run via explicit rule, not a blanket true
  shell: true,          // scoped to an allowlist, not free-form
  subprocess: false,
  mcpServers: [],
} as PermissionProfile,
```

The shell scoping is not a new mechanism — it reuses `permission/rules.ts`'s existing
path/pattern-based allow/ask/deny evaluation (already listed as `PATH_TOOLS`/`URL_TOOLS`
machinery in the CLAUDE.md tool-registration checklist). A run's manifest seeds a
temporary rule set for its session: allow exactly the verification command(s) the user
specified at start, deny everything else under `shell`. This is *instead of* inventing
Prime Agent's separate `gates.commands` allowlist concept (§3.1) — same idea,
FreeCode-native mechanism, one allow/deny system instead of two.

### 4.9 The tool / command surface

```
autonomous.start   → { budget: RunLimits, verifyCommand: string, mission?: string, worktree?: boolean }
                      → { runId, estimatedUsd }   // shown to user for confirmation BEFORE spawn
autonomous.status  → { runId } → RunManifest
autonomous.log     → { runId, tail?: number } → rollout events for that run
autonomous.cancel  → { runId } → { status: "cancel_requested" }
autonomous.review  → { runId } → { reportMd: string, taskCards: TaskCard[] }
```

`autonomous.start` is two-phase: it first returns a **cost estimate** (turns × avg
tokens/turn from the session's recent history × model price) that the frontend must
show and the user must confirm before the child process actually spawns. This is the
single UI requirement this spec treats as non-negotiable — per §0, FreeCode autonomous
runs cost real money and the user must see a number before committing to it, not
discover it after the fact in a bill.

Declared in `packages/shared/src/ipc/protocol.ts` (`METHODS`), handled in
`apps/core/src/server.ts`, plus `StreamEvent` variants (`run_started`, `run_checkpoint`,
`run_ended`) so a frontend that's open can show live progress, per the existing
convention.

---

## 5. Corner cases

### 5.1 Concurrency and lifecycle

| Case | Handling |
| --- | --- |
| User starts a second run while one is active | Allowed if different worktrees; same worktree → rejected, matching jcode's "one overnight run" simplicity rather than Prime Agent's arbitrary-parallelism model — simpler to reason about for v1. |
| Core process (parent) crashes, child (run) survives | Fine by design (§4.4a) — child is detached, has its own PID, writes its own manifest. Next `freecode` launch discovers it via `autonomous.status`. |
| Child (run) process crashes | PID in manifest goes stale. Next status check (any `freecode` invocation, or an explicit poll) detects the dead PID with a non-terminal status and marks the run `crashed`, preserving whatever task cards and rollout events exist up to that point. Never silently "still running" forever. |
| User runs `autonomous.cancel` | Sets `cancel_requested` in the manifest; the run's own loop checks this at the next turn boundary and exits cleanly (same "checked, not signaled" pattern as jcode's `OvernightRunStatus::CancelRequested`) — a hard `SIGKILL` is the fallback if the run doesn't check in within a grace period, not the first resort, because a killed-mid-write process is how manifests corrupt. |
| Laptop sleeps mid-run | `timeoutMs` is wall-clock from `startedAt`, so a long sleep silently consumes budget the same way jcode's `target_wake_at` does — accepted, documented behavior, not a bug: the alternative (excluding sleep time) requires OS-level wake tracking this spec is not taking on. |

### 5.2 Budget and gates

| Case | Handling |
| --- | --- |
| Gate command doesn't exist / typo | Fails immediately, reported in the manifest's `lastGateFailure`, does not retry-loop against a command that will never succeed — cap retries per §4.3's `maxRetries`, same as Prime Agent. |
| Gate passes but the model still calls more tools | Fine — gate passing is a *signal to consider stopping*, not an interrupt. The next turn boundary checks it. |
| Model tries to disable/skip the gate command via a tool call | Blocked structurally: the gate command is fixed at `autonomous.start` and re-read from the manifest each check, not sourced from anything the model can write to. |
| Budget exhausted mid-tool-call | Finish the in-flight tool call (never abort a write halfway), then stop before starting a new turn. |
| `maxUsd` estimate drifts from actual (model pricing changes, cache behavior differs from prediction) | Checkpoint against **actual** reported usage (`usage.get`), not the initial estimate — the estimate is only for the pre-flight confirmation in §4.9, never the enforcement mechanism. |

### 5.3 Trust and safety

| Case | Handling |
| --- | --- |
| Prompt injection from a file the run reads ("add a GitHub Actions secret exfil step") | The `unattended` profile (§4.8) has no network by default and shell scoped to exactly the verify command — this class of attack has nowhere to execute even if the model is fully steered. This is the actual argument for the strict-by-default profile, not just defense in depth. |
| Run wants to push / open a PR | **Never automatic in v1.** The run can commit to its own worktree branch; pushing and opening a PR is a reviewed action the user takes from `autonomous.review`, exactly mirroring Layer 1's "global scope requires `ask` permission" conservatism. |
| Run's worktree conflicts with the user's concurrent work in the main checkout | Runs always operate in a dedicated `git worktree add`, never the user's active working directory — this is why `worktree?: boolean` in `autonomous.start` should really not be optional; default true, and treat false (run in-place) as an explicit, loudly-confirmed opt-out. |
| Secrets in task-card content or report.md | Reuse `memory/graph/secret-filter.ts`'s `containsSecret` before writing any task card or report section — same reuse Layer 1 makes for harness content (its §5.3), same reasoning: a report is read by a human but may also get pasted into a memory or a PR description later. |

### 5.4 Multi-frontend

| Case | Handling |
| --- | --- |
| Run started from TUI, checked from VS Code | `autonomous.status`/`.log`/`.review` are plain IPC reads against `~/.freecode/runs/<id>/`, frontend-agnostic — no frontend-specific state. |
| No frontend open when the run finishes | Manifest + report.md sit on disk; next `autonomous.status` or `.review` call from any frontend picks it up. No push notification in v1 — logged as an open question (§10). |

---

## 6. Failure modes to watch for

Distinct from corner cases: ways the feature can work exactly as designed and still be
bad.

1. **False "done."** The gate passes on a technicality (e.g., the verify command is
   `echo ok`) and the report reads as success when nothing real happened. Mitigation:
   the pre-flight confirmation (§4.9) should visibly echo the verify command back to the
   user — "this run is not done until `pnpm test` passes" — so a weak gate is a decision
   the user visibly made, not a silent default.
2. **Budget theater.** Numbers that look conservative (20 turns) but translate to an
   unexpectedly large token/dollar cost because the codebase is large and every turn
   reads a lot of context. Mitigation: `maxUsd` (§4.3) is the real backstop precisely
   because turn/token counts are a poor proxy for cost when context size varies wildly
   by repo.
3. **A run that "succeeds" by narrowing the problem instead of solving it.** E.g., the
   gate is "tests pass" and the model deletes the failing test. Verification-gated
   ≠ verification-*sound*. This spec's gates are exactly as strong as the command the
   user supplies — no mitigation beyond making that limitation explicit in the
   pre-flight confirmation text.
4. **Report fatigue.** If runs are cheap to start, task cards + reports pile up and stop
   getting read, at which point the audit trail is real but useless. No mechanism
   proposed here beyond keeping runs opt-in and effortful to start (the cost-estimate
   confirmation in §4.9 doubles as friction against overuse).

---

## 7. Testing

Colocated `*.test.ts`, `tsx --test`, following the existing convention.

**Unit — pure functions, no process spawn, no LLM:**
- `autonomousLimitReason`-equivalent: all four ceilings, whichever hits first wins,
  including the `maxUsd` addition.
- Cache-read exclusion from the token budget (§4.3) — construct a `Usage` with large
  `cacheRead` and assert it does not count toward `maxTokens`.
- Gate worktree-unchanged skip: two identical git snapshots → gate not re-run, attempt
  counter still increments.
- `garden()` (§4.6): duplicate detection above/below threshold, stale detection at the
  half-life boundary — pure functions, no I/O, straightforward to make deterministic.

**Process/lifecycle (the risky, FreeCode-specific part — §4.4):**
- Spawn a run, kill the *parent* process, assert the child (run) is still alive and its
  manifest still updates.
- Kill the *child* mid-run, assert the next `autonomous.status` call detects the dead
  PID and transitions to `crashed` rather than reporting stale "running" forever.
- `autonomous.cancel` while the run is mid-tool-call: assert the in-flight write
  completes before the run exits (no partial file write left behind).

**Integration:**
- A run against a fixture repo with a deliberately broken test, budget high enough to
  fix it: assert the gate eventually passes and the report reflects it.
- A run against a fixture repo with an *unfixable* broken test, low budget: assert it
  stops at the budget ceiling with a `crashed`/`incomplete`-equivalent status, not a
  false "done."
- Secret-filter integration: a task card containing something that matches
  `containsSecret` is redacted before it reaches `report.md`.

**Mutation-check:** the worktree-unchanged gate skip and the four-way budget ceiling are
exactly the kind of "passes for the wrong reason" tests Layer 1's spec calls out
(v0.20.0 postmortem) — verify both fail when the implementation is deliberately broken,
not just that they pass today.

---

## 8. Phasing

Each phase independently shippable and revertible.

**Phase 0 — Manifest + budget, no execution.**
`types.ts`, `budget.ts`, `run-store.ts`. Hand-construct a `RunManifest`, exercise the
four-way ceiling logic against synthetic usage data. No agent loop involved yet.
*Verify: ceiling unit tests pass, including the mutation check.*

**Phase 1 — Foreground bounded run (no detach yet).**
Wire budget + gate into the existing agent loop, but run it sychronously in the
foreground — the user's terminal must stay open, no §4.4 detach yet. This isolates
"does the budget/gate logic work" from "does the process-survival logic work," which are
genuinely separate risks. *Verify: a real run against a fixture repo stops for each of
the four ceiling reasons in turn (four separate test runs, one ceiling forced low each
time).*

**Phase 2 — Detached execution (§4.4a).**
Spawn as detached child, PID file, crash detection, `autonomous.status`/`.cancel`.
*Verify: the process-lifecycle test suite in §7, especially parent-killed and
child-killed scenarios.*

**Phase 3 — Reporting.**
Task cards, `report.md`, `autonomous.review`. *Verify: a real multi-hour-budget run
against a real (not fixture) small task in this repo produces a report a human finds
actually useful — read it before deciding this phase is done, don't just check the file
exists.*

**Phase 4 — Memory garden (§4.6). Implemented, ahead of Phases 0-3.**
Landed first precisely because it is not on this spec's dependency chain: it is useful
attended, today, with no autonomy involved at all.

`memory/graph/garden.ts` — `findDuplicates` / `findStale` / `garden`, all pure over
`MemoryEntry[]`. No I/O, no embedder, no service, and nothing that writes. "Propose,
never write" is the whole safety property, and a pure function cannot violate it by
accident. Surfaced as `freecode memory graph garden [--half-life <days>]
[--threshold <0-1>]`, which prints a worklist and explicitly says nothing was changed.
There is no `--apply`: acting on a proposal stays a human decision, and the point of
this phase is real usage data on the consolidation logic *before* anything unattended
ever calls it.

Two deviations from §4.6 worth recording:

- **Similarity is lexical, not embedding-based.** `lexicalSimilarity` (Jaccard over
  tokens, already in `graph/index.ts`) rather than cosine over the vector store, because
  the embedder is an optional dependency and this has to work without it. The ceiling is
  named in the file: it catches near-identical *wording* only, so the same fact phrased
  two ways will not pair. Upgrade to vector scoring when there is evidence the lexical
  pass misses things that matter.
- **`findStale` is an age threshold, under the spec's "half-life" name.** `updatedAt`
  is the only timestamp a memory carries and there is no access-frequency signal to
  decay against, so a real decay model would be arithmetic dressed up as evidence. Stale
  means "a human should look at this", not "this is wrong" — an old memory is often
  still true, which is the other reason nothing here deletes.

Also: cross-type pairs are never proposed as duplicates (the same sentence filed under
`user` and under `project` says two different things about who it describes), and a
memory proposed for removal as a duplicate is not also listed as stale — one
recommendation per memory, or the output stops being a worklist.

_Verify, done:_ 11 tests (633 total green, `tsc` clean), covering the threshold in both
directions, the staleness boundary, deterministic keep/drop regardless of input order,
one-recommendation-per-memory, and that `garden` leaves its input untouched.
**Mutation-checked:** flipping the staleness comparison to `<=` fails 1 test; halving
the duplicate threshold fails 1.

**The first real CLI run against a seeded store found a bug the unit tests had not:**
two byte-identical memories reported `duplicates: none`, because the memory's *name* —
the store's file key, which duplicates always differ by — was being scored as part of
its text. Fixed to compare description + content only, with a regression test pinning
it. Worth noting as the concrete case for running the thing rather than trusting a
green suite. The seeded store and the `~/.freecode/projects/` directory it created were
removed afterward, confirmed by re-listing.

_Not done:_ wiring `garden` as an end-of-run step, since there is no Tier A run to wire
it into yet (Phases 0-3). That is one call in the run's teardown when it exists.

**Phase 5 — Permission profile + worktree isolation (§4.8).**
Could technically land as early as Phase 1, but sequenced last on purpose: get the
budget/gate/detach mechanics *proven correct in a trusted, hand-reviewed local setting*
before locking in the exact shape of the safety boundary around it. Locking the
permission profile too early risks designing it against assumptions Phase 1-2 will
falsify.

Realistic scope: Phases 0-2 are the bulk of the net-new engineering (the detach/crash-
recovery logic in particular has no existing FreeCode equivalent to lean on). Phases 3-5
are each smaller.

---

## 9. Defaults, and why they are stricter than both reference projects

`autonomous.start` requires explicit `budget` and `verifyCommand` — **no defaults that
silently let a run start.** Contrast Prime Agent, which has sane defaults
(`DEFAULT_AUTONOMOUS_LIMITS`) precisely because OAuth makes an accidentally-generous
default low-stakes. Ours are not low-stakes (§0), so there is no default budget at all —
the user must state one, every time, and see the cost estimate (§4.9) before it starts.

Suggested *ceiling* values, shown as pre-filled but editable in the UI (not silent
defaults): `maxTurns: 20`, `maxTokens: 150_000` (excluding cache reads), `timeoutMs: 1h`,
`maxUsd`: **required, no ceiling suggested** — cost varies too much by model/provider to
guess responsibly; leave it blank and force the user to type a number they've thought
about.

Network access under the `unattended` profile is **off** unless the verify command
itself needs it (e.g., an integration test hitting a local server is fine — outbound
internet is not, by default). Pushing/PR-opening is never automatic, ever, in any
version of this spec — not a v1-vs-v2 distinction, a permanent one, matching Layer 1's
treatment of global-scope harness writes.

---

## 10. Open questions

1. **Notification on completion.** jcode emails/SMS-notifies (`SAFETY_SYSTEM.md`,
   referenced but not read in depth for this spec). FreeCode has no notification channel
   today. Does `hooks/` (a `Notification` hook already exists per the hooks table in
   CLAUDE.md) cover this, or does it need a new delivery mechanism? Needs its own look
   before Phase 3 ships.
2. **Should `maxUsd` block on unknown pricing?** Some providers/models may not have
   published per-token pricing wired into FreeCode yet. If pricing is unknown, should
   the run refuse to start, or fall back to a token-only budget with a loud warning?
   Leaning "refuse to start" given §0's cost stance, not decided.
3. **Worktree cleanup policy.** After a run completes and is reviewed, who deletes the
   worktree — the user, explicitly, or does `autonomous.review` offer a cleanup action?
   Leaving a growing pile of `git worktree`s is a real, if minor, footgun.
4. **Does `session.fork` (existing IPC method) make more sense as the run's starting
   point than a fresh `SessionManager.start`?** Forking would inherit the user's current
   context; starting fresh would not. Prime Agent's `/autonomous` operates on the
   *current* session, which argues for fork. Undecided; affects §4.9's `worktree?`
   default interaction.

---

## 11. The thing this spec deliberately does not do — Tier B / Ambient

The obvious next step, once Tier A is trusted, is: why does a human have to start it at
all? Let the agent notice its own memory graph is stale, or that a CI run just failed,
and start a bounded run itself. That is Tier B, and per §0 and §3.3, **jcode's own
design for this is unshipped**. Two independent, unresolved FreeCode-specific blockers
before it's even worth designing in detail:

1. **No always-on host.** §4.4 solves "survive the terminal closing" for a run that's
   already started. Tier B needs something resident *before* any run starts, to decide
   *when* to start one — that's the `freecode serve` question deferred in §4.4(b), and
   it needs an answer (systemd unit? launchd plist? just "keep a terminal tab open
   forever"?) before Tier B's scheduling logic is even meaningful to design.
2. **No free compute.** Every ambient wake costs real money with no OAuth backstop
   (§0). jcode's adaptive interval algorithm (rate-limit headroom, user-activity
   detection) exists to not waste a subscription's rate-limit window — it has no
   equivalent reason to exist against a metered API bill, where the right answer might
   simply be "don't, unless the user sets an explicit recurring budget," which is a much
   smaller and less interesting scheduler than the one jcode designed.

If Tier B is ever built, its prerequisites are: Tier A has run unattended, unsupervised,
enough times that its budget/gate/audit machinery is trusted rather than merely tested;
an answer to the resident-host question; and an explicit, opt-in, user-set recurring
budget rather than any form of self-scheduling the agent proposes on its own. Build
those, in that order. Do not start with the self-scheduling loop — it is the part with
the least ability to notice it's gone wrong before real cost or damage has accumulated.

---

## References

- Prime Agent `/autonomous`: `packages/coding-agent/src/core/autonomous.ts`
  (budget model `:48-55`, gates `:273-348`, continuation prompt `:45-46`)
- jcode `overnight`: `crates/jcode-overnight-core/src/lib.rs`
  (manifest `:46-82`, task cards `:203-233`, HTML report `:569-699`)
- jcode `Ambient Mode` (unshipped design): `docs/AMBIENT_MODE.md`
- Companion spec (Layer 1): `docs/superpowers/specs/2026-08-08-continual-harness-design.md`
- FreeCode permission rules: `docs/superpowers/specs/2026-07-18-permission-rules.md`
- FreeCode memory graph: `docs/superpowers/specs/2026-07-26-memory-knowledge-graph.md`
- Tool/IPC conventions: `CLAUDE.md` §"Adding a tool", `packages/shared/src/ipc/protocol.ts`
