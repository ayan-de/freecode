import { test } from "node:test";
import assert from "node:assert/strict";
import { initProviders, getProvider, listProviders } from "./registry.js";

test("initProviders registers all six catalogue providers plus gemini-web", async () => {
  await initProviders();
  const ids = listProviders().map((p) => p.id).sort();
  assert.deepEqual(ids, [
    "anthropic",
    "deepseek",
    "gemini",
    "gemini-web",
    "minimax",
    "openai",
    "zai",
  ]);
});

test("getProvider('gemini') resolves without throwing 'not registered'", async () => {
  await initProviders();
  const provider = getProvider("gemini" as any);
  assert.equal(provider.info.id, "gemini");
  assert.equal(typeof provider.execute, "function");
});

test("getProvider('google') still throws — catalogue ids are freecode's own, not models.dev's raw id", async () => {
  await initProviders();
  assert.throws(() => getProvider("google" as any), /not registered/);
});
