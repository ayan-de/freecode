import { test } from "node:test";
import assert from "node:assert/strict";
import { initProviders, getProvider, listProviders } from "./registry.js";
import { FEATURED_PROVIDER_IDS } from "./catalogue.js";

test("initProviders registers the whole catalogue plus gemini-web", async () => {
  await initProviders();
  const ids = new Set(listProviders().map((p) => p.id));
  for (const id of [...FEATURED_PROVIDER_IDS, "gemini-web"]) {
    assert.ok(ids.has(id), `${id} not registered`);
  }
  // The point of the models.dev-derived catalogue: `providers.list` has always
  // offered the picker every models.dev provider, and the registry must be
  // able to construct what the picker offered.
  assert.ok(ids.size > 150, `only ${ids.size} providers registered`);
});

test("registration needs no API key — the key is read on first request", async () => {
  const hadKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await initProviders();
    const provider = getProvider("anthropic" as any);
    assert.equal(provider.info.id, "anthropic");
    assert.equal(typeof provider.execute, "function");
  } finally {
    if (hadKey !== undefined) process.env.ANTHROPIC_API_KEY = hadKey;
  }
});

test("getProvider('gemini') resolves without throwing 'not registered'", async () => {
  await initProviders();
  const provider = getProvider("gemini" as any);
  assert.equal(provider.info.id, "gemini");
});

test("getProvider('google') still throws — freecode's ids are canonical", async () => {
  await initProviders();
  assert.throws(() => getProvider("google" as any), /not registered/);
});

test("a provider models.dev lists but no SDK covers stays unregistered", async () => {
  await initProviders();
  // watsonx ships as `watsonx-ai-provider`, which needs a credential loader
  // rather than an apiKey — deferred, so it must not appear registered-and-broken.
  assert.throws(() => getProvider("watsonx" as any), /not registered/);
});

test("openai-compatible providers from the catalogue are constructible", async () => {
  const hadKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-key";
  try {
    await initProviders();
    const provider = getProvider("groq" as any);
    assert.equal(provider.info.id, "groq");
  } finally {
    if (hadKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = hadKey;
  }
});

test("initProviders is memoized, so concurrent callers await one registration", async () => {
  // The race this closes: registration awaits two dynamic imports, so a second
  // caller could observe a half-populated registry while the first was still
  // resolving. providers/index.ts starts it eagerly on import and three
  // entrypoints call it again.
  const a = initProviders();
  const b = initProviders();
  assert.equal(a, b, "expected the same in-flight promise");
  await Promise.all([a, b]);
  assert.ok(listProviders().length > 150);
});
