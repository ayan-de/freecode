import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SessionManager, createSessionManager } from "./manager.js";
import { createSessionStore, type SessionStore } from "./store.js";

describe("SessionManager", () => {
  const testDir = path.join(os.tmpdir(), "freecode-test-session-manager");
  let sessionStore: SessionStore;
  let manager: SessionManager;

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    sessionStore = await createSessionStore(testDir);
    manager = createSessionManager(sessionStore);
  });

  describe("start", () => {
    it("creates a new session and returns session id", async () => {
      const sessionId = await manager.start(
        "/tmp/test-project",
        "claude",
        "Test Session",
      );
      assert.notEqual(sessionId, undefined);
      assert.equal(typeof sessionId, "string");
    });

    it("stores session metadata via sessionStore", async () => {
      const sessionId = await manager.start(
        "/tmp/test-project",
        "claude",
        "Test Session",
      );
      const meta = await sessionStore.getMeta(sessionId);
      assert.notEqual(meta, null);
      assert.equal(meta!.title, "Test Session");
      assert.equal(meta!.projectPath, "/tmp/test-project");
      assert.equal(meta!.provider, "claude");
      assert.equal(meta!.status, "active");
    });
  });

  describe("resume", () => {
    it("loads session context with messages", async () => {
      const sessionId = await manager.start(
        "/tmp/test-project",
        "claude",
        "Test Session",
      );
      await manager.appendMessage(sessionId, {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", content: "Hello" }],
        timestamp: Date.now(),
      });

      const ctx = await manager.resume(sessionId);
      assert.equal(ctx.id, sessionId);
      assert.equal(ctx.title, "Test Session");
      assert.equal(ctx.messages.length, 1);
      assert.equal(ctx.messages[0].parts[0].content, "Hello");
    });

    it("injects resume marker when session is interrupted", async () => {
      const sessionId = await manager.start(
        "/tmp/test-project",
        "claude",
        "Test Session",
      );
      const msgId = "msg-interrupted";
      await manager.appendMessage(sessionId, {
        id: msgId,
        role: "assistant",
        parts: [],
        timestamp: Date.now(),
      });
      await manager.markInterrupted(sessionId, msgId);

      const ctx = await manager.resume(sessionId);
      // Should have original message + injected resume message
      const lastMsg = ctx.messages[ctx.messages.length - 1];
      assert.equal(lastMsg.role, "user");
      assert.equal(
        lastMsg.parts[0].content,
        "Continue from where you left off.",
      );
    });
  });

  describe("appendMessage", () => {
    it("appends message to session via sessionStore", async () => {
      const sessionId = await manager.start("/tmp/test-project", "claude");
      await manager.appendMessage(sessionId, {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", content: "Test" }],
        timestamp: Date.now(),
      });

      const messages = await sessionStore.getMessages(sessionId);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].parts[0].content, "Test");
    });
  });

  describe("markInterrupted", () => {
    it("marks last message as interrupted", async () => {
      const sessionId = await manager.start("/tmp/test-project", "claude");
      const msgId = "msg-1";
      await manager.appendMessage(sessionId, {
        id: msgId,
        role: "assistant",
        parts: [],
        timestamp: Date.now(),
      });

      await manager.markInterrupted(sessionId, msgId);
      const messages = await sessionStore.getMessages(sessionId);
      assert.equal(messages[0].interrupted, true);

      const meta = await sessionStore.getMeta(sessionId);
      assert.equal(meta!.status, "interrupted");
    });
  });

  describe("list", () => {
    it("returns all sessions from sessionStore", async () => {
      await manager.start("/tmp/p1", "claude", "Session 1");
      await manager.start("/tmp/p2", "claude", "Session 2");

      const sessions = await manager.list();
      assert.equal(sessions.length, 2);
    });

    it("filters by projectPath", async () => {
      await manager.start("/tmp/p1", "claude", "Session 1");
      await manager.start("/tmp/p2", "claude", "Session 2");

      const sessions = await manager.list({ projectPath: "/tmp/p1" });
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].title, "Session 1");
    });

    it("filters by status", async () => {
      const s1 = await manager.start("/tmp/p1", "claude", "Session 1");
      await manager.start("/tmp/p2", "claude", "Session 2");
      await manager.archive(s1);

      const active = await manager.list({ status: "active" });
      assert.equal(active.length, 1);
      assert.equal(active[0].title, "Session 2");
    });
  });

  describe("archive", () => {
    it("archives session via sessionStore", async () => {
      const sessionId = await manager.start("/tmp/test-project", "claude");
      await manager.archive(sessionId);

      const meta = await sessionStore.getMeta(sessionId);
      assert.equal(meta!.status, "archived");
    });
  });

  describe("delete", () => {
    it("deletes session via sessionStore", async () => {
      const sessionId = await manager.start("/tmp/test-project", "claude");
      await manager.delete(sessionId);

      // After delete, session should be marked as deleted in store
      const meta = await sessionStore.getMeta(sessionId);
      assert.equal(meta!.status, "deleted");
    });
  });

  describe("fork", () => {
    it("forks session via sessionStore", async () => {
      const sessionId = await manager.start(
        "/tmp/test-project",
        "claude",
        "Parent",
      );
      await manager.appendMessage(sessionId, {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", content: "Hello" }],
        timestamp: Date.now(),
      });

      const forkId = await manager.fork(sessionId);
      assert.notEqual(forkId, sessionId);

      const forkMeta = await sessionStore.getMeta(forkId);
      assert.equal(forkMeta!.parentId, sessionId);
      assert.equal(forkMeta!.title, "Parent (fork)");

      const forkMessages = await sessionStore.getMessages(forkId);
      assert.equal(forkMessages.length, 1);
    });
  });

  describe("switch", () => {
    it("sets current session without loading", async () => {
      const sessionId = await manager.start("/tmp/test-project", "claude");
      await manager.switch(sessionId);

      const current = await manager.getCurrent();
      assert.notEqual(current, null);
      assert.equal(current!.id, sessionId);
    });
  });
});
