// =============================================================================
// Continual Harness Apply — mutate HarnessState from a DistillProposal
// PRIMARY: applyDistillationProposal (mutation) and rollbackProposal (derives
// the inverse of an already-applied result). Separate from planner.ts because
// the LLM call in planning can take seconds, during which another session may
// have written the same store — apply() re-validates against a baseline
// snapshot taken before planning rather than trusting it's still current.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md, §3.3/§3.5
// Direct port of prime-agent's applyRefinementProposal/rollbackProposal/
// validateEdit (refinement.ts:664-836), adapted:
// - No Python skill reference/arguments requirement — FreeCode skills are
//   markdown+frontmatter (skills/types.ts), not Python calls. A `skill` entry
//   needs only title+content like every other kind, for v1.
// - No base_system_prompt id rejection: FreeCode's base prompt
//   (session/prompt.ts) is never represented as a harness entry at all, so
//   there is no id a distillation could target to reach it — the attack
//   prime-agent's check defends against doesn't exist here by construction.
// =============================================================================

import { randomUUID } from "crypto";
import {
  HARNESS_KINDS,
  type HarnessEntry,
  type HarnessScope,
  type HarnessState,
} from "./types.js";
import type {
  AppliedDistillEdit,
  DistillEdit,
  DistillProposal,
  DistillResult,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function slug(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function cloneEntry(entry: HarnessEntry | undefined): HarnessEntry | undefined {
  return entry ? JSON.parse(JSON.stringify(entry)) : undefined;
}

function validateEdit(edit: DistillEdit): string | undefined {
  if (!["create", "update", "delete"].includes(edit.action)) {
    return `unsupported action ${String(edit.action)}`;
  }
  if (!HARNESS_KINDS.includes(edit.kind)) {
    return `unsupported kind ${String(edit.kind)}`;
  }
  if (edit.action !== "create" && !edit.id) {
    return `${edit.action} requires id`;
  }
  if (edit.action !== "delete" && (!edit.title || !edit.content)) {
    return `${edit.action} requires title and content`;
  }
  return undefined;
}

export interface ApplyOptions {
  id: string;
  scope: HarnessScope;
  rollbackOf?: string;
  /** State as it was when planning started, for the optimistic-concurrency check. */
  baselineState?: HarnessState;
}

/**
 * Apply a proposal's edits to `state` in place. Per-edit failure, not
 * per-transaction: one stale or invalid edit does not abort the batch, so a
 * proposal with 4 good edits and 1 bad one still lands the 4.
 */
export function applyDistillationProposal(
  state: HarnessState,
  proposal: DistillProposal,
  options: ApplyOptions,
): DistillResult {
  const appliedEdits: AppliedDistillEdit[] = [];
  const touchedThisProposal = new Set<string>();

  for (const rawEdit of proposal.edits) {
    const computedId =
      rawEdit.id ??
      (rawEdit.action === "create"
        ? slug(rawEdit.title ?? rawEdit.kind, rawEdit.kind)
        : undefined);
    const id = computedId ?? "";
    const edit: DistillEdit = { ...rawEdit, id };

    const validationError = validateEdit(edit);
    if (validationError) {
      appliedEdits.push({
        ...edit,
        id,
        applied: false,
        error: validationError,
      });
      continue;
    }

    const records = state.entries[edit.kind];
    const before = cloneEntry(records[id]);
    const entryKey = `${edit.kind}:${id}`;

    // Optimistic concurrency: if this entry changed since the baseline
    // snapshot taken before the LLM call started, and this proposal hasn't
    // already touched it itself, reject rather than silently clobber a write
    // that happened while planning was in flight.
    if (options.baselineState && !touchedThisProposal.has(entryKey)) {
      const baseline = cloneEntry(options.baselineState.entries[edit.kind][id]);
      if (JSON.stringify(before) !== JSON.stringify(baseline)) {
        appliedEdits.push({
          ...edit,
          id,
          before,
          applied: false,
          error: "entry changed during distillation planning",
        });
        continue;
      }
    }

    if (edit.action === "delete") {
      if (!before) {
        appliedEdits.push({
          ...edit,
          id,
          applied: false,
          error: "entry not found",
        });
        continue;
      }
      delete records[id];
      touchedThisProposal.add(entryKey);
      appliedEdits.push({ ...edit, id, before, applied: true });
      continue;
    }
    if (edit.action === "create" && before) {
      appliedEdits.push({
        ...edit,
        id,
        before,
        applied: false,
        error: "entry already exists",
      });
      continue;
    }
    if (edit.action === "update" && !before) {
      appliedEdits.push({
        ...edit,
        id,
        applied: false,
        error: "entry not found",
      });
      continue;
    }

    const createdAt = before?.createdAt ?? now();
    const version = before ? before.version + 1 : 1;
    const after: HarnessEntry = {
      id,
      kind: edit.kind,
      title: edit.title ?? before?.title ?? id,
      content: edit.content ?? before?.content ?? "",
      path: edit.path ?? before?.path ?? "general",
      scope: before?.scope ?? options.scope,
      reference: edit.reference ?? before?.reference ?? {},
      arguments: edit.arguments ?? before?.arguments ?? {},
      metadata: edit.metadata ?? before?.metadata ?? {},
      source: "distill",
      createdAt,
      updatedAt: now(),
      version,
    };
    records[id] = after;
    touchedThisProposal.add(entryKey);
    appliedEdits.push({
      ...edit,
      id,
      before,
      after: cloneEntry(after),
      applied: true,
    });
  }

  const result: DistillResult = {
    id: options.id,
    summary: proposal.summary,
    rationale: proposal.rationale,
    expectedOutcome: proposal.expectedOutcome,
    appliedEdits,
    rollbackOf: options.rollbackOf,
    scope: options.scope,
    createdAt: now(),
  };
  // The audit log IS the result, not a lighter summary of it — see
  // DistillResult's doc comment for why rollback needs this.
  state.distillations.push(result);
  return result;
}

/**
 * Build the inverse proposal for an already-applied DistillResult: an update
 * back to `before`, a create from `before` if the edit deleted it, or a
 * delete if the edit created it. Walked in reverse — edits in one proposal
 * can touch the same entry twice, and replaying the inverse forward would
 * land on the wrong intermediate state.
 */
export function rollbackProposal(target: DistillResult): DistillProposal {
  const edits: DistillEdit[] = [];
  for (const edit of [...target.appliedEdits].reverse()) {
    if (!edit.applied) continue;
    if (edit.before) {
      edits.push({
        action: edit.after ? "update" : "create",
        kind: edit.kind,
        id: edit.id,
        title: edit.before.title,
        content: edit.before.content,
        path: edit.before.path,
        reference: edit.before.reference,
        arguments: edit.before.arguments,
        metadata: edit.before.metadata,
        reason: `Rollback ${target.id}`,
      });
    } else if (edit.after) {
      edits.push({
        action: "delete",
        kind: edit.kind,
        id: edit.id,
        reason: `Rollback ${target.id}`,
      });
    }
  }
  return {
    summary: `Rollback distillation ${target.id}`,
    rationale: `Restores harness state to before distillation ${target.id}.`,
    expectedOutcome: "The reverted edits no longer affect future prompts.",
    edits,
  };
}

export function newDistillationId(): string {
  return `distill_${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17)}_${randomUUID().slice(0, 8)}`;
}
