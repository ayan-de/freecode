import test from "node:test"
import assert from "node:assert/strict"
import { summarizeMessages } from "./summarizer.js"
import type { MemoryMessage } from "./types.js"

function msg(id: string, role: MemoryMessage["role"], content: string): MemoryMessage {
  return { id, role, content, tokenCount: Math.ceil(content.length / 4), timestamp: Number(id) }
}

test("summarizeMessages creates an anchored continuation summary", () => {
  const summary = summarizeMessages({
    sessionId: "session-1",
    previousSummary: undefined,
    messages: [
      msg("1", "user", "Add memory compaction to apps/core/src/agent/loop.ts"),
      msg("2", "assistant", "Implemented selector and storage"),
    ],
  })

  assert.match(summary.content, /## Goal/)
  assert.match(summary.content, /memory compaction/)
  assert.match(summary.content, /## Recent Progress/)
  assert.equal(summary.originalMessageCount, 2)
})

test("summarizeMessages carries previous summary forward", () => {
  const summary = summarizeMessages({
    sessionId: "session-1",
    previousSummary: "## Goal\n- Build memory safely",
    messages: [msg("3", "user", "Now wire it into prompts")],
  })

  assert.match(summary.content, /Previous Summary/)
  assert.match(summary.content, /Build memory safely/)
  assert.match(summary.content, /wire it into prompts/)
})