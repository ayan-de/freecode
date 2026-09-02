import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// OpenAI shards its prompt cache per machine and routes on `promptCacheKey`,
// falling back to a hash of the prefix when none is sent. A stable per-session
// key keeps a conversation's turns landing where its own prefix is warm.
//
// These are source-level assertions, following output-cap.test.ts: constructing
// the provider needs an API key and exercising it would make a network call, so
// the closure's buildOptions is not reachable from a unit test. They pin the two
// ways this silently stops working — they do not prove a request carries the key.

const dir = new URL(".", import.meta.url).pathname;
const genericProviderSrc = readFileSync(`${dir}/generic-provider.ts`, "utf-8");
const loopSrc = readFileSync(`${dir}/../agent/loop.ts`, "utf-8");

test("both OpenAI request paths are built by the same function", () => {
  // The regression this guards: execute() and stream() used to assemble
  // identical option objects separately. A cache key added to one and not the
  // other is worse than none — half a session's turns would route on the key
  // and half on the prefix hash, scattering the cache across machines. Both
  // now call the single buildGenerateOptions() shared across every provider,
  // not just openai — the guard tightens rather than weakens.
  assert.match(
    genericProviderSrc,
    /generateText\(generateOptions\)/,
  );
  assert.match(
    genericProviderSrc,
    /streamText\(\{\s*\.\.\.generateOptions,/,
  );

  // Set in exactly one place, so the two paths cannot drift apart again.
  // Assignments only — prose mentioning the field does not route a request.
  const occurrences = genericProviderSrc.match(/promptCacheKey:/g) ?? [];
  assert.equal(
    occurrences.length,
    1,
    `promptCacheKey is set ${occurrences.length} times; it belongs only in buildGenerateOptions`,
  );
});

test("the loop passes sessionId to both provider entry points", () => {
  // Without this the key is undefined at the provider and the whole mechanism
  // is a no-op — silently, since nothing errors.
  for (const method of ["stream", "execute"]) {
    const call = loopSrc.match(
      new RegExp(`aiProvider\\.${method}\\(\\{[\\s\\S]*?\\}\\)`),
    );
    assert.ok(call, `expected an aiProvider.${method}({...}) call site`);
    assert.match(
      call[0],
      /sessionId: this\.state\.sessionId/,
      `aiProvider.${method} is not given the session id`,
    );
  }
});
