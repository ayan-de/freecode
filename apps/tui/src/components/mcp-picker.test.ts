import { test } from "node:test";
import assert from "node:assert/strict";
import { statusLabel } from "./mcp-picker.js";
import type { McpServerStatus } from "../ipc/client.js";

function server(overrides: Partial<McpServerStatus> = {}): McpServerStatus {
  return {
    name: "test",
    type: "local",
    enabled: true,
    status: "disconnected",
    toolCount: 0,
    tools: [],
    ...overrides,
  };
}

test("statusLabel shows disabled for a disabled server regardless of status", () => {
  assert.match(
    statusLabel(server({ enabled: false, status: "connected" })),
    /disabled/,
  );
});

test("statusLabel shows tool count for a connected server", () => {
  assert.match(
    statusLabel(server({ status: "connected", toolCount: 3 })),
    /connected · 3 tools/,
  );
});

test("statusLabel shows not connected for an enabled, disconnected server", () => {
  assert.match(
    statusLabel(server({ status: "disconnected" })),
    /not connected/,
  );
});
