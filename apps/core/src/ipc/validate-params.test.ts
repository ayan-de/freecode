import test from "node:test";
import assert from "node:assert/strict";
import { METHODS, REQUIRED_PARAMS } from "@thisisayande/freecode-shared";
import { validateParams, INVALID_PARAMS } from "./validate-params.js";
import { handleRequest } from "../server.js";

test("a missing required param names the field", () => {
  const reason = validateParams("session.send", { sessionId: "s1" });
  assert.match(reason ?? "", /message/);
  assert.match(reason ?? "", /Missing required parameter/);
});

test("a mistyped required param reports both types", () => {
  const reason = validateParams("session.send", {
    sessionId: 42,
    message: "hi",
  });
  assert.equal(reason, 'Parameter "sessionId" must be string, got number');
});

// null is how a JSON caller most often expresses "I had nothing for this",
// and it hits the same undefined-deep-inside failure a missing key does.
test("null is treated as missing, not as a value", () => {
  assert.match(
    validateParams("session.stop", { sessionId: null }) ?? "",
    /Missing required parameter/,
  );
});

test("arrays and objects are distinguished", () => {
  assert.equal(validateParams("question.answer", {
    requestId: "r1",
    answers: ["yes"],
  }), undefined);
  assert.match(
    validateParams("question.answer", { requestId: "r1", answers: {} }) ?? "",
    /must be array, got object/,
  );
});

test("valid params pass, and unknown extras are ignored", () => {
  assert.equal(
    validateParams("session.send", {
      sessionId: "s1",
      message: "hi",
      somethingNewer: true,
    }),
    undefined,
  );
});

test("methods with no mandatory params accept an empty object", () => {
  for (const method of ["config.get", "usage.get", "session.list"]) {
    assert.equal(validateParams(method, {}), undefined, method);
  }
});

test("every declared method has a param contract", () => {
  const missing = Object.keys(METHODS).filter(
    (m) => !(m in REQUIRED_PARAMS),
  );
  assert.deepEqual(missing, []);
});

// The point of the whole exercise: a bad call must not look like a server bug.
test("handleRequest answers -32602, not -32603, for bad params", async () => {
  const response = await handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "session.send",
    params: { sessionId: "s1" },
  });

  assert.equal(response.error?.code, INVALID_PARAMS);
  assert.match(response.error?.message ?? "", /message/);
  assert.equal(response.result, undefined);
});

test("an unknown method is still -32601", async () => {
  const response = await handleRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "nope.nope",
  });
  assert.equal(response.error?.code, -32601);
});
