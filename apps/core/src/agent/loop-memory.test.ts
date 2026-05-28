import test from "node:test"
import assert from "node:assert/strict"
import { renderPromptMemoryContext } from "../memory/selector.js"

test("rendered memory context is suitable for AgentLoop prompt insertion", () => {
  const rendered = renderPromptMemoryContext({
    summary: "## Goal\n- Build memory",
    recentMessages: [
      { id: "1", role: "user", content: "latest request", timestamp: 1, tokenCount: 10 },
      { id: "2", role: "assistant", content: "latest answer", timestamp: 2, tokenCount: 10 },
    ],
    tokenCount: 20,
  })

  assert.match(rendered, /Compacted session summary/)
  assert.match(rendered, /Recent session messages/)
  assert.match(rendered, /latest request/)
})