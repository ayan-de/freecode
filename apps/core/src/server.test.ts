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

test("providers.list only offers providers the registry can construct", async () => {
  // The regression: models.dev names 212 providers, freecode can build 198.
  // Listing the raw catalogue meant picking one of the other 14 wrote it into
  // config and then threw `Provider "x" not registered` on the first turn —
  // the same class of bug the models.dev-derived catalogue was built to end.
  const { initProviders, listProviders } = await import("./providers/registry.js");
  await initProviders();

  const res = (await handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "providers.list",
    params: { kind: "api" },
  })) as { result?: Array<{ id: string }>; error?: unknown };

  assert.equal(res.error, undefined);
  const listed = res.result ?? [];
  assert.ok(listed.length > 100, `only ${listed.length} providers listed`);

  const constructible = new Set(listProviders().map((p) => p.id));
  const orphans = listed.filter((p) => !constructible.has(p.id)).map((p) => p.id);
  assert.deepEqual(orphans, [], `offered but not registered: ${orphans.join(", ")}`);
});
