import assert from "node:assert/strict";
import test from "node:test";
import { clearMessages, getMessages } from "../state/message-store.js";
import { createToolProgressMessage } from "./index.js";

test("createToolProgressMessage adds a renderable tool message", () => {
  clearMessages();

  const message = createToolProgressMessage("call-1", "Write", { path: "FREECODE.md" });

  const messages = getMessages();
  assert.equal(messages.length, 1);
  assert.equal(messages[0], message);
  assert.equal(message.type, "tool");
  assert.match(message.component.render(80).join("\n"), /Write/);
  assert.match(message.component.render(80).join("\n"), /FREECODE\.md/);
});
