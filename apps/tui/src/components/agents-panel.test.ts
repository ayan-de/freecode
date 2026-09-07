import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSummary } from "@thisisayande/freecode-shared";
import { AgentsPanel } from "./agents-panel.js";

const ESC = "\u001b";
const KEY_DOWN = `${ESC}[B`;
const KEY_UP = `${ESC}[A`;
const KEY_ESC = ESC;
const KEY_ENTER = "\r";
// \u001b escape rather than a literal ESC byte: a bare "[…m" pattern leaves the
// escape character behind and every width assertion is then off.
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

const panel = (
  over: {
    onOpen?: (id: string | null) => void;
    onStop?: (id: string) => void;
    onRemove?: (id: string) => void;
    onClose?: () => void;
  } = {},
): AgentsPanel =>
  new AgentsPanel({
    onOpen: over.onOpen ?? ((): void => {}),
    onStop: over.onStop ?? ((): void => {}),
    onRemove: over.onRemove ?? ((): void => {}),
    onClose: over.onClose ?? ((): void => {}),
  });

test("the roster shows main above every subagent it spawned", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setAgents([
    agent({ id: "a1", task: "Find every call site" }),
    agent({ id: "a2", task: "Check the flaky test", status: "completed" }),
    agent({ id: "a3", task: "Review the diff", status: "killed" }),
  ]);

  const text = strip(p.render(80));
  assert.match(text, /main/);
  assert.match(text, /1 running/);
  assert.match(text, /Find every call site/);
  assert.match(text, /Check the flaky test/);
  assert.match(text, /Review the diff/);
  assert.equal(p.runningCount(), 1);
});

test("status reads as a word, and no glyphs are rendered anywhere", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setAgents([
    agent({ id: "a1" }),
    agent({ id: "a2", task: "b", status: "completed", endedAt: Date.now() }),
    agent({ id: "a3", task: "c", status: "killed", endedAt: Date.now() }),
    agent({ id: "a4", task: "d", status: "failed", endedAt: Date.now() }),
  ]);

  const text = strip(p.render(80));
  assert.match(text, /running/);
  assert.match(text, /done/);
  assert.match(text, /killed/);
  assert.match(text, /failed/);
  // The card is read at a glance; a coloured bullet beside a word that already
  // says the same thing is noise. Box-drawing chrome is not a status glyph.
  for (const glyph of ["●", "✔", "✘", "■", "▸", "⏺", "→", "✓"]) {
    assert.ok(!text.includes(glyph), `panel still renders ${glyph}`);
  }
});

test("the card is sized to its content, not to a fraction of the terminal", () => {
  const p = panel();
  p.setMaxRows(40);

  p.setAgents([agent({ id: "a1" })]);
  // main + one agent + two borders + one hint.
  assert.equal(p.render(80).length, 5);
  assert.equal(p.heightFor(80), 5);

  p.setAgents([agent({ id: "a1" }), agent({ id: "a2", task: "second" })]);
  assert.equal(p.render(80).length, 6);
});

test("a long roster is capped by the terminal and scrolls with the cursor", () => {
  const p = panel();
  p.setMaxRows(8);
  p.setAgents(
    Array.from({ length: 30 }, (_, i) => agent({ id: `a${i}`, task: `t${i}` })),
  );
  assert.equal(p.render(80).length, p.heightFor(80));
  assert.ok(p.render(80).length <= 8);

  // Walking to the bottom must bring the last row into view.
  for (let i = 0; i < 30; i++) p.handleInput(KEY_DOWN);
  assert.equal(p.selectedAgent()?.id, "a29");
  assert.match(strip(p.render(80)), /t29/);
});

test("main is selected first, so the arrows walk down into the subagents", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" }), agent({ id: "a2", task: "second" })]);

  assert.equal(p.selectedAgent(), undefined, "row 0 is main, not an agent");
  p.handleInput(KEY_DOWN);
  assert.equal(p.selectedAgent()?.id, "a1");
  p.handleInput(KEY_DOWN);
  assert.equal(p.selectedAgent()?.id, "a2");
  // Past either end it stays put rather than wrapping.
  p.handleInput(KEY_DOWN);
  assert.equal(p.selectedAgent()?.id, "a2");
  p.handleInput(KEY_UP);
  p.handleInput(KEY_UP);
  p.handleInput(KEY_UP);
  assert.equal(p.selectedAgent(), undefined);
});

