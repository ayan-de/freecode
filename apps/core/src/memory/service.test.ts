import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHookRuntime } from "../hooks/runtime.js"
import { FileMemoryStorage } from "./storage.js"
import { MemoryService } from "./service.js"

test("MemoryService compacts old messages and exposes prompt context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-memory-"))
  try {
    const service = new MemoryService("session-1", {
      storage: new FileMemoryStorage(dir),
      hooks: createHookRuntime(),
    })

    service.addMessage("user", "old request in docs/superpowers/plans/x.md")
    service.addMessage("assistant", "old answer")
    service.addMessage("user", "middle request")
    service.addMessage("assistant", "middle answer")
    service.addMessage("user", "latest request")
    service.addMessage("assistant", "latest answer")

    const result = await service.compact()
    const context = service.getPromptContext()

    assert.equal(result.success, true)
    assert.ok(context.summary?.includes("old request"))
    assert.deepEqual(context.recentMessages.map((message) => message.content), [
      "middle request",
      "middle answer",
      "latest request",
      "latest answer",
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("MemoryService respects PreCompact block", async () => {
  const hooks = {
    ...createHookRuntime(),
    async runPreCompact() {
      return { action: "block" as const, reason: "blocked by test" }
    },
  }

  const service = new MemoryService("session-1", { hooks })
  service.addMessage("user", "old request")
  service.addMessage("assistant", "old answer")
  service.addMessage("user", "middle request")
  service.addMessage("assistant", "middle answer")
  service.addMessage("user", "latest request")
  service.addMessage("assistant", "latest answer")

  const result = await service.compact()

  assert.equal(result.success, false)
  assert.equal(result.blocked, true)
  assert.equal(result.reason, "blocked by test")
})