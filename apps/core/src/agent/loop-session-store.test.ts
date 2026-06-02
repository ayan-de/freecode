import test from "node:test"
import assert from "node:assert/strict"
import { rm } from "fs/promises"
import { createAgentLoop } from "./loop"
import { createSessionStore, type SessionStore } from "../session/store"

test("AgentLoop accepts sessionStore in constructor config", async () => {
  const testDir = "/tmp/freecode-test-loop-session-store"
  await rm(testDir, { recursive: true, force: true })
  const store: SessionStore = await createSessionStore(testDir)

  const sessionId = await store.createSession({
    title: "Test",
    projectPath: "/tmp/test",
    provider: "mock",
  })

  const loop = createAgentLoop(sessionId, { sessionStore: store })

  // Access private field via any cast for testing
  assert.equal((loop as any).sessionStore, store)

  await rm(testDir, { recursive: true, force: true })
})

test("AgentLoop sessionStore is optional", async () => {
  const loop = createAgentLoop("test-session-id")
  assert.equal((loop as any).sessionStore, undefined)
})

test("AgentLoop appendToolMessage creates correct serialized message structure", async () => {
  const testDir = "/tmp/freecode-test-loop-session-store2"
  await rm(testDir, { recursive: true, force: true })
  const store: SessionStore = await createSessionStore(testDir)

  const sessionId = await store.createSession({
    title: "Test",
    projectPath: "/tmp/test",
    provider: "mock",
  })

  const loop = createAgentLoop(sessionId, { sessionStore: store })

  const toolCall = {
    id: "tool-1",
    tool: "read",
    args: { path: "/tmp/test.txt" },
    execution: "sequential" as const,
  }
  const result = {
    id: "result-1",
    toolCallId: "tool-1",
    tool: "read",
    title: "Read file",
    stdout: "file contents",
  }

  await (loop as any).appendToolMessage(toolCall, result)

  const messages = await store.getMessages(sessionId)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, "assistant")
  assert.equal(messages[0].parts[0].type, "tool")
  assert.equal(messages[0].parts[0].tool?.name, "read")
  assert.equal(messages[0].parts[0].result, "file contents")

  await rm(testDir, { recursive: true, force: true })
})

test("AgentLoop appendUserMessage creates correct serialized message structure", async () => {
  const testDir = "/tmp/freecode-test-loop-session-store3"
  await rm(testDir, { recursive: true, force: true })
  const store: SessionStore = await createSessionStore(testDir)

  const sessionId = await store.createSession({
    title: "Test",
    projectPath: "/tmp/test",
    provider: "mock",
  })

  const loop = createAgentLoop(sessionId, { sessionStore: store })

  await (loop as any).appendUserMessage("Hello world")

  const messages = await store.getMessages(sessionId)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, "user")
  assert.equal(messages[0].parts[0].type, "text")
  assert.equal(messages[0].parts[0].content, "Hello world")

  await rm(testDir, { recursive: true, force: true })
})

test("AgentLoop appendAssistantMessage creates correct serialized message structure", async () => {
  const testDir = "/tmp/freecode-test-loop-session-store4"
  await rm(testDir, { recursive: true, force: true })
  const store: SessionStore = await createSessionStore(testDir)

  const sessionId = await store.createSession({
    title: "Test",
    projectPath: "/tmp/test",
    provider: "mock",
  })

  const loop = createAgentLoop(sessionId, { sessionStore: store })

  await (loop as any).appendAssistantMessage("I can help with that")

  const messages = await store.getMessages(sessionId)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, "assistant")
  assert.equal(messages[0].parts[0].type, "text")
  assert.equal(messages[0].parts[0].content, "I can help with that")

  await rm(testDir, { recursive: true, force: true })
})

test("AgentLoop does not throw when sessionStore is undefined", async () => {
  const loop = createAgentLoop("test-session-id")
  // Should not throw
  await (loop as any).appendUserMessage("Hello")
  await (loop as any).appendAssistantMessage("Hi")
})
