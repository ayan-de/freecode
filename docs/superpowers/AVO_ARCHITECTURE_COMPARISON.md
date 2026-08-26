# AVO vs FreeCode — What's Implemented, What's Lacking

> **Status:** Analysis, not a spec
> **Date:** 2026-08-26
> **Sources:** NVIDIA AVO paper (arXiv:2603.24517v1, GPU kernel evolution) + NVIDIA dev blog
> ("AVO reaches 100% on ARC-AGI-3") — same architecture, second source confirms it's a
> general-purpose long-horizon agent harness, not GPU-specific.
> **Related:** `docs/superpowers/specs/2026-08-10-autonomous-runs-design.md` (Tier A bounded
> autonomous runs) already covers part of the gap below — cross-referenced per section.

---

## 1. What AVO actually is

AVO replaces the classical evolutionary-search variation operator — `Vary(P) = Generate(Sample(P))`,
where an LLM only fills the `Generate` slot inside a framework-controlled pipeline — with a
single autonomous agent call: `Vary(P) = Agent(P, K, f)`. The agent gets the full lineage of
prior solutions and scores (`P`), a knowledge base (`K`), and a scoring function (`f`), and
decides everything itself: what to consult, what to edit, when to test, when to revise
strategy. Applied to attention-kernel optimization on Blackwell GPUs, it beat cuDNN and
FlashAttention-4 after 7 days of unattended evolution across 40 committed versions. The
dev-blog piece confirms the same loop, unmodified, also hits 100% on ARC-AGI-3 — a text-grid
game domain, nothing like GPU kernels. The claimed thesis: the **harness** (memory + tool
grounding + supervisor), not the base model, is what produces frontier results.

Five components, per Figure 2 of the paper:

1. **Population / lineage** — every committed solution + its score, kept as context.
2. **Knowledge base** — domain docs (CUDA/PTX guides, reference kernels) the agent consults
   at will, not on a schedule.
3. **Main agent loop** — plan → implement → evaluate → (bug-fix if needed), self-directed.
4. **Scoring function** — external, objective, gates what gets committed (correctness first,
   then throughput; a regression is never committed).
5. **Supervisor** — a separate process watching the *whole trajectory*, not just the last few
   turns, that detects stall (no progress) or unproductive cycling (repeated failed edits) and
   **redirects strategy** — proposes new directions, doesn't just flag the problem.

---

## 2. Side-by-side

