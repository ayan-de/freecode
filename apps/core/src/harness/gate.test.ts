// The Phase 4 gate. Every test writes a full autoDistill block into a tmp
// project's .freecode/settings.json: project scope is consulted first and
// wins field-by-field, so a fully-specified block makes the result
// independent of whatever the developer happens to have in ~/.freecode.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markDistilled,
  resetDistillGate,
  reviewAutoDistill,
  shouldConsiderDistill,
} from "./gate.js";
import { loadHarnessSettings } from "./settings.js";
import { emptyHarnessState } from "./store.js";

const TRANSCRIPT = "x".repeat(500);

interface AutoOverrides {
  enabled?: boolean;
  turnInterval?: number;
  compact?: boolean;
  cooldownMs?: number;
}

function project(
  harnessEnabled: boolean,
  auto: AutoOverrides = {},
): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "harness-gate-"));
  mkdirSync(join(root, ".freecode"), { recursive: true });
  writeFileSync(
    join(root, ".freecode", "settings.json"),
    JSON.stringify({
      harness: {
        enabled: harnessEnabled,
        autoDistill: {
          enabled: true,
          turnInterval: 25,
          compact: true,
          cooldownMs: 20 * 60 * 1000,
          ...auto,
        },
      },
    }),
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function consider(
  root: string,
  over: { sessionId?: string; turns?: number; compacted?: boolean; transcript?: string } = {},
) {
  return shouldConsiderDistill({
    sessionId: over.sessionId ?? "s1",
    projectRoot: root,
    transcript: over.transcript ?? TRANSCRIPT,
    turns: over.turns ?? 0,
    compacted: over.compacted ?? false,
  });
}

// ---------------------------------------------------------------------------
// Gate 1 — the free policy check
// ---------------------------------------------------------------------------

test("automatic distillation is off unless both switches are on", () => {
  resetDistillGate();
  // harness off, autoDistill on
  const a = project(false, { enabled: true });
  try {
    assert.equal(consider(a.root, { turns: 100 }).consider, false);
  } finally {
    a.cleanup();
  }
  // harness on, autoDistill off — the Phase 4 default
  const b = project(true, { enabled: false });
  try {
    assert.equal(consider(b.root, { turns: 100 }).consider, false);
  } finally {
    b.cleanup();
  }
});

test("autoDistill.enabled defaults to off even when harness is on", () => {
  const root = mkdtempSync(join(tmpdir(), "harness-gate-default-"));
  mkdirSync(join(root, ".freecode"), { recursive: true });
  writeFileSync(
    join(root, ".freecode", "settings.json"),
    JSON.stringify({ harness: { enabled: true } }),
  );
  try {
    const settings = loadHarnessSettings(root);
    assert.equal(settings.enabled, true);
    assert.equal(settings.autoDistill.enabled, false);
    assert.equal(settings.autoDistill.turnInterval, 25);
    assert.equal(settings.autoDistill.compact, true);
    assert.equal(settings.autoDistill.cooldownMs, 20 * 60 * 1000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the turn interval throttles until it is reached", () => {
  resetDistillGate();
  const { root, cleanup } = project(true, { turnInterval: 10 });
  try {
    assert.equal(consider(root, { turns: 9 }).consider, false);
    assert.equal(consider(root, { turns: 10 }).consider, true);
  } finally {
    cleanup();
  }
});

test("a short transcript never distills, however many turns it took", () => {
  resetDistillGate();
  const { root, cleanup } = project(true, { turnInterval: 1 });
  try {
    assert.equal(
      consider(root, { turns: 100, transcript: "too short" }).consider,
      false,
    );
  } finally {
    cleanup();
  }
});

test("markDistilled restarts the interval from the current turn count", () => {
  resetDistillGate();
  const { root, cleanup } = project(true, { turnInterval: 10, cooldownMs: 0 });
  try {
    assert.equal(consider(root, { turns: 10 }).consider, true);
    markDistilled("s1", 10);
    assert.equal(consider(root, { turns: 15 }).consider, false);
    assert.equal(consider(root, { turns: 20 }).consider, true);
  } finally {
    cleanup();
  }
});

test("the cooldown blocks a second distillation even past the interval", () => {
  resetDistillGate();
  const { root, cleanup } = project(true, { turnInterval: 1, cooldownMs: 60_000 });
  try {
    markDistilled("s1", 0);
    const decision = consider(root, { turns: 50 });
    assert.equal(decision.consider, false);
    assert.match(decision.reason, /cooldown/);
  } finally {
    cleanup();
  }
});

test("compaction bypasses the turn interval but not the cooldown", () => {
  resetDistillGate();
  const { root, cleanup } = project(true, { turnInterval: 999, cooldownMs: 60_000 });
  try {
    assert.equal(consider(root, { turns: 1, compacted: true }).consider, true);
    markDistilled("s1", 1);
    assert.equal(consider(root, { turns: 2, compacted: true }).consider, false);
  } finally {
    cleanup();
  }
});

test("compact: false ignores the compaction boundary", () => {
  resetDistillGate();
  const { root, cleanup } = project(true, {
    turnInterval: 999,
    compact: false,
    cooldownMs: 0,
  });
  try {
    assert.equal(consider(root, { turns: 1, compacted: true }).consider, false);
  } finally {
    cleanup();
  }
});

test("throttle state is per session", () => {
  resetDistillGate();
  const { root, cleanup } = project(true, { turnInterval: 10, cooldownMs: 0 });
  try {
    markDistilled("s1", 10);
    assert.equal(consider(root, { sessionId: "s1", turns: 12 }).consider, false);
    assert.equal(consider(root, { sessionId: "s2", turns: 12 }).consider, true);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Gate 2 — the cheap LLM review. Fail-closed in every failure shape: a gate
// that failed open would turn a provider hiccup into an unreviewed write to
// state that gets injected into every future prompt.
// ---------------------------------------------------------------------------

async function review(text: string) {
  return reviewAutoDistill({
    transcript: TRANSCRIPT,
    state: emptyHarnessState(),
    provider: "anthropic",
    complete: async () => text,
  });
}

test("gate parses a bare JSON yes with instructions", async () => {
  const r = await review(
    '{"shouldDistill": true, "rationale": "repeated build failure", "instructions": "note the test flag"}',
  );
  assert.equal(r.shouldDistill, true);
  assert.equal(r.rationale, "repeated build failure");
  assert.equal(r.instructions, "note the test flag");
});

test("gate parses a fenced block and JSON embedded in prose", async () => {
  const fenced = await review(
    'Sure:\n```json\n{"shouldDistill": true, "rationale": "ok"}\n```\n',
  );
  assert.equal(fenced.shouldDistill, true);
  const prose = await review(
    'I think so. {"shouldDistill": false, "rationale": "nothing durable"} Hope that helps.',
  );
  assert.equal(prose.shouldDistill, false);
});

test("gate says no for anything that is not an explicit true", async () => {
  for (const text of [
    '{"shouldDistill": "true", "rationale": "stringy"}',
    '{"rationale": "field missing"}',
    "not json at all",
    "",
    '{"shouldDistill": true, "rationale": "truncated"',
  ]) {
    const r = await review(text);
    assert.equal(r.shouldDistill, false, `should not distill on: ${text}`);
  }
});

test("gate says no when the provider call throws", async () => {
  const r = await reviewAutoDistill({
    transcript: TRANSCRIPT,
    state: emptyHarnessState(),
    provider: "anthropic",
    complete: async () => {
      throw new Error("provider exploded");
    },
  });
  assert.equal(r.shouldDistill, false);
});

test("gate drops a blank instructions field rather than passing it on", async () => {
  const r = await review(
    '{"shouldDistill": true, "rationale": "ok", "instructions": "   "}',
  );
  assert.equal(r.instructions, undefined);
});
