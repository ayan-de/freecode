import test from "node:test"
import assert from "node:assert/strict"
import { rm } from "fs/promises"
import { createAgentLoop } from "./loop.js"
import { createSessionStore, type SessionStore, type SerializedMessage } from "../session/store.js"
import { PromptCompiler } from "../context/compiler.js"
import type { Message, ToolCall } from "./types.js"

test("PromptCompiler.compileSystemBlocks splits static and dynamic parts correctly", () => {
  const compiler = new PromptCompiler("/path/to/project", "my-project", "build")
  const tools = [
    { name: "read", description: "Read file", parameters: { type: "object", properties: {} } },
    { name: "write", description: "Write file", parameters: { type: "object", properties: {} } }
  ]
  const tree = "📄 index.js"
  const gitHead = "abc12345"

  const blocks = compiler.compileSystemBlocks(
    tools,
    tree,
    gitHead,
    "",
    "anthropic",
    "claude-sonnet-4-5",
    "Some memory summary"
  )

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].cache, true)
  assert.equal(blocks[1].cache, false)

  // Static section has system prompts and tools
  assert.ok(blocks[0].text.includes("BUILD mode"))
  assert.ok(blocks[0].text.includes("Available tools"))
  assert.ok(blocks[0].text.includes("read"))
  assert.ok(blocks[0].text.includes("write"))

  // Dynamic section has tree, git head, path, and memory
  assert.ok(blocks[1].text.includes("my-project"))
  assert.ok(blocks[1].text.includes("/path/to/project"))
  assert.ok(blocks[1].text.includes("📄 index.js"))
  assert.ok(blocks[1].text.includes("Some memory summary"))
  assert.ok(blocks[1].text.includes("Current Time"))
})

test("AgentLoop.loadHistory reconstructs the message list correctly", async () => {
  const testDir = "/tmp/freecode-test-loop-caching-history"
  await rm(testDir, { recursive: true, force: true })
  const store: SessionStore = await createSessionStore(testDir)

  const sessionId = await store.createSession({
    title: "Test Caching",
    projectPath: "/tmp/test",
    provider: "mock",
  })

  // Append user message
  const userMsg: SerializedMessage = {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", content: "Tell me a joke" }],
    timestamp: Date.now(),
  }
  await store.appendMessage(sessionId, userMsg, "/tmp/test")

  // Append assistant message with tool call
  const assistantMsg: SerializedMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", content: "Thinking..." },
      {
        type: "tool",
        tool: { name: "bash", args: { command: "echo 'haha'" } },
        result: "haha\n",
      }
    ],
    timestamp: Date.now(),
  }
  await store.appendMessage(sessionId, assistantMsg, "/tmp/test")

  const loop = createAgentLoop(sessionId, { sessionStore: store })
  // Set path manually to avoid scanning in tests
  ;(loop as any).state.projectPath = "/tmp/test"

  await (loop as any).loadHistory()

  const history: Message[] = (loop as any).history
  assert.equal(history.length, 2)
  assert.equal(history[0].role, "user")
  assert.equal(history[0].parts[0].type, "text")
  assert.equal(history[0].parts[0].content, "Tell me a joke")

  assert.equal(history[1].role, "assistant")
  assert.equal(history[1].parts[0].type, "text")
  assert.equal(history[1].parts[0].content, "Thinking...")
  assert.equal(history[1].parts[1].type, "tool")
  assert.equal((history[1].parts[1] as any).tool.tool, "bash")
  assert.equal((history[1].parts[1] as any).tool.args.command, "echo 'haha'")
  assert.equal((history[1].parts[1] as any).result, "haha\n")

  await rm(testDir, { recursive: true, force: true })
})

test("AgentLoop.maybeTimeBasedMicrocompact prunes old tool results after idle gap", () => {
  const loop = createAgentLoop("test-session")

  const oldTimestamp = Date.now() - 6 * 60_000 // 6 minutes ago
  const messages: Message[] = [
    {
      id: "1",
      role: "user",
      parts: [{ type: "text", content: "run command" }],
      timestamp: oldTimestamp
    },
    {
      id: "2",
      role: "assistant",
      parts: [
        { type: "text", content: "Output:" },
        {
          type: "tool",
          tool: { id: "t-1", tool: "bash", args: {}, execution: "sequential" },
          result: "A very long tool output content that exceeds 200 characters..." + "x".repeat(300)
        }
      ],
      timestamp: oldTimestamp
    }
  ]

  // Gap is 6 minutes, so it should compact
  const compacted = (loop as any).maybeTimeBasedMicrocompact(messages, 5)

  assert.equal(compacted.length, 2)
  assert.equal(compacted[1].role, "assistant")
  assert.equal(compacted[1].parts[0].type, "text")
  assert.equal(compacted[1].parts[1].type, "tool")
  assert.equal((compacted[1].parts[1] as any).result, "[Old tool result content cleared]")

  // Gap is small (1 minute), should not compact
  const recentMessages: Message[] = messages.map(m => ({ ...m, timestamp: Date.now() }))
  const notCompacted = (loop as any).maybeTimeBasedMicrocompact(recentMessages, 5)
  assert.notEqual((notCompacted[1].parts[1] as any).result, "[Old tool result content cleared]")
})
