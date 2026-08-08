import test from "node:test";
import assert from "node:assert/strict";
import { applySystemPromptHookRewrite } from "./apply-system-hook.js";

const staticBlocks = [{ text: "STATIC_SYSTEM", cache: true }];
const sessionBlocks = [
  { text: "todos here", cache: false },
  { text: "reminder", cache: false },
];

test("no rewrite keeps the original blocks and cache flags", () => {
  const out = applySystemPromptHookRewrite(
    staticBlocks,
    sessionBlocks,
    undefined,
  );
  assert.deepEqual(out, [...staticBlocks, ...sessionBlocks]);
});

test("identical rewrite is a no-op", () => {
  const joined = [...staticBlocks, ...sessionBlocks].map((b) => b.text).join("\n\n");
  const out = applySystemPromptHookRewrite(
    staticBlocks,
    sessionBlocks,
    joined,
  );
  assert.deepEqual(out, [...staticBlocks, ...sessionBlocks]);
  assert.equal(out[0].cache, true);
  assert.equal(out[1].cache, false);
});

test("rewrite that keeps the static prefix preserves the cached block", () => {
  const out = applySystemPromptHookRewrite(
    staticBlocks,
    sessionBlocks,
    "STATIC_SYSTEM\n\nHOOK_APPENDED",
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { text: "STATIC_SYSTEM", cache: true });
  assert.deepEqual(out[1], { text: "HOOK_APPENDED", cache: false });
});

test("opaque full rewrite is a single uncached block", () => {
  const out = applySystemPromptHookRewrite(
    staticBlocks,
    sessionBlocks,
    "TOTALLY_DIFFERENT",
  );
  assert.deepEqual(out, [{ text: "TOTALLY_DIFFERENT", cache: false }]);
});

test("never collapses session content into a cache:true blob", () => {
  // This is the bug the helper exists to prevent: marking the joined rewrite
  // as cache:true would put "todos here" under the breakpoint.
  const joined =
    "STATIC_SYSTEM\n\ntodos here\n\nreminder\n\nHOOK_TWEAK";
  const out = applySystemPromptHookRewrite(
    staticBlocks,
    sessionBlocks,
    joined,
  );
  assert.equal(out[0].cache, true);
  assert.equal(out[0].text, "STATIC_SYSTEM");
  for (const block of out.slice(1)) {
    assert.equal(block.cache, false);
  }
  assert.ok(out.some((b) => b.text.includes("todos here")));
});
