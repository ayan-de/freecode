import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDistillationProposal,
  rollbackProposal,
  newDistillationId,
} from "./apply.js";
import { emptyHarnessState } from "./store.js";
import type { DistillProposal, HarnessState } from "./types.js";

// Content-relevant fields only: title/content/path/reference/arguments/metadata
// are what actually reach the prompt (inject.ts) and are the fields a rollback
// promises to restore exactly. version/updatedAt/source correctly keep moving
// forward through a rollback — the audit trail is append-only by design (§3.5
// of the spec: "a rollback is itself recorded as a refinement"), so a rolled-
// back entry legitimately ends up at a higher version with a fresh timestamp
// even though its content matches what was there before the original edit.
function contentOf(entry: {
  title: string;
  content: string;
  path: string;
  reference: unknown;
  arguments: unknown;
  metadata: unknown;
}) {
  const { title, content, path, reference, arguments: args, metadata } = entry;
  return { title, content, path, reference, arguments: args, metadata };
}

function contentFields(state: HarnessState): unknown {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [kind, records] of Object.entries(state.entries)) {
    out[kind] = {};
    for (const [id, entry] of Object.entries(records)) {
      out[kind][id] = contentOf(entry);
    }
  }
  return out;
}

function stateWith(
  entries: Record<string, { title: string; content: string }>,
): HarnessState {
  const state = emptyHarnessState();
  for (const [id, { title, content }] of Object.entries(entries)) {
    state.entries.prompt[id] = {
      id,
      kind: "prompt",
      title,
      content,
      path: "general",
      scope: "local",
      reference: {},
      arguments: {},
      metadata: {},
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    };
  }
  return state;
}

test("create adds a new entry and logs a distillation event", () => {
  const state = emptyHarnessState();
  const proposal: DistillProposal = {
    summary: "Learned the test command",
    rationale: "The user corrected me twice",
    expectedOutcome: "I use the right command next time",
    edits: [
      {
        action: "create",
        kind: "prompt",
        title: "Use pnpm test",
        content: "This repo uses pnpm, not npm.",
      },
    ],
  };
  const result = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });

  assert.equal(result.appliedEdits.length, 1);
  assert.equal(result.appliedEdits[0].applied, true);
  const created = Object.values(state.entries.prompt)[0];
  assert.equal(created.title, "Use pnpm test");
  assert.equal(created.version, 1);
  assert.equal(created.source, "distill");
  assert.equal(state.distillations.length, 1);
  // The audit log entry IS the DistillResult — appliedEdits carries the
  // detail, there's no separate "changes" summary field to duplicate it.
  assert.equal(state.distillations[0].appliedEdits[0].applied, true);
  assert.equal(state.distillations[0].appliedEdits[0].id, created.id);
});

test("create derives a slug id from the title when none is given", () => {
  const state = emptyHarnessState();
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "create",
        kind: "prompt",
        title: "Always run PNPM Test!",
        content: "content",
      },
    ],
  };
  applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.ok(Object.keys(state.entries.prompt).includes("always_run_pnpm_test"));
});

test("update bumps the version and preserves createdAt", () => {
  const state = stateWith({
    note: { title: "old title", content: "old content" },
  });
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "update",
        kind: "prompt",
        id: "note",
        title: "new title",
        content: "new content",
      },
    ],
  };
  applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  const updated = state.entries.prompt.note;
  assert.equal(updated.title, "new title");
  assert.equal(updated.version, 2);
  assert.equal(updated.createdAt, "2026-01-01T00:00:00.000Z");
});

test("delete removes the entry", () => {
  const state = stateWith({ note: { title: "t", content: "c" } });
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [{ action: "delete", kind: "prompt", id: "note" }],
  };
  applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.equal(Object.keys(state.entries.prompt).length, 0);
});

test("create on an existing id fails without touching the entry", () => {
  const state = stateWith({ note: { title: "original", content: "c" } });
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "create",
        kind: "prompt",
        id: "note",
        title: "clobber",
        content: "c2",
      },
    ],
  };
  const result = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.equal(result.appliedEdits[0].applied, false);
  assert.equal(result.appliedEdits[0].error, "entry already exists");
  assert.equal(state.entries.prompt.note.title, "original");
});

test("update on a missing id fails", () => {
  const state = emptyHarnessState();
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "update",
        kind: "prompt",
        id: "ghost",
        title: "t",
        content: "c",
      },
    ],
  };
  const result = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.equal(result.appliedEdits[0].applied, false);
  assert.equal(result.appliedEdits[0].error, "entry not found");
});

test("delete on a missing id fails", () => {
  const state = emptyHarnessState();
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [{ action: "delete", kind: "prompt", id: "ghost" }],
  };
  const result = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.equal(result.appliedEdits[0].applied, false);
  assert.equal(result.appliedEdits[0].error, "entry not found");
});

