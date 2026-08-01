import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSessionStore, type SerializedMessage } from "./store.js";
import { createAgentLoop } from "../agent/loop.js";

// A resumed session must hand images back exactly as they went in — the base64
// is the whole payload, and a lossy round-trip means the model silently stops
// seeing an image it could see before the resume.
test("session store: image parts survive an append/read round-trip", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-session-"));
  const projectPath = "/tmp/some-project";
  const store = await createSessionStore(baseDir);

  const sessionId = await store.createSession({
    title: "image test",
    projectPath,
    provider: "anthropic",
  });

  const message: SerializedMessage = {
    id: "msg-1",
    role: "user",
    parts: [
      { type: "text", content: "Image from the tool call above:" },
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUg==",
        mediaType: "image/png",
        altText: "shot.png (image)",
      },
    ],
    timestamp: Date.now(),
  };

  await store.appendMessage(sessionId, message, projectPath);
  const loaded = await store.getMessages(sessionId, projectPath);

  assert.equal(loaded.length, 1);
  const parts = loaded[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].type, "text");
  assert.equal(parts[1].type, "image");
  assert.equal(parts[1].data, "iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(parts[1].mediaType, "image/png");
  assert.equal(parts[1].altText, "shot.png (image)");

  fs.rmSync(baseDir, { recursive: true, force: true });
});

// The serialized part must map back to an image MessagePart. Before the image
// branch existed it fell through to the tool-part `else`, so a resumed session
// handed the provider a tool call with an empty name.
test("agent loop: loadHistory restores an image part rather than a malformed tool part", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-session-"));
  const projectPath = "/tmp/some-project";
  const store = await createSessionStore(baseDir);

  const sessionId = await store.createSession({
    title: "image test",
    projectPath,
    provider: "anthropic",
  });

  await store.appendMessage(
    sessionId,
    {
      id: "msg-1",
      role: "user",
      parts: [
        { type: "text", content: "look at this" },
        {
          type: "image",
          data: "iVBORw0KGgoAAAANSUhEUg==",
          mediaType: "image/webp",
          altText: "diagram.webp (image)",
        },
      ],
      timestamp: Date.now(),
    },
    projectPath,
  );

  const loop = createAgentLoop(sessionId, { sessionStore: store }) as any;
  loop.state.projectPath = projectPath;
  await loop.loadHistory();

  const restored = loop.history[0].parts;
  assert.equal(restored.length, 2);
  assert.equal(restored[0].type, "text");
  assert.equal(restored[1].type, "image");
  assert.equal(restored[1].data, "iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(restored[1].mediaType, "image/webp");
  assert.equal(restored[1].altText, "diagram.webp (image)");

  fs.rmSync(baseDir, { recursive: true, force: true });
});
