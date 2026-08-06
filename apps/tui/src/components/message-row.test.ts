import assert from "node:assert/strict";
import test from "node:test";
import stripAnsi from "strip-ansi";
import {
  createInProgressMessageComponent,
  createUserMessageComponent,
  resetLiveOutputTokens,
  setLiveOutputTokens,
  bumpLiveInputTokens,
  resetLiveInputTokens,
  setLiveUsageTotals,
  resetLiveUsageTotals,
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

// --- Provider-reported run totals (usage_totals / D7) ------------------------

function resetAllLiveState(): void {
  resetLiveOutputTokens();
  resetLiveInputTokens();
  resetLiveUsageTotals();
}

test("reported run totals outrank the local estimate", () => {
  resetAllLiveState();
  // The estimate said 100k in / 30k out; the provider says 250k / 12k. Before
  // usage_totals existed the row showed the guess for the whole run.
  setLiveOutputTokens(30_000);
  bumpLiveInputTokens(8_000);
  // Adopting the totals discards both stale estimates — they cover the same
  // turns the reported figure already counts, so keeping them double-bills.
  setLiveUsageTotals({
    inputTokens: 250_000,
    outputTokens: 12_000,
    cacheReadTokens: 900_000,
  });
  const line = renderRow("Simmering", Date.now(), 100_000, 0, 200_000, 3);

  assert.match(line, /↓250\.0k/); // not 258.0k
  assert.match(line, /↑12\.0k/);
  assert.match(line, /cached: 900\.0k/);
  resetAllLiveState();
});

test("estimates resume on top of the reported baseline, not beside it", () => {
  resetAllLiveState();
  setLiveUsageTotals({
    inputTokens: 250_000,
    outputTokens: 12_000,
    cacheReadTokens: 0,
  });
  // A tool result lands after the last reported turn: ↓ must keep moving.
  bumpLiveInputTokens(5_000);
  setLiveOutputTokens(1_000);
  const line = renderRow("Simmering", Date.now(), 100_000, 0, 200_000, 3);

  // 250k + 5k, NOT 100k + 5k (estimate baseline) and NOT 350k (double count).
  assert.match(line, /↓255\.0k/);
  assert.match(line, /↑13\.0k/);
  resetAllLiveState();
});

test("the final usage still wins over the reported running totals", () => {
  resetAllLiveState();
  setLiveUsageTotals({
    inputTokens: 250_000,
    outputTokens: 12_000,
    cacheReadTokens: 900_000,
  });
  // outputTokens > 0 marks the end-of-run value; it is the last word.
  const line = renderRow("Done", Date.now(), 0, 44_000, 200_000, 3, 7_000);

  assert.match(line, /↑44\.0k/);
  assert.match(line, /cached: 7\.0k/);
  resetAllLiveState();
});

test("with no reported totals the estimate is still used", () => {
  resetAllLiveState();
  setLiveOutputTokens(30_000);
  bumpLiveInputTokens(2_000);
  const line = renderRow("Simmering", Date.now(), 100_000, 0, 200_000, 1);

  assert.match(line, /↓102\.0k/);
  assert.match(line, /↑30\.0k/);
  resetAllLiveState();
});
