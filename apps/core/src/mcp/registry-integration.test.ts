import test from "node:test";
import assert from "node:assert/strict";
import { convertMcpTool } from "./convert-tool.js";
import {
  registerMcpTool,
  unregisterMcpTools,
  getMcpTools,
} from "../tools/index.js";

// Mirrors the prefix used by init.ts (unregister) and server.ts (mcp.status filter).
const prefix = (server: string) => `mcp__${server}__`;

test("registered MCP tool is discoverable under its mcp__server__tool id", () => {
  const tool = convertMcpTool(
    { name: "save", inputSchema: { type: "object" } },
    "regtest",
  );
  registerMcpTool(tool);
  try {
    const all = getMcpTools();
    assert.ok(all["mcp__regtest__save"], "tool should be in the registry");
  } finally {
    unregisterMcpTools(prefix("regtest"));
  }
});

test("mcp__<server>__ prefix filter matches only that server's tools", () => {
  registerMcpTool(
    convertMcpTool({ name: "a", inputSchema: { type: "object" } }, "alpha"),
  );
  registerMcpTool(
    convertMcpTool({ name: "b", inputSchema: { type: "object" } }, "beta"),
  );
  try {
    const alphaTools = Object.values(getMcpTools()).filter((t) =>
      t.id.startsWith(prefix("alpha")),
    );
    assert.equal(alphaTools.length, 1);
    assert.equal(alphaTools[0].id, "mcp__alpha__a");
  } finally {
    unregisterMcpTools(prefix("alpha"));
    unregisterMcpTools(prefix("beta"));
  }
});

test("unregisterMcpTools removes a disconnected server's tools", () => {
  registerMcpTool(
    convertMcpTool({ name: "x", inputSchema: { type: "object" } }, "gone"),
  );
  assert.ok(getMcpTools()["mcp__gone__x"], "precondition: tool registered");

  unregisterMcpTools(prefix("gone"));

  assert.equal(
    getMcpTools()["mcp__gone__x"],
    undefined,
    "tool must be removed after disconnect",
  );
});
