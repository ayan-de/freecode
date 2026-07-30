import test from "node:test";
import assert from "node:assert/strict";
import { buildAnthropicSystemParam, buildToolsParam } from "./utils.js";

test("buildAnthropicSystemParam passes a string through unchanged", () => {
  assert.equal(buildAnthropicSystemParam("be helpful"), "be helpful");
});

// Regression: the AI SDK's standardizePrompt requires every array item to
// have role === "system"; a { type: "text", text } content-part shape throws
// AI_InvalidPromptError. See CHANGELOG 0.6.2.
test("buildAnthropicSystemParam produces role: system entries the AI SDK accepts", () => {
  const result = buildAnthropicSystemParam([
    { text: "rule one", cache: true },
    { text: "rule two" },
  ]);
  assert.ok(Array.isArray(result));
  for (const entry of result as Array<Record<string, unknown>>) {
    assert.equal(entry.role, "system");
    assert.equal(typeof entry.content, "string");
  }
});

test("buildAnthropicSystemParam only sets cacheControl providerOptions when block.cache is true", () => {
  const [cached, uncached] = buildAnthropicSystemParam([
    { text: "a", cache: true },
    { text: "b" },
  ]) as Array<{ providerOptions?: unknown }>;
  assert.ok(cached.providerOptions);
  assert.equal(uncached.providerOptions, undefined);
});

test("buildToolsParam returns undefined for no tools", () => {
  assert.equal(buildToolsParam(undefined), undefined);
  assert.equal(buildToolsParam([]), undefined);
});

// Regression: raw JSON Schema objects passed unwrapped as inputSchema hit the
// AI SDK's asSchema() ambiguous-shape detection — it checks for a "~standard"
// marker and otherwise calls the object as a function (schema()), throwing
// "H is not a function" or misrouting into Zod's own toJSONSchema internals.
// jsonSchema() tags the object so asSchema() short-circuits via isSchema().
test("buildToolsParam wraps inputSchema so it is not a bare plain object", () => {
  const tools = buildToolsParam([
    {
      name: "read",
      description: "read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  ]);
  assert.ok(tools);
  const inputSchema = tools!.read.inputSchema as Record<string, unknown>;
  // A raw JSON Schema object would just be { type: "object", properties: {...} }
  // with no marker; the wrapped Schema instance exposes jsonSchema/validate.
  assert.notEqual(typeof inputSchema, "function");
  assert.ok("jsonSchema" in inputSchema || "validate" in inputSchema);
});
