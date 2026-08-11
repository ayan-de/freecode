import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateReportMarkdown,
  getTaskCardsDir,
  readTaskCards,
  writeReport,
} from "./report.js";
import { createRunManifest } from "./run-store.js";
import { getRunDir } from "./run-store.js";
import type { TaskCard } from "./types.js";

const baseLimits = { maxTurns: 20, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 };

function card(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: "card-1",
    before: { problem: "flaky test", evidence: "CI failed 3x" },
    after: { change: "added a retry", filesChanged: ["a.ts"] },
    validation: { commands: ["pnpm test"], result: "pass" },
    outcome: "success",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("generateReportMarkdown: renders manifest fields with no task cards", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test", "fix the flaky test");
  manifest.status = "completed";
  manifest.stopReason = "gatePassed";
  manifest.usage = { turns: 3, countedTokens: 4500, elapsedMs: 12_000, usd: 0 };
  const md = generateReportMarkdown(manifest, []);
  assert.match(md, /fix the flaky test/);
  assert.match(md, /pnpm test/);
  assert.match(md, /completed \(gatePassed\)/);
  assert.match(md, /No task cards were recorded/);
});

test("generateReportMarkdown: renders task cards when present", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test");
  const md = generateReportMarkdown(manifest, [card()]);
  assert.match(md, /flaky test/);
  assert.match(md, /added a retry/);
  assert.match(md, /a\.ts/);
  assert.match(md, /✅/);
});

test("generateReportMarkdown: a failed run's closing note differs from a completed run's", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test");
  manifest.status = "failed";
  manifest.stopReason = "maxTurns";
  const md = generateReportMarkdown(manifest, []);
  assert.match(md, /did not reach a passing verify command/);
});

test("readTaskCards: reads all cards, sorted by createdAt, skipping a corrupt one", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test");
  const dir = getTaskCardsDir(manifest.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "b.json"),
    JSON.stringify(card({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" })),
  );
  writeFileSync(
    join(dir, "a.json"),
    JSON.stringify(card({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" })),
  );
  writeFileSync(join(dir, "corrupt.json"), "{not json");
  const cards = readTaskCards(manifest.id);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, "a");
  assert.equal(cards[1].id, "b");
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});

test("readTaskCards: no task-cards dir returns an empty array, never throws", () => {
  assert.deepEqual(readTaskCards("does-not-exist"), []);
});

test("writeReport: writes report.md to the run's directory", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test");
  const path = writeReport(manifest);
  const content = readFileSync(path, "utf-8");
  assert.match(content, new RegExp(manifest.id));
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});
