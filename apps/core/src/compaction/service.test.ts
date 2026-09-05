import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookRuntime } from "../hooks/runtime.js";
import { FileMemoryStorage } from "./storage.js";
import { MemoryService } from "./service.js";

test("MemoryService compacts old messages and exposes prompt context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-memory-"));
  try {
    const service = new MemoryService("session-1", {
      storage: new FileMemoryStorage(dir),
      hooks: createHookRuntime(),
    });

    service.addMessage("user", "old request in docs/superpowers/plans/x.md");
    service.addMessage("assistant", "old answer");
    service.addMessage("user", "second request");
    service.addMessage("assistant", "second answer");
    service.addMessage("user", "middle request");
    service.addMessage("assistant", "middle answer");
    service.addMessage("user", "latest request");
    service.addMessage("assistant", "latest answer");

    const result = await service.compact();
    const context = service.getPromptContext();

    assert.equal(result.success, true);
    // The founding instruction is preserved verbatim at the head, not folded
    // into the summary — otherwise the next compaction summarizes the summary
    // of it, and the brief decays fastest of anything in the window.
    assert.ok(context.summary?.includes("second request"));
    assert.deepEqual(
      context.recentMessages.map((message) => message.content),
      [
        "old request in docs/superpowers/plans/x.md",
        "middle request",
        "middle answer",
        "latest request",
        "latest answer",
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MemoryService respects PreCompact block", async () => {
  const hooks = {
    ...createHookRuntime(),
    async runPreCompact() {
      return { allowed: false, blockReason: "blocked by test" };
    },
  };

  const service = new MemoryService("session-1", { hooks });
  service.addMessage("user", "old request");
  service.addMessage("assistant", "old answer");
  service.addMessage("user", "middle request");
  service.addMessage("assistant", "middle answer");
  service.addMessage("user", "latest request");
  service.addMessage("assistant", "latest answer");

  const result = await service.compact();

  assert.equal(result.success, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "blocked by test");
});

test("blocked compaction backs off instead of retrying every message", async () => {
  const hooks = {
    ...createHookRuntime(),
    async runPreCompact() {
      return { allowed: false, blockReason: "blocked by test" };
    },
  };

  const dir = mkdtempSync(join(tmpdir(), "freecode-memory-"));
  try {
    const service = new MemoryService(`session-backoff-${Date.now()}`, {
      hooks,
      storage: new FileMemoryStorage(dir),
      // Buffer larger than the context limit → threshold 0 → always due
      config: { autoCompactBufferTokens: 1_000_000 },
    });
    service.addMessage("user", "old request");
    service.addMessage("assistant", "old answer");
    service.addMessage("user", "middle request");
    service.addMessage("assistant", "middle answer");
    service.addMessage("user", "latest request");

    assert.equal(service.shouldCompact("gpt-4o"), true);
    const result = await service.compact();
    assert.equal(result.blocked, true);
    assert.equal(service.shouldCompact("gpt-4o"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shouldCompact uses the provider's measured tokens over its own estimate", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-memory-"));
  try {
    const service = new MemoryService(`session-measured-${Date.now()}`, {
      storage: new FileMemoryStorage(dir),
      config: { autoCompactBufferTokens: 10_000 },
    });

    // A tool-heavy turn: the real request was huge, but memory only recorded
    // the stub, so its own estimate stays tiny.
    service.addMessage("user", "read every file");
    service.addMessage("assistant", "[Executed 1 tools]");

    // Estimate alone is nowhere near the limit — this is the old behaviour
    // that let sessions overflow the window without ever compacting.
    assert.equal(service.shouldCompact("MiniMax-M2", 196_608), false);

    // Given what the provider actually measured, it must fire.
    assert.equal(service.shouldCompact("MiniMax-M2", 196_608, 190_000), true);
    // Still below the threshold once the buffer is applied.
    assert.equal(service.shouldCompact("MiniMax-M2", 196_608, 100_000), false);
    // A zero/absent measurement falls back to the estimate rather than
    // reading as "empty context".
    assert.equal(service.shouldCompact("MiniMax-M2", 196_608, 0), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