test("an edit that changed since the baseline snapshot is rejected, not clobbered", () => {
  const baseline = stateWith({ note: { title: "v1", content: "c" } });
  const live = stateWith({
    note: { title: "v2 — someone else edited it", content: "c" },
  });
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "update",
        kind: "prompt",
        id: "note",
        title: "v3 from stale plan",
        content: "c",
      },
    ],
  };
  const result = applyDistillationProposal(live, proposal, {
    id: newDistillationId(),
    scope: "local",
    baselineState: baseline,
  });
  assert.equal(result.appliedEdits[0].applied, false);
  assert.equal(
    result.appliedEdits[0].error,
    "entry changed during distillation planning",
  );
  assert.equal(live.entries.prompt.note.title, "v2 — someone else edited it");
});

test("rejects an unsupported action or kind rather than applying it", () => {
  const state = emptyHarnessState();
  const proposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "overwrite" as never,
        kind: "prompt" as const,
        id: "x",
        title: "t",
        content: "c",
      },
      {
        action: "create" as const,
        kind: "unknown-kind" as never,
        title: "t",
        content: "c",
      },
    ],
  } satisfies DistillProposal;
  const result = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.equal(
    result.appliedEdits.every((e) => !e.applied),
    true,
  );
});

test("rollback round-trip: apply then roll back is byte-identical to the start — the highest-value test here", () => {
  const state = stateWith({
    keep: { title: "unrelated, untouched", content: "c" },
    edited: { title: "before edit", content: "before content" },
  });
  const before = JSON.parse(JSON.stringify(state));

  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "update",
        kind: "prompt",
        id: "edited",
        title: "after edit",
        content: "after content",
      },
      {
        action: "create",
        kind: "prompt",
        id: "brand-new",
        title: "new",
        content: "new content",
      },
    ],
  };
  const applyResult = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.notDeepEqual(
    state,
    before,
    "sanity: the apply actually changed something",
  );

  const rollback = rollbackProposal(applyResult);
  applyDistillationProposal(state, rollback, {
    id: newDistillationId(),
    scope: "local",
    rollbackOf: applyResult.id,
  });

  // Content, not the full entry: version/updatedAt/source correctly advance
  // through a rollback rather than rewinding (see contentFields' comment).
  assert.deepEqual(contentFields(state), contentFields(before));
  assert.equal(state.distillations.length, before.distillations.length + 2);
});

test("rollback of a multi-edit proposal touching the same entry twice replays in reverse order", () => {
  const state = stateWith({ note: { title: "v1", content: "c1" } });
  const before = JSON.parse(JSON.stringify(state));

  // Two edits to the SAME entry within one proposal: v1 -> v2 -> v3.
  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      {
        action: "update",
        kind: "prompt",
        id: "note",
        title: "v2",
        content: "c2",
      },
      {
        action: "update",
        kind: "prompt",
        id: "note",
        title: "v3",
        content: "c3",
      },
    ],
  };
  const applyResult = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.equal(state.entries.prompt.note.title, "v3");

  const rollback = rollbackProposal(applyResult);
  applyDistillationProposal(state, rollback, {
    id: newDistillationId(),
    scope: "local",
    rollbackOf: applyResult.id,
  });

  assert.deepEqual(contentFields(state), contentFields(before));
});

test("rollbackProposal recreates a deleted entry and deletes a created one", () => {
  const state = stateWith({
    doomed: { title: "will be deleted", content: "c" },
  });
  const before = JSON.parse(JSON.stringify(state));

  const proposal: DistillProposal = {
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    edits: [
      { action: "delete", kind: "prompt", id: "doomed" },
      {
        action: "create",
        kind: "prompt",
        id: "fresh",
        title: "fresh",
        content: "c",
      },
    ],
  };
  const applyResult = applyDistillationProposal(state, proposal, {
    id: newDistillationId(),
    scope: "local",
  });
  assert.equal(Object.keys(state.entries.prompt).sort().join(","), "fresh");

  const rollback = rollbackProposal(applyResult);
  applyDistillationProposal(state, rollback, {
    id: newDistillationId(),
    scope: "local",
    rollbackOf: applyResult.id,
  });

  assert.deepEqual(contentFields(state), contentFields(before));
});

test("rollbackProposal is a no-op proposal when the target had nothing applied", () => {
  const target = {
    id: "d1",
    summary: "s",
    rationale: "r",
    expectedOutcome: "o",
    appliedEdits: [],
    scope: "local" as const,
  };
  const rollback = rollbackProposal(target);
  assert.equal(rollback.edits.length, 0);
});
