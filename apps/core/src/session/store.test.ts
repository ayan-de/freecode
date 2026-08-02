import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SessionStore, createSessionStore } from "./store.js";
import { rm } from "fs/promises";

describe("SessionStore", () => {
  const testDir = "/tmp/freecode-test-session-store";
  let store: SessionStore;

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    store = await createSessionStore(testDir);
  });

  it("creates session directory with meta.json", async () => {
    const sessionId = await store.createSession({
      title: "Test Session",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const meta = await store.getMeta(sessionId);
    assert.notEqual(meta, null);
    assert.equal(meta!.id, sessionId);
    assert.equal(meta!.title, "Test Session");
    assert.equal(meta!.status, "active");
  });

  it("appends messages to messages.jsonl", async () => {
    const sessionId = await store.createSession({
      title: "Test",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const msg = {
      id: "msg-1",
      role: "user" as const,
      parts: [{ type: "text" as const, content: "hello" }],
      timestamp: Date.now(),
    };
    await store.appendMessage(sessionId, msg);
    const messages = await store.getMessages(sessionId);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].parts[0], { type: "text", content: "hello" });
  });

  it("marks message as interrupted", async () => {
    const sessionId = await store.createSession({
      title: "Test",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const msg = {
      id: "msg-1",
      role: "assistant" as const,
      parts: [],
      timestamp: Date.now(),
    };
    await store.appendMessage(sessionId, msg);
    await store.markInterrupted(sessionId, "msg-1");
    const msgs = await store.getMessages(sessionId);
    assert.equal(msgs[0].interrupted, true);
  });

  it("detects interrupted sessions", async () => {
    const sessionId = await store.createSession({
      title: "Test",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const msg = {
      id: "msg-1",
      role: "assistant" as const,
      parts: [],
      timestamp: Date.now(),
    };
    await store.appendMessage(sessionId, msg);
    await store.markInterrupted(sessionId, "msg-1");
    const interrupted = await store.getInterruptedSession();
    assert.equal(interrupted?.sessionId, sessionId);
  });

  it("lists sessions with filter", async () => {
    const s1 = await store.createSession({
      title: "S1",
      projectPath: "/tmp/p1",
      provider: "claude",
    });
    // Ensure different lastTurnAt timestamps
    await new Promise((r) => setTimeout(r, 10));
    const s2 = await store.createSession({
      title: "S2",
      projectPath: "/tmp/p2",
      provider: "claude",
    });
    await store.updateStatus(s1, "archived");
    const active = await store.list({ status: "active" });
    // After archiving s1, only s2 remains active
    assert.equal(active.length, 1);
    assert.equal(active[0].title, "S2");
    const archived = await store.list({ status: "archived" });
    assert.equal(archived.length, 1);
    assert.equal(archived[0].title, "S1");
  });

  it("forks session with new id", async () => {
    const parentId = await store.createSession({
      title: "Parent",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const forkId = await store.fork(parentId);
    const forkMeta = await store.getMeta(forkId);
    assert.equal(forkMeta?.parentId, parentId);
    assert.notEqual(forkId, parentId);
  });

  it("updates session meta", async () => {
    const sessionId = await store.createSession({
      title: "Original",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    await store.updateMeta(sessionId, { title: "Updated" });
    const meta = await store.getMeta(sessionId);
    assert.equal(meta?.title, "Updated");
  });

  it("deletes session", async () => {
    const sessionId = await store.createSession({
      title: "ToDelete",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    await store.deleteSession(sessionId);
    const meta = await store.getMeta(sessionId);
    assert.equal(meta?.status, "deleted");
  });
});
