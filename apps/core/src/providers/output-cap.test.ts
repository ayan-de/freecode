import test from "node:test";
import assert from "node:assert/strict";
import { OUTPUT_TOKEN_CAP } from "./utils.js";
import { resolveCatalogue } from "./catalogue.js";

// Providers count max_tokens against the context window, so an oversized
// reservation silently shrinks the usable conversation and drags
// auto-compaction's threshold down with it (MiniMax-M2 fired at 60% when this
// was 65536). This used to grep the provider sources for literal declarations;
// now that the catalogue resolves them it asserts the values themselves,
// overrides included. Resolution reads no API keys, so this stays offline.
test("no provider reserves more output tokens than the cap", () => {
  const entries = resolveCatalogue();
  assert.ok(entries.length > 0, "expected a resolved catalogue");
  for (const entry of entries) {
    assert.ok(
      entry.maxOutputTokens <= OUTPUT_TOKEN_CAP,
      `${entry.id} reserves ${entry.maxOutputTokens} output tokens, above the ${OUTPUT_TOKEN_CAP} cap`,
    );
  }
});
