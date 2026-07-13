// =============================================================================
// Tool Defs Cache Tests — Phase 5
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { getToolDefs, invalidateToolDefs } from "./defs-cache.js";
import { BusEvents } from "../bus/index.js";

test("getToolDefs memoizes: same reference until invalidated", () => {
  invalidateToolDefs();
  const first = getToolDefs();
  const second = getToolDefs();
  assert.equal(first, second, "cached array is reused by reference");
  assert.ok(first.length > 0, "built-in tools present");
  assert.ok(first.some((t) => t.name === "read"));

  invalidateToolDefs();
  const third = getToolDefs();
  assert.notEqual(first, third, "invalidation forces a rebuild");
});

test("bus tools.changed / mcp.tools.changed invalidate the cache", async () => {
  const before = getToolDefs();
  BusEvents.toolsChanged([{ id: "x", description: "x" }], []);
  // Bus delivery is synchronous (EventEmitter), but yield once to be safe.
  await new Promise((r) => setImmediate(r));
  const afterToolsChanged = getToolDefs();
  assert.notEqual(before, afterToolsChanged);

  BusEvents.mcpToolsChanged("some-server");
  await new Promise((r) => setImmediate(r));
  const afterMcpChanged = getToolDefs();
  assert.notEqual(afterToolsChanged, afterMcpChanged);
});
