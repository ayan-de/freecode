import test from "node:test";
import assert from "node:assert/strict";
import { createToolOrchestrator } from "./orchestrator.js";
import { registerMcpTool, unregisterMcpTools } from "./index.js";
import type { Tool } from "./tool.types.js";

// A tool that returns the structured `{ title, output, metadata }` shape that
// factory-built tools (write/edit) use. The orchestrator must surface `.output`
// verbatim as stdout — not JSON.stringify the whole object, which would break
// the frontend's diff parsing.
const DIFF = "+ 1 added line\n- 2 removed line";
const structuredTool = {
  id: "test-structured",
  description: "test",
  schemas: { parameters: { type: "object", properties: {} } },
  behavior: {},
  execute: async () => ({
    success: true,
    result: { title: "file.ts", output: DIFF, metadata: { filepath: "file.ts" } },
  }),
} as unknown as Tool;

test("orchestrator surfaces structured .output as stdout, not JSON", async () => {
  registerMcpTool(structuredTool);
  try {
    const orch = createToolOrchestrator();
    const res = await orch.execute({
      id: "c1",
      tool: "test-structured",
      args: {},
    } as any);
    assert.equal(res.stdout, DIFF);
    assert.equal(res.title, "file.ts");
    assert.deepEqual(res.structuredData, { filepath: "file.ts" });
  } finally {
    unregisterMcpTools("test-structured");
  }
});

const requiresTitleTool = {
  id: "test-requires-title",
  description: "test",
  schemas: {
    parameters: {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" } },
    },
  },
  behavior: {},
  execute: async () => ({
    success: true,
    result: { title: "ok", output: "ok" },
  }),
} as unknown as Tool;

test("orchestrator rejects a call missing a required schema param before execute() runs", async () => {
  registerMcpTool(requiresTitleTool);
  try {
    const orch = createToolOrchestrator();
    const res = await orch.execute({
      id: "c1",
      tool: "test-requires-title",
      args: {},
    } as any);
    assert.match(res.error ?? "", /Missing required param: title/);
  } finally {
    unregisterMcpTools("test-requires-title");
  }
});

test("orchestrator lets a call through once the required param is present", async () => {
  registerMcpTool(requiresTitleTool);
  try {
    const orch = createToolOrchestrator();
    const res = await orch.execute({
      id: "c1",
      tool: "test-requires-title",
      args: { title: "hi" },
    } as any);
    assert.equal(res.error, undefined);
    assert.equal(res.stdout, "ok");
  } finally {
    unregisterMcpTools("test-requires-title");
  }
});
