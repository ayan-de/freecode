import assert from "node:assert/strict";
import test from "node:test";
import stripAnsi from "strip-ansi";
import {
  createInProgressMessageComponent,
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
