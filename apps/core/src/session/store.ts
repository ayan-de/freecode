// =============================================================================
// SessionStore - JSONL-based file operations for session persistence
// PRIMARY: Provides file-based session storage at ~/.freecode/sessions/
// STORAGE: Sessions stored at {baseDir}/sessions/{sessionId}/ with meta.json + messages.jsonl
// =============================================================================

import { mkdir, readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ============================================================================
// Types
// ============================================================================

export interface SessionMeta {
  id: string
  title: string
  projectPath: string
  provider: string
  model?: string
  status: 'active' | 'interrupted' | 'archived' | 'deleted'
  createdAt: number
  updatedAt: number
  lastTurnAt: number
  turnCount: number
  parentId?: string
  aggregatedTokenCount?: number
}

export interface SerializedMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Array<{
    type: 'text' | 'code' | 'tool'
    content?: string
    language?: string
    tool?: { name: string; args: Record<string, unknown> }
    result?: string
  }>
  timestamp: number
  interrupted?: boolean
}

export interface CreateSessionOptions {
  title: string
  projectPath: string
  provider: string
  model?: string
}

export interface SessionStore {
  createSession(opts: CreateSessionOptions): Promise<string>
  getMeta(sessionId: string): Promise<SessionMeta | null>
  updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void>
  updateStatus(sessionId: string, status: SessionMeta['status']): Promise<void>
  deleteSession(sessionId: string): Promise<void>

  appendMessage(sessionId: string, message: SerializedMessage): Promise<void>
  getMessages(sessionId: string): Promise<SerializedMessage[]>
  markInterrupted(sessionId: string, messageId: string): Promise<void>

  list(filter?: { status?: SessionMeta['status']; projectPath?: string }): Promise<SessionMeta[]>
  fork(sessionId: string): Promise<string>

  getInterruptedSession(): Promise<{ sessionId: string; messageId: string } | null>
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_DIR = 'sessions'
const META_FILE = 'meta.json'
const MESSAGES_FILE = 'messages.jsonl'

// ============================================================================
// Helpers
// ============================================================================

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // already exists
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, 'utf-8')
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

// ============================================================================
// Factory
// ============================================================================

export async function createSessionStore(baseDir: string): Promise<SessionStore> {
  await ensureDir(join(baseDir, SESSION_DIR))
  return new SessionStoreImpl(baseDir)
}

// ============================================================================
// Implementation
// ============================================================================

class SessionStoreImpl implements SessionStore {
  constructor(private baseDir: string) {}

  private sessionDir(sessionId: string): string {
    return join(this.baseDir, SESSION_DIR, sessionId)
  }

  private metaPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), META_FILE)
  }

  private messagesPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), MESSAGES_FILE)
  }

  async createSession(opts: CreateSessionOptions, forcedId?: string): Promise<string> {
    const id = forcedId || randomUUID()
    const now = Date.now()
    const meta: SessionMeta = {
      id,
      title: opts.title,
      projectPath: opts.projectPath,
      provider: opts.provider,
      model: opts.model,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastTurnAt: now,
      turnCount: 0,
    }
    await ensureDir(this.sessionDir(id))
    await writeJson(this.metaPath(id), meta)
    await writeFile(this.messagesPath(id), '', 'utf-8')
    return id
  }

  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    return readJson<SessionMeta>(this.metaPath(sessionId))
  }

  async updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void> {
    const meta = await this.getMeta(sessionId)
    if (!meta) return
    const updated = { ...meta, ...updates, updatedAt: Date.now() }
    await writeJson(this.metaPath(sessionId), updated)
  }

  async updateStatus(sessionId: string, status: SessionMeta['status']): Promise<void> {
    await this.updateMeta(sessionId, { status })
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.updateStatus(sessionId, 'deleted')
  }

  async appendMessage(sessionId: string, message: SerializedMessage): Promise<void> {
    const line = JSON.stringify(message) + '\n'
    await writeFile(this.messagesPath(sessionId), line, { flag: 'a' })
  }

  async getMessages(sessionId: string): Promise<SerializedMessage[]> {
    const content = await readFile(this.messagesPath(sessionId), 'utf-8').catch(() => '')
    if (!content.trim()) return []
    return content.trim().split('\n').map(line => JSON.parse(line) as SerializedMessage)
  }

  async markInterrupted(sessionId: string, messageId: string): Promise<void> {
    const messages = await this.getMessages(sessionId)
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx !== -1) {
      messages[idx] = { ...messages[idx], interrupted: true }
    }
    const content = messages.map(m => JSON.stringify(m)).join('\n') + '\n'
    await writeFile(this.messagesPath(sessionId), content, 'utf-8')
    await this.updateStatus(sessionId, 'interrupted')
  }

  async list(filter?: { status?: SessionMeta['status']; projectPath?: string }): Promise<SessionMeta[]> {
    const sessionsDir = join(this.baseDir, SESSION_DIR)
    let entries: string[]
    try {
      entries = await readdir(sessionsDir)
    } catch {
      return []
    }
    const metas: SessionMeta[] = []
    for (const id of entries) {
      const meta = await this.getMeta(id)
      if (!meta) continue
      if (filter?.status && meta.status !== filter.status) continue
      if (filter?.projectPath && meta.projectPath !== filter.projectPath) continue
      metas.push(meta)
    }
    return metas.sort((a, b) => b.lastTurnAt - a.lastTurnAt)
  }

  async fork(sessionId: string): Promise<string> {
    const meta = await this.getMeta(sessionId)
    if (!meta) throw new Error('Session not found')
    const newId = await this.createSession({
      title: meta.title + ' (fork)',
      projectPath: meta.projectPath,
      provider: meta.provider,
      model: meta.model,
    })
    await this.updateMeta(newId, { parentId: sessionId, turnCount: meta.turnCount })
    const messages = await this.getMessages(sessionId)
    for (const msg of messages) {
      await this.appendMessage(newId, msg)
    }
    return newId
  }

  async getInterruptedSession(): Promise<{ sessionId: string; messageId: string } | null> {
    const all = await this.list({ status: 'interrupted' })
    if (all.length === 0) return null
    const session = all[0]
    const messages = await this.getMessages(session.id)
    const last = messages[messages.length - 1]
    return last ? { sessionId: session.id, messageId: last.id } : null
  }
}