| AVO component | FreeCode equivalent | Verdict |
| --- | --- | --- |
| Agent loop (plan/implement/evaluate/debug, tool use) | `agent/loop.ts`, `tools/orchestrator.ts` | **Implemented.** Same shape, general-purpose. |
| Persistent memory across turns | `memory/mem-store.ts`, `memory/graph/` | **Implemented**, and more general (BM25 + graph + knowledge-graph clustering) than AVO's flat conversation history. |
| Knowledge base the agent consults on its own | `skills/`, `memory/mem-query.ts`, project file reads | **Implemented.** Skills + memory retrieval already let the agent pull in domain material unprompted. |
| Tool grounding (compiler/profiler/game-API as feedback) | `tools/` (bash, lsp, grep, etc.), MCP client | **Implemented.** Tools are the feedback channel already; nothing AVO-specific to add here. |
| Stagnation/oscillation **detection** | `effect/loop-health.ts` (repeated identical calls, no file changes across turns, same-file edit loops) | **Implemented**, but detection only. |
| Stagnation **recovery** — a supervisor that reviews the full trajectory and forces a strategy change | Nothing. `loop-health.ts` flags a state; nothing consumes the flag to redirect. | **Lacking.** This is the one piece AVO explicitly credits for surviving 7 days unattended. |
| Lineage-as-context: compare candidate N's measured results against N-3's, not just chat history | Memory graph can hold anything, but nothing structures a "candidate + score" timeline for the agent to diff against | **Lacking**, narrow. Only matters for a workflow that produces *scored variants* (see §3). |
| Scoring function gating what gets kept (commit only if it passes + matches/beats best) | Nothing today. `docs/superpowers/specs/2026-08-23-eval-harness.md` scores *agent runs* for quality regression testing, not *code variants* for auto-keep/discard. | **Lacking**, and it's a different primitive from the eval harness — see §3. |
| Long-running unattended execution, budget-capped, surviving terminal close | **Designed, not built.** `specs/2026-08-10-autonomous-runs-design.md` — Tier A (bounded run) is Phase 0 of 5, nothing shipped yet. | **Designed, not implemented.** Not a gap this doc introduces; already tracked. |
| Continuous multi-day evolution loop with self-triggered commits | Nothing, and the existing autonomous-runs spec is explicitly single-task-to-completion, not open-ended variant generation | **Lacking**, and out of scope for the existing spec (see §4.7 of that spec: "the run just doesn't have a Layer 1-provided harness... behaves as a longer, budget-gated ordinary session" — it's not built for repeated scored iteration). |

---

## 3. The two real gaps, precisely

Everything AVO does that looks new at first glance is actually two distinct, narrow gaps —
not one "build an AVO clone" project:

**Gap A — Supervisor that redirects, not just detects.**
`loop-health.ts` can already tell you "this agent is stuck." Nothing acts on that signal beyond
whatever the in-loop agent decides to do next turn on its own. AVO's supervisor is a *separate*
process (their Figure 2 draws it outside the main loop) that reviews the accumulated trajectory
periodically and injects new candidate directions when it sees a stall or an unproductive cycle.
This is a bolt-on to the existing loop-health signal, not a new subsystem: consume the existing
flag, add a call that asks a model (or even a cheap heuristic) "given this trajectory, what's a
different strategy to try," and feed that into the next continuation prompt.

**Gap B — Scored-variant lineage with auto-gated commits.**
This only matters if FreeCode ever wants a mode that generates *multiple candidate
implementations* of the same thing and automatically keeps the best-scoring one — e.g.,
"try 5 different approaches to this function, keep the fastest one that passes tests." Nothing
in the codebase does this today, and it's genuinely different from the autonomous-runs spec,
which is about *one* task run to completion under a budget, not repeated variant generation
against an objective score. If this is wanted, it's a new primitive: `Vary(P) = Agent(P, K, f)`
maps onto "an agent loop that receives prior attempts + their scores as context and only
commits if it beats the incumbent" — small, but distinct from everything else in this table.

---

## 4. What NOT to build from this

- **A GPU-kernel-specific anything.** The paper's domain (attention kernels, Blackwell,
  warp-register allocation) has zero relevance to FreeCode as a coding assistant. The dev-blog
  piece exists specifically to prove the *harness* generalizes away from that domain — take the
  harness lessons, not the domain content.
- **Population-based evolutionary search (islands, MAP-Elites).** AVO itself only evaluates the
  single-lineage case and calls population strategies "orthogonal, future work." Nothing here
  argues for building archive/island management into FreeCode.
- **Tier B / ambient self-scheduling.** Already explicitly deferred in the existing autonomous-runs
  spec (§11), for FreeCode-specific reasons (no OAuth free tier, no resident daemon) that apply
  identically here. AVO's 7-day *continuous* run is closer to Tier B than Tier A — don't let this
  analysis be read as an argument to build Tier B; it isn't.

---

## 5. Bottom line

FreeCode already implements the general shape of AVO's agent loop, memory, and tool-grounding —
that part is not a gap, it's confirmation the existing architecture direction is sound. The one
concrete, worth-scoping-later gap is **Gap A** (supervisor-driven strategy redirection on top of
the existing `loop-health.ts` signal) since it's small, sits directly on shipped code, and is the
mechanism both AVO sources credit for surviving long unattended runs without human intervention.
**Gap B** (scored-variant auto-commit) is real but should stay unbuilt until there's an actual
use case that wants "generate N variants, keep the best," since nothing in FreeCode today
produces multiple competing implementations of the same unit of work.
