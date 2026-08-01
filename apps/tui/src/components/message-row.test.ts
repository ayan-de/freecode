import assert from "node:assert/strict";
import test from "node:test";
import stripAnsi from "strip-ansi";
import {
  createInProgressMessageComponent,
  createUserMessageComponent,
  resetLiveOutputTokens,
  setLiveOutputTokens,
} from "./message-row.js";

function renderRow(
  ...args: Parameters<typeof createInProgressMessageComponent>
): string {
  return stripAnsi(createInProgressMessageComponent(...args).render(200)[0]!);
}

test("context meter reports occupancy, not the input/output run totals", () => {
  resetLiveOutputTokens();
  const line = renderRow(
    "Simmering",
    Date.now(),
    1_400_000, // ↓ run total across turns
    50_000, // ↑ run total
    200_000, // context limit
    9, // turns
    20_000, // cache reads
    150_000, // context occupancy for the latest request
  );

  assert.match(line, /↓1\.4M/);
  assert.match(line, /↑50\.0k/);
  assert.match(line, /150\.0k\/200\.0k/);
});

test("streamed output does not inflate the context meter", () => {
  resetLiveOutputTokens();
  setLiveOutputTokens(30_000);
  const line = renderRow(
    "Simmering",
    Date.now(),
    100_000,
    0,
    200_000,
    1,
    0,
    100_000,
  );

  assert.match(line, /↑30\.0k/);
  assert.match(line, /100\.0k\/200\.0k/);
  resetLiveOutputTokens();
});

test("without an explicit occupancy the meter falls back to input + cache reads", () => {
  resetLiveOutputTokens();
  setLiveOutputTokens(7_000);
  const line = renderRow("Simmering", Date.now(), 10_000, 0, 200_000, 1, 5_000);

  assert.match(line, /15\.0k\/200\.0k/);
  resetLiveOutputTokens();
});

// Box calls the Box bgFn once per rendered line, so a formatter that checks
// `lines[0]` stamps the prompt marker onto every line. A wrapped or multi-line
// user message then rendered with a ❯ on each visual row.
function chevronCount(content: string, width: number): number {
  const comp = createUserMessageComponent(content);
  return comp
    .render(width)
    .map((l) => stripAnsi(l))
    .filter((l) => l.includes("❯")).length;
}

test("user message shows the ❯ prompt marker only on its first line", () => {
  // Single line — the baseline that always worked.
  assert.equal(chevronCount("short message", 60), 1);

  // Wrapped by width: the reported bug (one ❯ per wrapped row).
  assert.equal(
    chevronCount("check how much of this plan is done? ".repeat(6), 60),
    1,
  );

  // Explicit newlines, including a blank line in the middle.
  assert.equal(chevronCount("line one\n\nline two\nline three", 60), 1);
});

test("user message keeps a single ❯ across re-renders and width changes", () => {
  // Box caches rendered lines, so the first-line marker must reset per pass
  // rather than leak state between renders.
  const comp = createUserMessageComponent("a".repeat(200));
  const count = (w: number) =>
    comp
      .render(w)
      .map((l) => stripAnsi(l))
      .filter((l) => l.includes("❯")).length;

  assert.equal(count(60), 1);
  assert.equal(count(60), 1); // cache hit
  assert.equal(count(40), 1); // re-wrap at a new width
});
