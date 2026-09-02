import { test } from "node:test";
import assert from "node:assert/strict";
import { getProvider, initProviders } from "./registry.js";
import { resolveCatalogue } from "./catalogue.js";

// The failure this exists for: an SDK package whose major targets a newer
// `@ai-sdk/provider` than the installed `ai` throws
//   "Unsupported model version vN for provider ..."
// on the first *request*, not at import. So a package that loads fine,
// typechecks fine, and passes every other test in this directory can still be
// dead on arrival for the provider that uses it — which is how `@ai-sdk/deepseek`
// sat broken at ^3.0.16 (provider v4) against ai@6 (provider v3).
//
// Constructing one provider per SDK family is enough: the mismatch is a
// property of the package, not of the provider that happens to reach it.
test("every bundled SDK builds a model the installed `ai` accepts", async () => {
  await initProviders();

  const seen = new Set<string>();
  const failures: string[] = [];

  for (const entry of resolveCatalogue()) {
    if (seen.has(entry.npm)) continue;
    seen.add(entry.npm);

    const envKey = entry.envKeys[0] ?? "FREECODE_SDK_COMPAT_TEST_KEY";
    const had = process.env[envKey];
    process.env[envKey] = "test-key";
    try {
      const provider = getProvider(entry.id as never);
      // Abort before anything leaves the machine: this asserts construction,
      // not connectivity, and must stay runnable offline and unbilled.
      const controller = new AbortController();
      controller.abort();
      const stream = provider.stream?.({
        prompt: "x",
        model: "compat-probe",
        abortSignal: controller.signal,
      } as never);
      assert.ok(stream, `${entry.id} exposes no stream()`);
      try {
        // Pull one chunk: the model handle is built inside the generator body,
        // so nothing is constructed until the first `next()`.
        await stream[Symbol.asyncIterator]().next();
      } catch (err) {
        const message = (err as Error).message;
        if (!/abort/i.test(message)) {
          failures.push(`${entry.npm} (via ${entry.id}): ${message}`);
        }
      }
    } catch (err) {
      failures.push(`${entry.npm} (via ${entry.id}): ${(err as Error).message}`);
    } finally {
      if (had === undefined) delete process.env[envKey];
      else process.env[envKey] = had;
    }
  }

  assert.ok(seen.size > 10, `only probed ${seen.size} SDK families`);
  assert.deepEqual(
    failures,
    [],
    `SDK packages incompatible with the installed \`ai\`:\n  ${failures.join("\n  ")}`,
  );
});
