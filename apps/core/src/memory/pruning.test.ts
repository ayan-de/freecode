import test from "node:test"
import assert from "node:assert/strict"
import { MemoryService } from "./service.js"

test("assistant tool-like output is capped before storage", () => {
  // Use unique session to avoid loading stale state from previous test runs
  const sessionId = `session-prune-${Date.now()}`
  const service = new MemoryService(sessionId, {
    config: { maxToolOutputChars: 20 },
  })

  service.addMessage("assistant", `Tool read: ${"x".repeat(100)}`)
  const context = service.getPromptContext()

  assert.ok(context.recentMessages[0].content.length < 80)
  assert.match(context.recentMessages[0].content, /truncated/)
})