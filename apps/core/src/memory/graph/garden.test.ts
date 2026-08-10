import test from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicates,
  findStale,
  garden,
  DEFAULT_HALF_LIFE_DAYS,
} from "./garden.js";
import type { MemoryEntry, MemoryType } from "../mem-types.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 10);

function mem(
  name: string,
  content: string,
  over: { type?: MemoryType; updatedAt?: number; description?: string } = {},
): MemoryEntry {
  return {
    name,
    description: over.description ?? `About ${name}`,
    type: over.type ?? "project",
    content,
    createdAt: over.updatedAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
  };
}

// ---------------------------------------------------------------------------
// findDuplicates
// ---------------------------------------------------------------------------

test("identical content pairs, and the newer one is kept", () => {
  const text = "The test suite deadlocks under parallel workers so pass runInBand";
  const older = mem("a", text, { updatedAt: NOW - 5 * DAY, description: "d" });
  const newer = mem("b", text, { updatedAt: NOW, description: "d" });

  const pairs = findDuplicates([older, newer]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].keep.name, "b");
  assert.equal(pairs[0].drop.name, "a");
  assert.ok(pairs[0].similarity >= 0.95);
});

// The bug the first real CLI run found: two byte-identical memories reported
// "duplicates: none", because their names (the store's file keys, which
// duplicates always differ by) were being scored as part of the text.
test("memories differing only by name still pair", () => {
  const text = "Deploys go out from the release branch, never from main.";
  const a = mem("deploy-branch", text, { description: "deploy" });
  const b = mem("deploy-branch-2", text, { description: "deploy" });
  const pairs = findDuplicates([a, b]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].similarity, 1);
});

test("input order does not change which memory is kept", () => {
  const text = "always run the migration before starting the dev server here";
  const older = mem("a", text, { updatedAt: NOW - DAY, description: "d" });
  const newer = mem("b", text, { updatedAt: NOW, description: "d" });

  assert.equal(findDuplicates([older, newer])[0].keep.name, "b");
  assert.equal(findDuplicates([newer, older])[0].keep.name, "b");
});

test("content length breaks a tie on identical timestamps", () => {
  const base = "deploy runs from the release branch only";
  const short = mem("a", base, { description: "d" });
  const long = mem("b", `${base} ${base} ${base}`, { description: "d" });
  const pairs = findDuplicates([short, long], 0.5);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].keep.name, "b");
});

test("differently-worded memories do not pair, and the threshold is honoured", () => {
  const a = mem("a", "the build requires node twenty two or newer");
  const b = mem("b", "python virtualenv lives in the tools directory");
  assert.equal(findDuplicates([a, b]).length, 0);
  // Nor does a low-but-nonzero overlap sneak through at the default.
  const c = mem("c", "the build requires a recent node release");
  assert.equal(findDuplicates([a, c]).length, 0);
});

test("the same sentence under two types is not a duplicate", () => {
  const text = "prefers terse output with no preamble";
  const a = mem("a", text, { type: "user", description: "d" });
  const b = mem("b", text, { type: "feedback", description: "d" });
  assert.equal(findDuplicates([a, b]).length, 0);
});

test("a memory is only ever proposed for removal once", () => {
  const text = "run pnpm build bun for a release binary not build sea";
  const entries = [
    mem("a", text, { updatedAt: NOW - 2 * DAY, description: "d" }),
    mem("b", text, { updatedAt: NOW - DAY, description: "d" }),
    mem("c", text, { updatedAt: NOW, description: "d" }),
  ];
  const pairs = findDuplicates(entries);
  const dropped = pairs.map((p) => p.drop.name);
  assert.equal(new Set(dropped).size, dropped.length);
  // The survivor is the newest of the group.
  assert.ok(!dropped.includes("c"));
});

// ---------------------------------------------------------------------------
// findStale
// ---------------------------------------------------------------------------

test("staleness is strictly older than the horizon, oldest first", () => {
  const fresh = mem("fresh", "x", { updatedAt: NOW - 10 * DAY });
  const exactly = mem("exactly", "x", { updatedAt: NOW - 90 * DAY });
  const old = mem("old", "x", { updatedAt: NOW - 91 * DAY });
  const ancient = mem("ancient", "x", { updatedAt: NOW - 400 * DAY });

  const stale = findStale([fresh, exactly, old, ancient], 90, NOW);
  // Exactly at the boundary is not yet stale — the check is `<` the cutoff.
  assert.deepEqual(
    stale.map((e) => e.name),
    ["ancient", "old"],
  );
});

test("an empty store proposes nothing", () => {
  assert.deepEqual(garden([]), { duplicates: [], stale: [] });
  assert.equal(DEFAULT_HALF_LIFE_DAYS, 90);
});

// ---------------------------------------------------------------------------
// garden
// ---------------------------------------------------------------------------

test("a memory dropped as a duplicate is not also reported as stale", () => {
  const text = "the vscode extension host reloads on window reload only";
  const older = mem("a", text, { updatedAt: NOW - 300 * DAY, description: "d" });
  const newer = mem("b", text, { updatedAt: NOW - 200 * DAY, description: "d" });

  const result = garden([older, newer], { halfLifeDays: 90, now: NOW });
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].drop.name, "a");
  // "b" is old enough to be stale and still reported; "a" already has a
  // recommendation, so one memory never shows up in two worklists.
  assert.deepEqual(
    result.stale.map((e) => e.name),
    ["b"],
  );
});

test("garden proposes only — the input entries are untouched", () => {
  const text = "never copy the sea build into the installer versions dir";
  const entries = [
    mem("a", text, { updatedAt: NOW - 300 * DAY, description: "d" }),
    mem("b", text, { updatedAt: NOW, description: "d" }),
  ];
  const snapshot = JSON.stringify(entries);
  garden(entries, { now: NOW });
  assert.equal(JSON.stringify(entries), snapshot);
});
