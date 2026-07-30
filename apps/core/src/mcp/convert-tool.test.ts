import test from "node:test";
import assert from "node:assert/strict";
import { convertMcpTool } from "./convert-tool.js";
import { registerClient, removeClient } from "./client-registry.js";
import type { ToolContext } from "../tools/tool.types.js";

const ctx = {} as ToolContext;

test("convertMcpTool uses mcp__server__tool id for rule matching", () => {
  const tool = convertMcpTool(
    { name: "save", description: "Save context", inputSchema: { type: "object" } },
    "contextcarry",
  );
  assert.equal(tool.id, "mcp__contextcarry__save");
});

test("convertMcpTool uses server/tool as userFacingName", () => {
  const tool = convertMcpTool(
    { name: "load", description: "Load context", inputSchema: { type: "object" } },
    "contextcarry",
  );
  assert.equal(tool.behavior.userFacingName, "contextcarry/load");
});

test("convertMcpTool declares the mcp permission operation", () => {
  const tool = convertMcpTool(
    { name: "save", inputSchema: { type: "object" } },
    "contextcarry",
  );
  assert.deepEqual(tool.permissions.operations, ["mcp"]);
});

test("execute forwards the registered per-server timeout to callTool", async () => {
  const calls: Array<{ params: unknown; options: unknown }> = [];
  const fakeClient = {
    callTool: async (params: unknown, _schema: unknown, options: unknown) => {
      calls.push({ params, options });
      return { content: [{ type: "text", text: "done" }] };
    },
    close: async () => {},
  };
  registerClient("srv", fakeClient as never, 12345);
  try {
    const tool = convertMcpTool({ name: "do", inputSchema: { type: "object" } }, "srv");
    const res = await tool.execute({ x: 1 }, ctx);
    assert.equal(res.success, true);
    assert.equal(res.result?.output, "done");
    assert.deepEqual(calls[0].params, { name: "do", arguments: { x: 1 } });
    assert.deepEqual(calls[0].options, { timeout: 12345 });
  } finally {
    removeClient("srv");
  }
});

test("execute joins multiple text content blocks", async () => {
  const fakeClient = {
    callTool: async () => ({
      content: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
    }),
    close: async () => {},
  };
  registerClient("srv", fakeClient as never, 30000);
  try {
    const tool = convertMcpTool({ name: "do", inputSchema: { type: "object" } }, "srv");
    const res = await tool.execute({}, ctx);
    assert.equal(res.result?.output, "line1\nline2");
  } finally {
    removeClient("srv");
  }
});

test("execute fails cleanly when the server is not connected", async () => {
  const tool = convertMcpTool(
    { name: "do", inputSchema: { type: "object" } },
    "missing",
  );
  const res = await tool.execute({}, ctx);
  assert.equal(res.success, false);
  assert.match(String(res.error), /not connected/);
});
