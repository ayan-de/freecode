import test from "node:test";
import assert from "node:assert/strict";
import { foldTrial, readLog } from "./fold.js";
import type { LoggedCall } from "./server.js";

function call(partial: Partial<LoggedCall> & Pick<LoggedCall, "modelEndpoint">): LoggedCall {
  return {
    ts: "t",
    method: "POST",
    path: "/v1/messages",
    host: "api.minimax.io",
    status: 200,
    durationMs: 1,
    requestBytes: 0,
    responseBytes: 0,
    ...partial,
  };
}

test("folds two model calls into turns, tokens, and MiniMax-M3 USD", () => {
  const calls: LoggedCall[] = [
    call({
      modelEndpoint: true,
      model: "MiniMax-M3",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    }),
    call({
      modelEndpoint: true,
      usage: {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    }),
  ];
  const folded = foldTrial(calls, "MiniMax-M3");
  assert.equal(folded.turns, 2);
  assert.equal(folded.inputTokens, 1_000_000);
  assert.equal(folded.outputTokens, 1_000_000);
  assert.equal(folded.usd, 1.5);
  assert.equal(folded.leaks, 0);
});

test("a leak does not count as a turn and flags the fold", () => {
  const folded = foldTrial(
    [call({ modelEndpoint: false, path: "/repos/x" })],
    "MiniMax-M3",
  );
  assert.equal(folded.turns, 0);
  assert.equal(folded.leaks, 1);
  assert.equal(folded.auditOk, false);
});

test("an empty log is unmetered, not a cheap clean run", () => {
  const folded = foldTrial([], "MiniMax-M3");
  assert.equal(folded.turns, 0);
  assert.equal(folded.auditOk, false);
});
