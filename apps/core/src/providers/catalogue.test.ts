import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCatalogue,
  envKeysFor,
  FEATURED_PROVIDER_IDS,
} from "./catalogue.js";
import { CATALOGUE_SNAPSHOT } from "./catalogue-snapshot.js";
import { hasSdkFactory } from "./sdk-factories.js";

test("the snapshot carries the whole models.dev catalogue, not a curated subset", () => {
  // The point of generating it is that nobody decides what belongs. A sharp
  // drop here means the generator silently filtered or the fetch was partial.
  assert.ok(
    CATALOGUE_SNAPSHOT.length > 150,
    `snapshot has ${CATALOGUE_SNAPSHOT.length} providers, expected the full catalogue`,
  );
});

test("every featured provider resolves", () => {
  const ids = new Set(resolveCatalogue().map((e) => e.id));
  for (const id of FEATURED_PROVIDER_IDS) {
    assert.ok(ids.has(id), `${id} is featured but did not resolve`);
  }
});

test("resolves far more than the six that used to be hand-written", () => {
  assert.ok(
    resolveCatalogue().length > 150,
    `resolved ${resolveCatalogue().length}, expected the openai-compatible bulk`,
  );
});

test("google is remapped to gemini, and never resolves under both ids", () => {
  const ids = resolveCatalogue().map((e) => e.id);
  assert.ok(ids.includes("gemini"));
  assert.ok(!ids.includes("google"));
  assert.equal(new Set(ids).size, ids.length, "duplicate provider ids");
});

test("only entries with a loadable SDK resolve", () => {
  for (const entry of resolveCatalogue()) {
    assert.ok(hasSdkFactory(entry.npm), `${entry.id} -> ${entry.npm}`);
  }
});

test("freecode's deliberate divergences from models.dev survive resolution", () => {
  const byId = new Map(resolveCatalogue().map((e) => [e.id, e]));

  // models.dev routes both through @ai-sdk/openai-compatible; freecode does not.
  assert.equal(byId.get("deepseek")?.npm, "@ai-sdk/deepseek");
  assert.equal(byId.get("deepseek")?.baseURL, undefined);
  assert.equal(byId.get("zai")?.npm, "@ai-sdk/anthropic");
  assert.equal(byId.get("zai")?.baseURL, "https://api.z.ai/api/anthropic");

  // minimax's baseURL is models.dev's, not an override — it must survive too.
  assert.equal(
    byId.get("minimax")?.baseURL,
    "https://api.minimax.io/anthropic/v1",
  );
});

test("minimax reserves the shared output cap, not a copy of its number", async () => {
  const { OUTPUT_TOKEN_CAP } = await import("./utils.js");
  const minimax = resolveCatalogue().find((e) => e.id === "minimax");
  assert.equal(minimax?.maxOutputTokens, OUTPUT_TOKEN_CAP);
});

test("effortFamily is set only for the three providers it was verified on", () => {
  const withEffort = resolveCatalogue()
    .filter((e) => e.effortFamily)
    .map((e) => e.id)
    .sort();
  assert.deepEqual(withEffort, ["anthropic", "gemini", "openai"]);
});

test("env keys come from the catalogue, so zai reads models.dev's name", () => {
  // The regression: config.ts hardcoded ZAI_API_KEY while models.dev publishes
  // ZHIPU_API_KEY, and nothing could observe the disagreement.
  assert.deepEqual(envKeysFor("zai"), ["ZHIPU_API_KEY"]);
  assert.ok(envKeysFor("anthropic").includes("ANTHROPIC_API_KEY"));
  assert.ok(envKeysFor("gemini").includes("GEMINI_API_KEY"));
});

test("an id the catalogue does not carry yields no keys rather than guessing", () => {
  assert.deepEqual(envKeysFor("not-a-real-provider"), []);
});

test("resolution is memoized, and the memo can be dropped", async () => {
  const { invalidateCatalogue } = await import("./catalogue.js");
  const first = resolveCatalogue();
  assert.equal(resolveCatalogue(), first, "expected the memoized array");
  invalidateCatalogue();
  const second = resolveCatalogue();
  assert.notEqual(second, first, "expected a fresh array after invalidation");
  assert.deepEqual(
    second.map((e) => e.id),
    first.map((e) => e.id),
    "invalidation must not change what resolves",
  );
});

test("both models.dev boundaries share one remap table", async () => {
  // The original bug was two independently-maintained id vocabularies that
  // agreed until they didn't. A copy of the rename in models-dev.ts and
  // another in catalogue.ts is that same shape at smaller scale.
  const { readFileSync } = await import("node:fs");
  const dir = new URL(".", import.meta.url).pathname;
  for (const file of ["catalogue.ts", "../models-dev.ts"]) {
    const src = readFileSync(`${dir}/${file}`, "utf-8");
    assert.ok(
      !/"google"\s*\?\s*"gemini"|google:\s*"gemini"/.test(src),
      `${file} re-encodes the google->gemini rename instead of importing it`,
    );
  }
  const { canonicalProviderId } = await import("./canonical-id.js");
  assert.equal(canonicalProviderId("google"), "gemini");
  assert.equal(canonicalProviderId("anthropic"), "anthropic");
});
