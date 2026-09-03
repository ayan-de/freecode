import test from "node:test";
import assert from "node:assert/strict";
import { createToolOrchestrator } from "./orchestrator.js";
import { registerMcpTool, unregisterMcpTools } from "./index.js";
import { getOutputStore, disposeOutputStore } from "./output-store/index.js";
import type { ToolContext } from "./types.js";
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

// D1 of spec 2026-09-04-harness-cost-efficiency.md: the OutputStore must
// receive the FULL output — every lossy cap (model head+tail, UI tail-keep)
// applies after the put, so the `output` tool can page the whole thing.
// Regression: bash used to tail-cut at 500KB before the store ever saw it.
const BIG = "x".repeat(600_000) + "\nLAST_LINE_MARKER";
const bigOutputTool = {
  id: "test-big-output",
  description: "test",
  schemas: { parameters: { type: "object", properties: {} } },
  behavior: {},
  execute: async () => ({
    success: true,
    result: { title: "big", output: BIG },
  }),
} as unknown as Tool;

test("full output reaches the store; model and display copies are capped", async () => {
  registerMcpTool(bigOutputTool);
  const sessionId = "test-d1-store-before-cap";
  const ctx: ToolContext = { cwd: process.cwd(), sessionId };
  try {
    const orch = createToolOrchestrator();
    const res = await orch.execute(
      { id: "call-big", tool: "test-big-output", args: {} } as any,
      ctx,
    );
    assert.equal(getOutputStore(sessionId).get("call-big"), BIG);
    assert.equal(res.truncated, true);
    assert.ok((res.modelOutput ?? "").length < BIG.length);
    assert.ok((res.displayOutput ?? "").length < BIG.length);
    // Tail-keep on the display copy: the end survives, the head is pageable.
    assert.ok(res.displayOutput?.endsWith("LAST_LINE_MARKER"));
  } finally {
    disposeOutputStore(sessionId);
    unregisterMcpTools("test-big-output");
  }
});

// D2 wiring: a tool that classifies its output (bash sets metadata.outputKind)
// gets a content-aware model view when the flag is on — full text still in the
// store, failure lines from the middle surviving into what the model sees.
const LOG_LINES = [
  ...Array.from({ length: 2000 }, (_, i) => `compiled module-${i} in 2ms`),
  "ERROR: mid-log failure the blind head+tail cut would have dropped",
  ...Array.from({ length: 2000 }, (_, i) => `emitted chunk-${i}`),
].join("\n");
const logTool = {
  id: "test-log-output",
  description: "test",
  schemas: { parameters: { type: "object", properties: {} } },
  behavior: {},
  execute: async () => ({
    success: true,
    result: { title: "build", output: LOG_LINES, metadata: { outputKind: "log" } },
  }),
} as unknown as Tool;

test("outputKind=log gets a compressed model view when the flag is on", async () => {
  registerMcpTool(logTool);
  const sessionId = "test-d2-compress";
  const ctx: ToolContext = { cwd: process.cwd(), sessionId };
  const prev = process.env.FREECODE_BASH_COMPRESS;
  process.env.FREECODE_BASH_COMPRESS = "1";
  try {
    const orch = createToolOrchestrator();
    const res = await orch.execute(
      { id: "call-log", tool: "test-log-output", args: {} } as any,
      ctx,
    );
    assert.equal(getOutputStore(sessionId).get("call-log"), LOG_LINES);
    assert.ok(res.modelOutput!.includes("ERROR: mid-log failure"));
    assert.ok(res.modelOutput!.length < LOG_LINES.length);
    assert.equal(res.truncated, true);
  } finally {
    if (prev === undefined) delete process.env.FREECODE_BASH_COMPRESS;
    else process.env.FREECODE_BASH_COMPRESS = prev;
    disposeOutputStore(sessionId);
    unregisterMcpTools("test-log-output");
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
