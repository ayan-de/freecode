import test from "node:test";
import assert from "node:assert/strict";
import { McpServerSchema, McpConfigSchema } from "./types.js";

test("McpServerSchema should parse valid local server config", () => {
  const config = {
    name: "contextcarry",
    type: "local",
    command: ["npx", "-y", "@thisisayande/contextcarry-mcp"],
    enabled: true,
  };
  const result = McpServerSchema.safeParse(config);
  assert.equal(result.success, true);
});

test("McpServerSchema should reject remote server without url", () => {
  const config = {
    name: "github",
    type: "remote",
  };
  const result = McpServerSchema.safeParse(config);
  assert.equal(result.success, false);
});
