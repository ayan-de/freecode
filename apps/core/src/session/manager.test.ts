import { describe, it, expect, beforeEach, vi } from 'vitest'
import { rm } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { SessionManager, createSessionManager } from './manager'
import { createSessionStore, type SessionStore } from './store'

describe('SessionManager', () => {
  const testDir = path.join(os.tmpdir(), 'freecode-test-session-manager')
  let sessionStore: SessionStore
  let manager: SessionManager

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    sessionStore = await createSessionStore(testDir)
    manager = createSessionManager(sessionStore)
  })

  describe('start', () => {
    it('creates a new session and returns session id', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude', 'Test Session')
      expect(sessionId).toBeDefined()
      expect(typeof sessionId).toBe('string')
    })

    it('stores session metadata via sessionStore', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude', 'Test Session')
      const meta = await sessionStore.getMeta(sessionId)
      expect(meta).not.toBeNull()
      expect(meta!.title).toBe('Test Session')
      expect(meta!.projectPath).toBe('/tmp/test-project')
      expect(meta!.provider).toBe('claude')
      expect(meta!.status).toBe('active')
    })
  })

  describe('resume', () => {
    it('loads session context with messages', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude', 'Test Session')
      await manager.appendMessage(sessionId, {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', content: 'Hello' }],
        timestamp: Date.now(),
      })

      const ctx = await manager.resume(sessionId)
      expect(ctx.id).toBe(sessionId)
      expect(ctx.title).toBe('Test Session')
      expect(ctx.messages).toHaveLength(1)
      expect(ctx.messages[0].parts[0].content).toBe('Hello')
    })

    it('injects resume marker when session is interrupted', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude', 'Test Session')
      const msgId = 'msg-interrupted'
      await manager.appendMessage(sessionId, {
        id: msgId,
        role: 'assistant',
        parts: [],
        timestamp: Date.now(),
      })
      await manager.markInterrupted(sessionId, msgId)

      const ctx = await manager.resume(sessionId)
      // Should have original message + injected resume message
      const lastMsg = ctx.messages[ctx.messages.length - 1]
      expect(lastMsg.role).toBe('user')
      expect(lastMsg.parts[0].content).toBe('Continue from where you left off.')
    })
  })

  describe('appendMessage', () => {
    it('appends message to session via sessionStore', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude')
      await manager.appendMessage(sessionId, {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', content: 'Test' }],
        timestamp: Date.now(),
      })

      const messages = await sessionStore.getMessages(sessionId)
      expect(messages).toHaveLength(1)
      expect(messages[0].parts[0].content).toBe('Test')
    })
  })

  describe('markInterrupted', () => {
    it('marks last message as interrupted', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude')
      const msgId = 'msg-1'
      await manager.appendMessage(sessionId, {
        id: msgId,
        role: 'assistant',
        parts: [],
        timestamp: Date.now(),
      })

      await manager.markInterrupted(sessionId, msgId)
      const messages = await sessionStore.getMessages(sessionId)
      expect(messages[0].interrupted).toBe(true)

      const meta = await sessionStore.getMeta(sessionId)
      expect(meta!.status).toBe('interrupted')
    })
  })

  describe('list', () => {
    it('returns all sessions from sessionStore', async () => {
      await manager.start('/tmp/p1', 'claude', 'Session 1')
      await manager.start('/tmp/p2', 'claude', 'Session 2')

      const sessions = await manager.list()
      expect(sessions).toHaveLength(2)
    })

    it('filters by projectPath', async () => {
      await manager.start('/tmp/p1', 'claude', 'Session 1')
      await manager.start('/tmp/p2', 'claude', 'Session 2')

      const sessions = await manager.list({ projectPath: '/tmp/p1' })
      expect(sessions).toHaveLength(1)
      expect(sessions[0].title).toBe('Session 1')
    })

    it('filters by status', async () => {
      const s1 = await manager.start('/tmp/p1', 'claude', 'Session 1')
      await manager.start('/tmp/p2', 'claude', 'Session 2')
      await manager.archive(s1)

      const active = await manager.list({ status: 'active' })
      expect(active).toHaveLength(1)
      expect(active[0].title).toBe('Session 2')
    })
  })

  describe('archive', () => {
    it('archives session via sessionStore', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude')
      await manager.archive(sessionId)

      const meta = await sessionStore.getMeta(sessionId)
      expect(meta!.status).toBe('archived')
    })
  })

  describe('delete', () => {
    it('deletes session via sessionStore', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude')
      await manager.delete(sessionId)

      // After delete, session should be marked as deleted in store
      const meta = await sessionStore.getMeta(sessionId)
      expect(meta!.status).toBe('deleted')
    })
  })

  describe('fork', () => {
    it('forks session via sessionStore', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude', 'Parent')
      await manager.appendMessage(sessionId, {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', content: 'Hello' }],
        timestamp: Date.now(),
      })

      const forkId = await manager.fork(sessionId)
      expect(forkId).not.toBe(sessionId)

      const forkMeta = await sessionStore.getMeta(forkId)
      expect(forkMeta!.parentId).toBe(sessionId)
      expect(forkMeta!.title).toBe('Parent (fork)')

      const forkMessages = await sessionStore.getMessages(forkId)
      expect(forkMessages).toHaveLength(1)
    })
  })

  describe('switch', () => {
    it('sets current session without loading', async () => {
      const sessionId = await manager.start('/tmp/test-project', 'claude')
      await manager.switch(sessionId)

      const current = await manager.getCurrent()
      expect(current).not.toBeNull()
      expect(current!.id).toBe(sessionId)
    })
  })
})