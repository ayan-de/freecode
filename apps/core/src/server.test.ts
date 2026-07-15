import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./server.js";
import { askQuestion } from "./bus/index.js";

test("question.answer resolves a pending askQuestion with the answers", async () => {
  const p = askQuestion("req-1", [
    { question: "Pick", options: [{ label: "A", description: "a" }] },
  ] as any);
  const res = await handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "question.answer",
    params: { requestId: "req-1", answers: ["A"] },
  });
  assert.equal((res as any).error, undefined);
  assert.deepEqual(await p, ["A"]);
});

test("question.reject rejects a pending askQuestion", async () => {
  const p = askQuestion("req-2", [
    { question: "Pick", options: [{ label: "A", description: "a" }] },
  ] as any);
  await handleRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "question.reject",
    params: { requestId: "req-2" },
  });
  await assert.rejects(p);
});