test("enter hands the selected agent's id to the shell, which swaps the main area", () => {
  const opened: (string | null)[] = [];
  const p = panel({ onOpen: (id) => opened.push(id) });
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" })]);

  p.handleInput(KEY_DOWN);
  p.handleInput(KEY_ENTER);
  assert.deepEqual(opened, ["a1"]);
});

test("enter on main asks for the conversation back", () => {
  const opened: (string | null)[] = [];
  const p = panel({ onOpen: (id) => opened.push(id) });
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" })]);

  p.handleInput(KEY_ENTER);
  assert.deepEqual(opened, [null], "null is the main row");
});

test("the panel opens no pane of its own — it is a roster", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" })]);
  const before = strip(p.render(80));
  p.handleInput(KEY_DOWN);
  p.handleInput(KEY_ENTER);
  const after = strip(p.render(80));
  assert.equal(
    after.split("\n").length,
    before.split("\n").length,
    "enter must not grow the card",
  );
  assert.match(after, /main/);
});

test("k stops the selected running agent; esc closes the card", () => {
  const stopped: string[] = [];
  let closed = 0;
  const p = panel({
    onStop: (id) => stopped.push(id),
    onClose: () => {
      closed++;
    },
  });
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" })]);

  p.handleInput("k");
  assert.deepEqual(stopped, [], "k on the main row must not stop anything");

  p.handleInput(KEY_DOWN);
  p.handleInput("k");
  assert.deepEqual(stopped, ["a1"]);

  p.handleInput(KEY_ESC);
  assert.equal(closed, 1);
});

test("d dismisses a settled agent and refuses a running one", () => {
  const removed: string[] = [];
  const p = panel({ onRemove: (id) => removed.push(id) });
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" })]);
  p.handleInput(KEY_DOWN);
  p.handleInput("d");
  assert.deepEqual(removed, [], "dismissing a running agent strands its loop");

  p.setAgents([agent({ id: "a1", status: "completed", endedAt: Date.now() })]);
  p.handleInput("d");
  assert.deepEqual(removed, ["a1"]);
});

test("the hint names only actions that apply to the current selection", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" })]);

  assert.match(strip(p.render(80)), /enter main/);

  p.handleInput(KEY_DOWN);
  const running = strip(p.render(80));
  assert.match(running, /enter watch/);
  assert.match(running, /k stop/);

  p.setAgents([agent({ id: "a1", status: "completed", endedAt: Date.now() })]);
  const settled = strip(p.render(80));
  assert.match(settled, /d dismiss/);
  assert.ok(!settled.includes("k stop"));
});

test("selection stays on the same agent across a roster refresh", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setAgents([agent({ id: "a1" }), agent({ id: "a2", task: "second" })]);
  p.handleInput(KEY_DOWN);
  p.handleInput(KEY_DOWN);
  assert.equal(p.selectedAgent()?.id, "a2");

  // a1 is dismissed; a2 moves up a row but must stay selected.
  p.setAgents([agent({ id: "a2", task: "second" })]);
  assert.equal(p.selectedAgent()?.id, "a2");
});

test("every rendered row is exactly the requested width", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setAgents([
    agent({ id: "a1", task: "x".repeat(200) }),
    agent({ id: "a2", task: "short" }),
  ]);
  for (const row of p.render(60)) {
    assert.equal(row.replace(ANSI, "").length, 60);
  }
});

test("an empty roster reports itself so the shell can explain rather than open", () => {
  const p = panel();
  p.setMaxRows(20);
  assert.equal(p.isEmpty(), true);
  p.setAgents([agent()]);
  assert.equal(p.isEmpty(), false);
  assert.equal(p.find("a1")?.task, "Find every call site");
  assert.equal(p.find("nope"), undefined);
});
