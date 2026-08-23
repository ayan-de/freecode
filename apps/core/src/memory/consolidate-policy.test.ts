import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConsolidationSettings,
  resetConsolidatePolicy,
  shouldConsolidate,
  type SessionSummary,
} from "./consolidate-policy.js";
import { tryAcquireConsolidationLock } from "./consolidation-lock.js";

const ENV = "FREECODE_DISABLE_MEMORY_CONSOLIDATION";
const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

function project(settings?: Record<string, unknown>): {
  root: string;
  graphDir: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "consolidate-policy-"));
  const graphDir = join(root, ".graph");
  mkdirSync(graphDir, { recursive: true });
  if (settings) {
    mkdirSync(join(root, ".freecode"), { recursive: true });
    writeFileSync(
      join(root, ".freecode", "settings.json"),
      JSON.stringify(settings),
    );
  }
  return {
    root,
    graphDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function sessions(count: number, opts: Partial<SessionSummary> = {}): SessionSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    lastTurnAt: NOW - HOUR,
    turnCount: 5,
    ...opts,
  }));
}

const decide = (
  root: string,
  graphDir: string,
  list: SessionSummary[],
  extra: Partial<Parameters<typeof shouldConsolidate>[0]> = {},
) =>
  shouldConsolidate({
    projectRoot: root,
    graphDir,
    sessions: list,
    currentSessionId: "current",
    now: NOW,
    ...extra,
  });

test("fires on a fresh project with enough sessions", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    assert.equal(decide(root, graphDir, sessions(5)).consolidate, true);
  } finally {
    cleanup();
  }
});

test("the session gate blocks below the threshold", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    const d = decide(root, graphDir, sessions(4));
    assert.equal(d.consolidate, false);
    assert.match(d.reason, /need 5/);
  } finally {
    cleanup();
  }
});

test("the current session is excluded from the count", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    // Five sessions, but one of them is the one still running.
    const list = sessions(5);
    list[0].id = "current";
    assert.equal(decide(root, graphDir, list).consolidate, false);
  } finally {
    cleanup();
  }
});

test("sessions with fewer than two turns are skipped — they held nothing", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    const list = [...sessions(3), ...sessions(4, { turnCount: 1 })];
    assert.equal(decide(root, graphDir, list).consolidate, false);
  } finally {
    cleanup();
  }
});

test("the time gate blocks before minHours", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    tryAcquireConsolidationLock(graphDir); // just consolidated
    resetConsolidatePolicy();
    const d = shouldConsolidate({
      projectRoot: root,
      graphDir,
      sessions: sessions(10),
      currentSessionId: "current",
      now: Date.now() + HOUR, // one hour later
    });
    assert.equal(d.consolidate, false);
    assert.match(d.reason, /need 24h/);
  } finally {
    cleanup();
  }
});

test("only sessions since the last consolidation count", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    tryAcquireConsolidationLock(graphDir);
    const lastAt = Date.now();
    resetConsolidatePolicy();
    // Plenty of sessions, but all of them predate the last run.
    const stale = sessions(10, { lastTurnAt: lastAt - 10 * HOUR });
    const d = shouldConsolidate({
      projectRoot: root,
      graphDir,
      sessions: stale,
      currentSessionId: "current",
      now: lastAt + 48 * HOUR,
    });
    assert.equal(d.consolidate, false);
    assert.match(d.reason, /0 sessions since last/);
  } finally {
    cleanup();
  }
});

test("the scan throttle suppresses a repeat check", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    // First call passes the gates and records the scan.
    assert.equal(decide(root, graphDir, sessions(2)).consolidate, false);
    const second = decide(root, graphDir, sessions(9));
    assert.match(second.reason, /throttled/);
  } finally {
    cleanup();
  }
});

test("the env kill switch wins", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  process.env[ENV] = "1";
  try {
    assert.equal(decide(root, graphDir, sessions(50)).consolidate, false);
  } finally {
    delete process.env[ENV];
    cleanup();
  }
});

test("the settings kill switch wins", () => {
  const { root, graphDir, cleanup } = project({
    memory: { autoConsolidate: false },
  });
  resetConsolidatePolicy();
  try {
    assert.equal(decide(root, graphDir, sessions(50)).consolidate, false);
  } finally {
    cleanup();
  }
});

test("a rate-limited process does not start background work", () => {
  const { root, graphDir, cleanup } = project();
  resetConsolidatePolicy();
  try {
    const d = decide(root, graphDir, sessions(50), { rateLimited: true });
    assert.equal(d.consolidate, false);
    assert.match(d.reason, /rate limit/);
  } finally {
    cleanup();
  }
});

test("an unparseable settings file falls through to defaults", () => {
  const { root, graphDir, cleanup } = project();
  mkdirSync(join(root, ".freecode"), { recursive: true });
  writeFileSync(join(root, ".freecode", "settings.json"), "{ not json");
  resetConsolidatePolicy();
  try {
    // Must not silently disable memory, and must not silently enable an
    // aggressive cadence either.
    const settings = loadConsolidationSettings(root);
    assert.equal(settings.autoConsolidate, true);
    assert.equal(settings.minHours, 24);
    assert.equal(settings.minSessions, 5);
    assert.equal(decide(root, graphDir, sessions(5)).consolidate, true);
  } finally {
    cleanup();
  }
});

test("settings override the defaults", () => {
  const { root, graphDir, cleanup } = project({
    memory: { consolidateMinHours: 1, consolidateMinSessions: 2 },
  });
  resetConsolidatePolicy();
  try {
    assert.equal(decide(root, graphDir, sessions(2)).consolidate, true);
  } finally {
    cleanup();
  }
});
