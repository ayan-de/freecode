// =============================================================================
// Continual Harness Types
// PRIMARY: the data model for agent-editable harness state (prompt notes,
// memories, skills, subagent specs) — separate from memory/mem-types.ts
// because a HarnessEntry carries version/provenance that MemoryEntry does not.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md, §3.1/§4.3
// Phase 0 (measurement), Phase 1 (store + injection), Phase 2 (this file also
// carries the distillation types — planner/apply/rollback, the `distill` tool).
// "Distill" is this project's name for what the spec's prior art (prime-agent)
// calls "refine": reviewing a trajectory and proposing small, evidence-backed
// edits to the harness. Same mechanism, renamed on purpose — see the Phase 2
// entry in the spec's phasing section for why.
// =============================================================================

export type HarnessEntryKind = "prompt" | "memory" | "skill" | "subagent";
export type DistillAction = "create" | "update" | "delete";
export type HarnessScope = "local" | "global";

export const HARNESS_KINDS: readonly HarnessEntryKind[] = [
  "prompt",
  "memory",
  "skill",
  "subagent",
];

export interface HarnessEntry {
  id: string;
  kind: HarnessEntryKind;
  title: string;
  content: string;
  /** Grouping label, e.g. "general". Not a filesystem path. */
  path: string;
  scope: HarnessScope;
  /** How to call it — populated for `skill` entries starting Phase 2. */
  reference: Record<string, unknown>;
  /** Input contract — populated for `skill` entries starting Phase 2. */
  arguments: Record<string, unknown>;
  metadata: Record<string, unknown>;
  /** Always "distill" once produced by a distillation; "test"/"hand-written" otherwise. */
  source: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Phase 2 — distillation: plan (LLM, no mutation) / apply (mutation) / rollback
// ---------------------------------------------------------------------------

export interface DistillEdit {
  action: DistillAction;
  kind: HarnessEntryKind;
  /** Required for update/delete; optional for create (derived from title). */
  id?: string;
  title?: string;
  content?: string;
  path?: string;
  reference?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  reason?: string;
}

/** What the planner produces: a set of proposed edits, not yet applied. */
export interface DistillProposal {
  summary: string;
  rationale: string;
  edits: DistillEdit[];
  expectedOutcome: string;
}

export interface AppliedDistillEdit extends DistillEdit {
  id: string;
  before?: HarnessEntry;
  after?: HarnessEntry;
  applied: boolean;
  error?: string;
}

/**
 * What apply() produces, and what the audit log (HarnessState.distillations)
 * stores in full — not a lighter summary. A rollback needs each edit's
 * before/after snapshot to compute its inverse (apply.ts's rollbackProposal),
 * so the audit log has to carry appliedEdits, not just a one-line trigger —
 * a summary-only log would make `rollback_id` unimplementable.
 */
export interface DistillResult {
  id: string;
  summary: string;
  rationale: string;
  expectedOutcome: string;
  appliedEdits: AppliedDistillEdit[];
  rollbackOf?: string;
  scope: HarnessScope;
  createdAt: string;
}

export interface HarnessState {
  schema: number;
  entries: Record<HarnessEntryKind, Record<string, HarnessEntry>>;
  /** Append-only audit log of every distillation and rollback ever applied. */
  distillations: DistillResult[];
}
