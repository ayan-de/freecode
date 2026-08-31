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

test("a mutating MCP tool is not marked concurrency-safe", () => {
  const tool = convertMcpTool(
    { name: "create_issue", inputSchema: { type: "object" } },
    "github",
  );
  assert.equal(tool.behavior.isConcurrencySafe, false);
  assert.equal(tool.behavior.isDestructive, true);
});

test("a read-only MCP tool is marked concurrency-safe", () => {
  const tool = convertMcpTool(
    {
      name: "list_issues",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    },
    "github",
  );
  assert.equal(tool.behavior.isConcurrencySafe, true);
  assert.equal(tool.behavior.isDestructive, false);
});

test("convertMcpTool preserves required, nested properties, and array items", () => {
  const tool = convertMcpTool(
    {
      name: "create_issue",
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          owner: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
        },
      },
    },
    "github",
  );
  const params = tool.schemas.parameters;
  assert.deepEqual(params.required, ["title"]);
  const items = params.properties?.labels.items;
  assert.equal(Array.isArray(items) ? undefined : items?.type, "string");
  assert.deepEqual(params.properties?.owner.required, ["id"]);
  assert.equal(params.properties?.owner.properties?.id.type, "string");
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
