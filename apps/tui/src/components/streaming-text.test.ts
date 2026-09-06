import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { StreamingAssistantMessage } from "./message-row.js";
import {
  appendAssistantDelta,
  finalizeAssistantText,
  appendThinkingDelta,
  createThinkingMessage,
  clearAllMessages,
} from "./index.js";
import { getMessages } from "../state/message-store.js";
import { ThinkingMessage } from "./message-row.js";

beforeEach(() => {
  clearAllMessages();
});

test("StreamingAssistantMessage renders appended deltas as markdown", () => {
  const msg = new StreamingAssistantMessage("Hel");
  msg.append("lo ");
  msg.append("world");
  const out = msg.render(80).join("\n");
  assert.ok(out.includes("Hello world"));
  assert.equal(msg.done, false);
});

test("finalize with a snapshot replaces the streamed buffer", () => {
  const msg = new StreamingAssistantMessage("partial gar");
  msg.finalize("The clean full text.");
  assert.equal(msg.content, "The clean full text.");
  assert.equal(msg.done, true);
  assert.ok(msg.render(80).join("\n").includes("The clean full text."));
});

test("finalize without a snapshot keeps what streamed (abort path)", () => {
  const msg = new StreamingAssistantMessage("got this far");
  msg.finalize();
  assert.equal(msg.content, "got this far");
  assert.equal(msg.done, true);
});

test("deltas share one row; the snapshot settles it; the next turn starts a new row", () => {
  appendAssistantDelta("Let me check ");
  appendAssistantDelta("the tests.");
  assert.equal(getMessages().length, 1);

  const settled = finalizeAssistantText("Let me check the tests.");
  assert.ok(settled);
  assert.equal(getMessages().length, 1);
  assert.equal(settled!.content, "Let me check the tests.");

  // Next internal turn (prose after tool calls) gets its own transcript row —
  // this is the "intermediate text is no longer dropped" behavior.
  appendAssistantDelta("All 3 pass.");
  assert.equal(getMessages().length, 2);
  finalizeAssistantText("All 3 pass.");
  assert.equal(getMessages().length, 2);
});

test("a snapshot with no live row renders as a settled assistant message (non-streaming path)", () => {
  const inst = finalizeAssistantText("Full reply, no deltas.");
  assert.ok(inst);
  assert.equal(getMessages().length, 1);
  assert.equal(getMessages()[0]!.type, "assistant");
});

test("finalize with neither a live row nor content is a no-op", () => {
  assert.equal(finalizeAssistantText(), null);
  assert.equal(getMessages().length, 0);
});

test("thinking deltas stream into one block and the snapshot replaces it", () => {
  appendThinkingDelta("I should ", 1000);
  appendThinkingDelta("read the file.", 1000);
  const messages = getMessages();
  assert.equal(messages.length, 1);
  const component = messages[0]!.component as ThinkingMessage;
  assert.ok(component instanceof ThinkingMessage);

  // Expanded render carries the streamed reasoning.
  component.toggle();
  assert.ok(component.render(80).join("\n").includes("I should"));

  // Turn-end snapshot replaces the buffer wholesale (authoritative).
  createThinkingMessage("I should read the file. Done.", 1000);
  assert.equal(getMessages().length, 1);
  assert.ok(component.render(80).join("\n").includes("Done."));
});

test("a settled thinking block does not absorb the next turn's deltas", () => {
  appendThinkingDelta("first turn", 1000);
  const first = getMessages()[0]!.component as ThinkingMessage;
  first.setDone();
  appendThinkingDelta("second turn", 2000);
  assert.equal(getMessages().length, 2);
});
