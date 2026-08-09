// =============================================================================
// Continual Harness Types
// PRIMARY: the data model for agent-editable harness state (prompt notes,
// memories, skills, subagent specs) — separate from memory/mem-types.ts
// because a HarnessEntry carries version/provenance that MemoryEntry does not.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md, §3.1/§4.3
// Phase 0 (measurement) and Phase 1 (this file — store + injection, no
// refinement) only. No planner/apply/rollback logic yet: nothing constructs a
// HarnessEntry from a live edit until Phase 2.
// =============================================================================

export type RefinementKind = "prompt" | "memory" | "skill" | "subagent";
export type RefinementAction = "create" | "update" | "delete";
export type HarnessScope = "local" | "global";

export const HARNESS_KINDS: readonly RefinementKind[] = [
  "prompt",
  "memory",
  "skill",
  "subagent",
];

export interface HarnessEntry {
  id: string;
  kind: RefinementKind;
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
  /** Always "refine" once Phase 2 lands; reserved field until then. */
  source: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HarnessRefinementEvent {
  id: string;
  trigger: string;
  changes: string[];
  evidence: string;
  outcome: string;
  createdAt: string;
}

export interface HarnessState {
  schema: number;
  entries: Record<RefinementKind, Record<string, HarnessEntry>>;
  refinements: HarnessRefinementEvent[];
}
