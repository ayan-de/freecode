import test from "node:test";
import assert from "node:assert/strict";
import { parseReply } from "./parse.js";

const CALL = '{"calls":[{"id":"1","name":"read","args":{"path":"a.ts"}}]}';

test("the requested fence parses", () => {
  const r = parseReply(`~~~freecode\n${CALL}\n~~~`);
  assert.equal(r.violation, undefined);
  assert.deepEqual(r.toolCalls, [
    { id: "1", name: "read", args: { path: "a.ts" } },
  ]);
});

test("prose around the block costs no round trip", () => {
  // The single most likely deviation: the UI model narrates.
  const r = parseReply(
    `Sure! I'll read that file for you.\n\n~~~freecode\n${CALL}\n~~~\n\nWant me to continue?`,
  );
  assert.equal(r.violation, undefined);
  assert.equal(r.toolCalls.length, 1);
  assert.match(r.text, /Sure!/);
  assert.match(r.text, /continue\?/);
  assert.doesNotMatch(r.text, /calls/);
});

test("a backtick fence is accepted", () => {
  const r = parseReply("```freecode\n" + CALL + "\n```");
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.matchedFence, "```freecode");
});

test("a ```json fence is accepted", () => {
  const r = parseReply("```json\n" + CALL + "\n```");
  assert.equal(r.toolCalls.length, 1);
});

test("an unlabelled fence is accepted when it carries calls", () => {
  const r = parseReply("```\n" + CALL + "\n```");
  assert.equal(r.toolCalls.length, 1);
});

test("a bare unfenced object is accepted", () => {
  const r = parseReply(`Here you go: ${CALL}`);
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.matchedFence, "bare");
});

test("braces inside string arguments do not truncate the bare scan", () => {
  const r = parseReply(
    '{"calls":[{"name":"write","args":{"content":"function f() { return \\"}\\"; }"}}]}',
  );
  assert.equal(r.violation, undefined);
  assert.equal(r.toolCalls.length, 1);
  assert.match(String(r.toolCalls[0].args.content), /return/);
});

test("missing ids are synthesized rather than repaired", () => {
  const r = parseReply('~~~freecode\n{"calls":[{"name":"ls","args":{}}]}\n~~~');
  assert.equal(r.toolCalls[0].id, "call-1");
});

test("multiple calls in one block survive (batching)", () => {
  const r = parseReply(
    '~~~freecode\n{"calls":[{"name":"read","args":{"path":"a"}},{"name":"read","args":{"path":"b"}}]}\n~~~',
  );
  assert.equal(r.toolCalls.length, 2);
  assert.equal(r.toolCalls[1].id, "call-2");
});

test("a reply with no block is a normal answer, not a violation", () => {
  const r = parseReply("The bug is in the retry logic.");
  assert.equal(r.violation, undefined);
  assert.deepEqual(r.toolCalls, []);
  assert.equal(r.text, "The bug is in the retry logic.");
});

test("broken JSON inside a block is a violation", () => {
  const r = parseReply('~~~freecode\n{"calls":[{"name":}]}\n~~~');
  assert.equal(r.violation, "bad-json");
});

test("a well-formed but wrong shape is a violation", () => {
  const r = parseReply('~~~freecode\n{"calls":"read the file"}\n~~~');
  assert.equal(r.violation, "bad-shape");
});

test("a call missing a name is a violation, not a silent drop", () => {
  const r = parseReply('~~~freecode\n{"calls":[{"args":{"path":"a"}}]}\n~~~');
  assert.equal(r.violation, "bad-shape");
});

test("a fenced code block that is not a tool call is left alone", () => {
  const reply = "Here is the fix:\n\n```ts\nconst x = 1;\n```";
  const r = parseReply(reply);
  assert.equal(r.violation, undefined);
  assert.deepEqual(r.toolCalls, []);
  assert.equal(r.text, reply);
});
