import test from "node:test";
import assert from "node:assert/strict";
import { tools } from "../index.js";
import { toolKind } from "../../permission/mode-policy.js";
import { getOutputStore } from "../output-store/index.js";

const ctx = { cwd: process.cwd(), sessionId: "test-output-session" } as const;

test("output is registered and read-only", () => {
  assert.ok("output" in tools);
  assert.equal(toolKind("output"), "readonly");
});

test("miss (unknown id) degrades, never errors", async () => {
  const r = await tools.output.execute({ id: "nope" }, ctx);
  assert.equal(r.success, true);
  assert.equal(r.result?.metadata?.found, false);
  assert.match(r.result?.output ?? "", /Re-run the original tool/);
});

test("retrieves the previously-discarded tail without re-running", async () => {
  // Simulate what the orchestrator does: stash a full output that would have
  // been truncated, then page to its tail via the tool.
  const full = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
  getOutputStore(ctx.sessionId).put("call-x", full);

  const r = await tools.output.execute(
    { id: "call-x", offset: 498, limit: 3 },
    ctx,
  );
  assert.equal(r.result?.metadata?.found, true);
  assert.equal(r.result?.metadata?.totalLines, 500);
  assert.match(r.result?.output ?? "", /line 498\nline 499\nline 500/);
});

test("pattern greps the stored output", async () => {
  getOutputStore(ctx.sessionId).put("call-y", "ok\nERROR: boom\nok\nERROR: bang");
  const r = await tools.output.execute({ id: "call-y", pattern: "^ERROR" }, ctx);
  assert.match(r.result?.output ?? "", /2: ERROR: boom/);
  assert.match(r.result?.output ?? "", /4: ERROR: bang/);
  assert.doesNotMatch(r.result?.output ?? "", /^1: ok/m);
});
