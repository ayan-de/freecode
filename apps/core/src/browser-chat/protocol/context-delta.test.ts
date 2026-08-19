import test from "node:test";
import assert from "node:assert/strict";
import {
  diffProjectContext,
  extractProjectContext,
} from "./context-delta.js";
import type { Message } from "../../agent/types.js";

test("a clock-only change reports nothing", () => {
  // Without volatile-line filtering every turn would report a change and the
  // delta would never be empty — defeating the whole optimization.
  const before = "Time: 10:15\nsrc/a.ts\nsrc/b.ts";
  const after = "Time: 10:42\nsrc/a.ts\nsrc/b.ts";
  assert.equal(diffProjectContext(before, after), null);
});

test("added and removed files are reported", () => {
  const delta = diffProjectContext(
    "src/a.ts\nsrc/b.ts",
    "src/a.ts\nsrc/c.ts",
  );
  assert.match(delta ?? "", /\+ src\/c\.ts/);
  assert.match(delta ?? "", /- src\/b\.ts/);
});

test("an identical context reports nothing", () => {
  assert.equal(diffProjectContext("src/a.ts", "src/a.ts"), null);
});

test("a huge change is capped rather than resending the tree", () => {
  const before = "root";
  const after =
    "root\n" +
    Array.from({ length: 200 }, (_, i) => `src/file${i}.ts`).join("\n");
  const delta = diffProjectContext(before, after) ?? "";
  assert.match(delta, /and \d+ more changes/);
  assert.ok(delta.split("\n").length < 50);
});

test("the synthetic context message is found by id", () => {
  const messages: Message[] = [
    {
      id: "dynamic-context",
      role: "user",
      parts: [{ type: "text", content: "TREE" }],
      timestamp: 0,
    },
    {
      id: "real",
      role: "user",
      parts: [{ type: "text", content: "do it" }],
      timestamp: 1,
    },
  ];
  assert.equal(extractProjectContext(messages), "TREE");
});

test("absent context is null, not an empty string", () => {
  assert.equal(extractProjectContext([]), null);
});
