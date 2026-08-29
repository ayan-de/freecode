import test from "node:test";
import assert from "node:assert/strict";
import {
  registerProvider,
  allowsAuxiliaryCalls,
  providerRequiresApiKey,
  listProviders,
} from "./registry.js";
import type { AIProvider, ProviderInfo } from "./types.js";

function stub(info: ProviderInfo) {
  registerProvider(info.id, {
    info,
    create: () => ({ info }) as unknown as AIProvider,
  });
}

const BASE = {
  name: "test",
  defaultModel: "m",
  supportsStreaming: false,
  supportsTools: false,
  maxOutputTokens: 1,
};

test("a provider that never declares the flag is allowed", () => {
  stub({ ...BASE, id: "aux-undeclared" });
  assert.equal(allowsAuxiliaryCalls("aux-undeclared"), true);
});

test("only an explicit false opts out", () => {
  stub({ ...BASE, id: "aux-true", auxiliaryCalls: true });
  stub({ ...BASE, id: "aux-false", auxiliaryCalls: false });
  assert.equal(allowsAuxiliaryCalls("aux-true"), true);
  assert.equal(allowsAuxiliaryCalls("aux-false"), false);
});

test("an unregistered provider fails OPEN", () => {
  // The flag gates politeness, not safety. A wrong `false` here would switch
  // memory off for everyone, which is far worse than one extra request.
  assert.equal(allowsAuxiliaryCalls("no-such-provider"), true);
});

test("gemini-web opts out; the metered providers do not", async () => {
  // Awaited explicitly: importing index.js only *starts* initProviders(), so
  // reading the registry straight after the import races the registrations.
  const { initProviders } = await import("./registry.js");
  await initProviders();
  const byId = new Map(listProviders().map((p) => [p.id, p]));
  assert.equal(allowsAuxiliaryCalls("gemini-web"), false);
  // Guards the default: adding `auxiliaryCalls: false` to a metered provider
  // would silently disable its memory, judge and compaction summaries.
  for (const id of ["anthropic", "openai", "gemini"]) {
    assert.ok(byId.has(id), `${id} should be registered`);
    assert.equal(allowsAuxiliaryCalls(id), true);
  }
});

test("only gemini-web waives the API key requirement", async () => {
  const { initProviders } = await import("./registry.js");
  await initProviders();
  assert.equal(providerRequiresApiKey("gemini-web"), false);
  for (const id of ["anthropic", "openai", "gemini", "minimax"]) {
    assert.equal(providerRequiresApiKey(id), true);
  }
  // Unknown ids default to needing one: prompting for a key that turns out to
  // be unnecessary is recoverable; skipping one that IS needed is not.
  assert.equal(providerRequiresApiKey("no-such-provider"), true);
});

test("a web session's credential is read from browsers, then providers", async () => {
  // Config is passed in, never read from disk: an earlier draft of this test
  // wrote to the real ~/.freecode/config.json and restored it in a finally,
  // which loses the user's API keys if the runner is killed mid-test.
  const { readSessionCredential } = await import("./config.js");

  assert.equal(
    readSessionCredential("x-web", {
      providers: { "x-web": { apiKey: "from-providers" } },
      browsers: { "x-web": { apiKey: "from-browsers" } },
    }).apiKey,
    "from-browsers",
  );

  // Legacy configs that predate `browsers` keep working.
  assert.equal(
    readSessionCredential("x-web", {
      providers: { "x-web": { apiKey: "from-providers" } },
    }).apiKey,
    "from-providers",
  );

  // An empty browsers entry must not shadow a real providers one, or moving
  // half a config over silently blanks the credential.
  assert.equal(
    readSessionCredential("x-web", {
      providers: { "x-web": { apiKey: "from-providers" } },
      browsers: { "x-web": {} as never },
    }).apiKey,
    "from-providers",
  );

  assert.deepEqual(readSessionCredential("absent", {}), {});
});

test("mergeCredential keeps sibling fields", async () => {
  const { mergeCredential } = await import("./config.js");
  const merged = mergeCredential(
    { apiKey: "old", realUserID: "keep" } as never,
    "new",
  );
  assert.equal(merged.apiKey, "new");
  // Wholesale assignment used to drop this, silently discarding a hand-written
  // realUserID whenever the key was re-entered in the TUI.
  assert.equal((merged as Record<string, unknown>).realUserID, "keep");
});
