import test from "node:test";
import assert from "node:assert/strict";
import { coerceArgs } from "./coerce-args.js";
import { createToolOrchestrator } from "./orchestrator.js";
import { registerMcpTool, unregisterMcpTools } from "./index.js";
import type { Tool, JsonSchema } from "./tool.types.js";

const schema: JsonSchema = {
  type: "object",
  properties: {
    pattern: { type: "string" },
    head_limit: { type: "number" },
    "-C": { type: "number" },
    "-i": { type: "boolean" },
    tags: { type: "array", items: { type: "number" } },
    todos: {
      type: "object",
      properties: { count: { type: "number" }, done: { type: "boolean" } },
    },
  },
};

test("coerceArgs converts quoted numbers and booleans the schema declares", () => {
  const out = coerceArgs(schema, {
    pattern: "foo",
    head_limit: "30",
    "-C": "-2",
    "-i": "true",
  }) as Record<string, unknown>;

  assert.equal(out.head_limit, 30);
  assert.equal(out["-C"], -2);
  assert.equal(out["-i"], true);
  // A string stays a string — only the declared type drives conversion.
  assert.equal(out.pattern, "foo");
});

test("coerceArgs converts \"false\" rather than dropping it", () => {
  const out = coerceArgs(schema, { "-i": "false" }) as Record<string, unknown>;
  assert.equal(out["-i"], false);
});

test("coerceArgs leaves ambiguous strings for the validator to reject", () => {
  // Number()/truthiness coercion would turn these into 0, 1000 and true, hiding
  // a malformed call. They must survive unchanged so validateInput sees them.
  for (const bad of ["", "  ", "1e3", "0x10", "12abc", "NaN"]) {
    const out = coerceArgs(schema, { head_limit: bad }) as Record<string, unknown>;
    assert.equal(out.head_limit, bad, `head_limit=${JSON.stringify(bad)}`);
  }
  const out = coerceArgs(schema, { "-i": "yes" }) as Record<string, unknown>;
  assert.equal(out["-i"], "yes");
});

test("coerceArgs recurses into arrays and nested objects", () => {
  const out = coerceArgs(schema, {
    tags: ["1", "2", "x"],
    todos: { count: "5", done: "false" },
  }) as Record<string, unknown>;

  assert.deepEqual(out.tags, [1, 2, "x"]);
  assert.deepEqual(out.todos, { count: 5, done: false });
});

test("coerceArgs ignores unknown properties and returns the original when unchanged", () => {
  const args = { pattern: "foo", unknownField: "7" };
  const out = coerceArgs(schema, args);
  // Same reference: the common path must not allocate.
  assert.equal(out, args);
  assert.equal((out as Record<string, unknown>).unknownField, "7");
});

test("coerceArgs passes through when there is no schema or no object args", () => {
  const args = { a: "1" };
  assert.equal(coerceArgs(undefined, args), args);
  assert.equal(coerceArgs(schema, null), null);
  assert.deepEqual(coerceArgs(schema, ["1"]), ["1"]);
});

// The regression this exists to prevent: a provider that stringifies numbers
// used to be rejected by the tool's own validator, and would then re-send the
// identical call. The orchestrator must coerce before validation runs.
const numericTool = {
  id: "test-numeric",
  description: "test",
  schemas: {
    parameters: {
      type: "object",
      properties: { limit: { type: "number" }, flag: { type: "boolean" } },
      required: ["limit"],
    },
  },
  behavior: {},
  validateInput: (params: unknown) => {
    const p = params as Record<string, unknown>;
    if (typeof p.limit !== "number") {
      return { valid: false as const, error: "limit must be a number" };
    }
    return { valid: true as const };
  },
  execute: async (params: Record<string, unknown>) => ({
    success: true,
    result: {
      title: "ok",
      output: `limit=${params.limit} flag=${params.flag}`,
      metadata: {},
    },
  }),
} as unknown as Tool;

test("orchestrator coerces quoted args before per-tool validation", async () => {
  registerMcpTool(numericTool);
  try {
    const orch = createToolOrchestrator();
    const res = await orch.execute({
      id: "c1",
      tool: "test-numeric",
      args: { limit: "25", flag: "false" },
    } as never);

    assert.equal(res.error, undefined);
    assert.equal(res.stdout, "limit=25 flag=false");
  } finally {
    unregisterMcpTools("test-numeric");
  }
});

test("orchestrator still rejects a genuinely bad value", async () => {
  registerMcpTool(numericTool);
  try {
    const orch = createToolOrchestrator();
    const res = await orch.execute({
      id: "c2",
      tool: "test-numeric",
      args: { limit: "not-a-number" },
    } as never);

    assert.match(String(res.error), /limit must be a number/);
  } finally {
    unregisterMcpTools("test-numeric");
  }
});
