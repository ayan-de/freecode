import test from "node:test";
import assert from "node:assert/strict";
import { MemoryService } from "./service.js";

// The bound moved from MemoryService.normalizeContent (which clipped the
// tail — i.e. the most recent tools) into the transcript renderer, which
// drops the oldest calls instead. What is capped is a turn, not a message.
test("a tool turn is capped before storage, keeping the newest calls", () => {
  // Use unique session to avoid loading stale state from previous test runs
  const sessionId = `session-prune-${Date.now()}`;
  const service = new MemoryService(sessionId, {
    config: { maxToolOutputChars: 300 },
  });

  service.addToolTurn(
    "",
    Array.from({ length: 20 }, (_, i) => ({
      tool: "read",
      args: { filePath: `src/f${i}.ts` },
      output: "x".repeat(100),
    })),
  );
  const content = service.getPromptContext().recentMessages[0].content;

  assert.ok(content.length < 600, `bounded, got ${content.length}`);
  assert.match(content, /earlier tool calls omitted/);
  assert.match(content, /f19\.ts/, "newest call survives");
  assert.doesNotMatch(content, /f0\.ts/);
});
