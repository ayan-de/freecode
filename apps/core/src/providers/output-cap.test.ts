import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { OUTPUT_TOKEN_CAP } from "./utils.js";

// Providers count max_tokens against the context window, so an oversized
// reservation silently shrinks the usable conversation and drags
// auto-compaction's threshold down with it (MiniMax-M2 fired at 60% when this
// was 65536). Read the declarations rather than importing the providers, which
// would require API keys.
test("no provider reserves more output tokens than the cap", () => {
  const dir = new URL(".", import.meta.url).pathname;
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  const found: Array<[string, number]> = [];
  for (const file of files) {
    const src = readFileSync(join(dir, file), "utf-8");
    for (const m of src.matchAll(/maxOutputTokens:\s*(\d[\d_]*)\s*,/g)) {
      found.push([file, Number(m[1].replace(/_/g, ""))]);
    }
  }

  assert.ok(found.length > 0, "expected literal maxOutputTokens declarations");
  for (const [file, value] of found) {
    assert.ok(
      value <= OUTPUT_TOKEN_CAP,
      `${file} reserves ${value} output tokens, above the ${OUTPUT_TOKEN_CAP} cap`,
    );
  }
});
