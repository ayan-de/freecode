import test from "node:test";
import assert from "node:assert/strict";
import { ShellsPanel } from "./shells-panel.js";
import type { ShellSummary } from "@thisisayande/freecode-shared";

const ESC = "\u001b";
const KEY_DOWN = `${ESC}[B`;
const KEY_ESC = ESC;
// \u001b escape rather than a literal ESC byte: a bare "[…m" pattern
// leaves the escape character behind and every width assertion is then off.
const ANSI = /\u001b\[[0-9;]*m/g;

const shell = (over: Partial<ShellSummary> = {}): ShellSummary => ({
  id: "bash_1",
  command: "pnpm dev",
  cwd: "/repo",
  status: "running",
  exitCode: null,
  startedAt: Date.now() - 5_000,
  bufferedChars: 0,
  truncated: false,
  ...over,
});

const panel = (): ShellsPanel =>
  new ShellsPanel({ onKill: () => {}, onRemove: () => {}, onClose: () => {} });

const strip = (rows: string[]): string => rows.join("\n").replace(ANSI, "");

test("renders each shell's command and status", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setShells([
    shell(),
    shell({
      id: "bash_2",
      command: "pnpm build",
      status: "failed",
      exitCode: 1,
    }),
  ]);
  const out = strip(p.render(60));
  assert.match(out, /pnpm dev/);
  assert.match(out, /running/);
  assert.match(out, /pnpm build/);
  assert.match(out, /exit 1/);
});

test("shows the selected shell's output, following the tail", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setShells([shell()]);
  p.appendOutput("bash_1", "first\nsecond\n");
  p.appendOutput("bash_1", "third\n");
  assert.match(strip(p.render(60)), /third/);
});

test("a chunk that does not end in a newline continues the same line", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setShells([shell()]);
  // A pipe delivers arbitrary chunks, not lines — splitting naively here would
  // show "compil" and "ing done" as two separate rows.
  p.appendOutput("bash_1", "compil");
  p.appendOutput("bash_1", "ing done\n");
  assert.match(strip(p.render(60)), /compiling done/);
});

test("selection stays on the same shell across a roster refresh", () => {
  const p = panel();
  p.setMaxRows(20);
  const roster = (): ShellSummary[] => [
    shell(),
    shell({ id: "bash_2", command: "docker compose up" }),
  ];
  p.setShells(roster());
  p.handleInput(KEY_DOWN);
  assert.equal(p.selectedShellId(), "bash_2");
  // The panel polls every second and replaces the array wholesale; the cursor
  // must not jump back to the top on each poll.
  p.setShells(roster());
  assert.equal(p.selectedShellId(), "bash_2");
});

test("selection falls back in range when the selected shell disappears", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setShells([shell(), shell({ id: "bash_2" })]);
  p.handleInput(KEY_DOWN);
  p.setShells([shell()]);
  assert.equal(p.selectedShellId(), "bash_1");
});

test("k kills the selected shell, esc closes", () => {
  let killed: string | undefined;
  let closed = false;
  const p = new ShellsPanel({
    onKill: (id) => {
      killed = id;
    },
    onRemove: () => {},
    onClose: () => {
      closed = true;
    },
  });
  p.setMaxRows(20);
  p.setShells([shell()]);
  p.handleInput("k");
  assert.equal(killed, "bash_1");
  p.handleInput(KEY_ESC);
  assert.equal(closed, true);
});

test("every rendered row is exactly the requested width", () => {
  const p = panel();
  p.setMaxRows(16);
  p.setShells([shell({ command: "a".repeat(200) })]);
  p.appendOutput("bash_1", "b".repeat(300) + "\n");
  // A short row breaks the overlay composite for the whole screen, not just
  // this card.
  for (const row of p.render(60)) {
    assert.equal(
      row.replace(ANSI, "").length,
      60,
      `row not 60 columns: ${JSON.stringify(row)}`,
    );
  }
});

test("an empty roster explains itself instead of rendering a blank card", () => {
  const p = panel();
  p.setMaxRows(16);
  assert.equal(p.isEmpty(), true);
  assert.match(strip(p.render(60)), /No background shells/);
});

test("the card never exceeds its declared height, even on a short terminal", () => {
  const p = panel();
  // Deliberately hostile: more shells than the list can show, in fewer rows
  // than the list plus the output viewport would like.
  p.setMaxRows(10);
  p.setShells(
    Array.from({ length: 8 }, (_, i) =>
      shell({ id: `bash_${i + 1}`, command: `job ${i + 1}` }),
    ),
  );
  p.appendOutput(
    "bash_1",
    Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"),
  );
  const rows = p.render(60);
  assert.equal(
    rows.length,
    p.heightFor(60),
    "render() must produce exactly the rows heightFor() promised",
  );
});

test("d dismisses a settled shell", () => {
  let removed: string | undefined;
  const p = new ShellsPanel({
    onKill: () => {},
    onRemove: (id) => {
      removed = id;
    },
    onClose: () => {},
  });
  p.setMaxRows(20);
  p.setShells([shell({ status: "completed", exitCode: 0 })]);
  p.handleInput("d");
  assert.equal(removed, "bash_1");
});

test("d refuses a RUNNING shell", () => {
  let removed: string | undefined;
  const p = new ShellsPanel({
    onKill: () => {},
    onRemove: (id) => {
      removed = id;
    },
    onClose: () => {},
  });
  p.setMaxRows(20);
  p.setShells([shell()]);
  p.handleInput("d");
  // Dropping the record would strand the process: nothing else holds a handle
  // to kill it. Kill first, then dismiss.
  assert.equal(removed, undefined);
});

test("the hint offers kill for a running shell and dismiss for a settled one", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setShells([shell()]);
  assert.match(strip(p.render(70)), /k kill/);
  assert.doesNotMatch(strip(p.render(70)), /d dismiss/);

  p.setShells([shell({ status: "failed", exitCode: 1 })]);
  assert.match(strip(p.render(70)), /d dismiss/);
  assert.doesNotMatch(strip(p.render(70)), /k kill/);
});

test("a dismissed shell's output buffer is released, not leaked", () => {
  const p = panel();
  p.setMaxRows(20);
  p.setShells([shell({ status: "completed" }), shell({ id: "bash_2" })]);
  p.appendOutput("bash_1", "gone soon\n");
  // Core drops the record; the next roster poll must drop the panel's copy too.
  p.setShells([shell({ id: "bash_2" })]);
  assert.doesNotMatch(strip(p.render(70)), /gone soon/);
});
