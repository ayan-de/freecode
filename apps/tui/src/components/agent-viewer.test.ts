import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSummary } from "@thisisayande/freecode-shared";
import { AgentViewer } from "./agent-viewer.js";

const ESC = "\u001b";
const KEY_ESC = ESC;
const KEY_PGUP = `${ESC}[5~`;
const KEY_PGDN = `${ESC}[6~`;
// \u001b escape rather than a literal ESC byte.
const ANSI = /\u001b\[[0-9;]*m/g;

const strip = (rows: string[]): string => rows.join("\n").replace(ANSI, "");

const agent = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  id: "a1",
  parentId: "root",
  rootId: "root",
  task: "Find every call site",
  agentType: "agent",
  depth: 1,
  status: "running",
  startedAt: Date.now() - 12_000,
  bufferedChars: 0,
  truncated: false,
  ...over,
});

const viewer = (
  over: { onStop?: (id: string) => void; onBack?: () => void } = {},
): AgentViewer =>
  new AgentViewer({
    onStop: over.onStop ?? ((): void => {}),
    onBack: over.onBack ?? ((): void => {}),
  });

test("renders nothing until an agent is opened", () => {
  const v = viewer();
  v.setMaxRows(20);
  assert.deepEqual(v.render(80), [], "the main area stays with the message list");
  assert.equal(v.agentId(), undefined);
});

test("shows the agent's task, status and seeded activity", () => {
  const v = viewer();
  v.setMaxRows(20);
  v.open(agent(), "> grep(loop.ts)\nmatched 3 files");

  const text = strip(v.render(80));
  assert.match(text, /Subagent: Find every call site/);
  assert.match(text, /running/);
  assert.match(text, /matched 3 files/);
  assert.equal(v.agentId(), "a1");
});

test("no status glyphs — the header says it in words", () => {
  const v = viewer();
  v.setMaxRows(20);
  v.open(agent({ status: "completed", endedAt: Date.now() }), "done");
  const text = strip(v.render(80));
  for (const glyph of ["●", "✔", "✘", "■", "▸", "⏺"]) {
    assert.ok(!text.includes(glyph), `viewer still renders ${glyph}`);
  }
});

test("live chunks append, and a chunk without a newline continues the line", () => {
  const v = viewer();
  v.setMaxRows(20);
  v.open(agent(), "");
  v.append("half a ");
  v.append("sentence");
  assert.match(strip(v.render(80)), /half a sentence/);
});

test("it is a bounded window, not a growing transcript", () => {
  const v = viewer();
  v.setMaxRows(12);
  v.open(agent(), "");
  for (let i = 0; i < 500; i++) v.append(`line ${i}\n`);

  const rows = v.render(80);
  assert.ok(rows.length <= 12, `rendered ${rows.length} rows for a 12-row budget`);
  // Following the tail: the newest line is on screen, the oldest is not.
  const text = strip(rows);
  assert.match(text, /line 499/);
  assert.ok(!text.includes("line 0\n"));
});

test("pgup scrolls back and pgdn/end returns to following the tail", () => {
  const v = viewer();
  v.setMaxRows(12);
  v.open(agent(), "");
  for (let i = 0; i < 200; i++) v.append(`line ${i}\n`);

  v.handleInput(KEY_PGUP);
  v.handleInput(KEY_PGUP);
  assert.ok(!strip(v.render(80)).includes("line 199"), "scrolled off the tail");

  v.handleInput("G");
  assert.match(strip(v.render(80)), /line 199/);

  v.handleInput(KEY_PGUP);
  v.handleInput(KEY_PGDN);
  v.handleInput(KEY_PGDN);
  assert.match(strip(v.render(80)), /line 199/);
});

test("esc hands the main area back to the conversation", () => {
  let back = 0;
  const v = viewer({
    onBack: () => {
      back++;
    },
  });
  v.setMaxRows(20);
  v.open(agent(), "");
  v.handleInput(KEY_ESC);
  assert.equal(back, 1);
});

test("k stops a running agent and does nothing once it has settled", () => {
  const stopped: string[] = [];
  const v = viewer({ onStop: (id) => stopped.push(id) });
  v.setMaxRows(20);
  v.open(agent(), "");
  v.handleInput("k");
  assert.deepEqual(stopped, ["a1"]);

  v.update(agent({ status: "completed", endedAt: Date.now() }));
  v.handleInput("k");
  assert.deepEqual(stopped, ["a1"], "a settled agent has nothing to stop");
});

test("a roster refresh updates status but never disturbs the buffer", () => {
  const v = viewer();
  v.setMaxRows(20);
  v.open(agent(), "important output");

  v.update(agent({ status: "completed", endedAt: Date.now() }));
  const text = strip(v.render(80));
  assert.match(text, /completed/);
  assert.match(text, /important output/);

  // An update for a DIFFERENT agent must not retarget the view.
  v.update(agent({ id: "other", task: "someone else" }));
  assert.match(strip(v.render(80)), /Find every call site/);
  assert.equal(v.agentId(), "a1");
});

test("every rendered row fits the requested width", () => {
  const v = viewer();
  v.setMaxRows(12);
  v.open(agent({ task: "t".repeat(300) }), "");
  v.append("x".repeat(400));
  for (const row of v.render(60)) {
    assert.ok(
      row.replace(ANSI, "").length <= 60,
      `row overflowed: ${row.replace(ANSI, "").length}`,
    );
  }
});
