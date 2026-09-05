import test from "node:test";
import assert from "node:assert/strict";
import { destUrl } from "./forward.js";
import { audit, isModelEndpoint } from "./audit.js";

test("keeps the upstream path prefix when joining /v1/messages", () => {
  assert.equal(
    destUrl("https://api.minimax.io/anthropic", "/v1/messages").href,
    "https://api.minimax.io/anthropic/v1/messages",
  );
});

test("messages and chat/completions are the model; a GitHub path is not", () => {
  assert.equal(isModelEndpoint("/v1/messages"), true);
  assert.equal(isModelEndpoint("/messages"), true);
  assert.equal(isModelEndpoint("/v1/chat/completions"), true);
  assert.equal(isModelEndpoint("/repos/django/django"), false);
});

test("audit fails closed on any non-model path", () => {
  const result = audit([
    { modelEndpoint: true, method: "POST", path: "/v1/messages", host: "api.minimax.io", status: 200 },
    { modelEndpoint: false, method: "GET", path: "/repos/django/django", host: "github.com", status: 200 },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.modelCalls, 1);
  assert.equal(result.leaks[0]?.path, "/repos/django/django");
});
