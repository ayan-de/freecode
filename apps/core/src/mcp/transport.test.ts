import test from "node:test";
import assert from "node:assert/strict";
import { createStdioTransport, createHttpTransport } from "./transport.js";

test("createStdioTransport builds a transport for a local command", () => {
  const transport = createStdioTransport({
    command: "npx",
    args: ["-y", "@example/server"],
  });
  assert.ok(transport);
});

test("createHttpTransport builds a transport for a valid URL", () => {
  const transport = createHttpTransport({
    url: "https://api.example.com/mcp",
    headers: { Authorization: "Bearer token" },
  });
  assert.ok(transport);
});

test("createHttpTransport rejects an invalid URL", () => {
  assert.throws(() => createHttpTransport({ url: "not-a-url" }));
});
