// =============================================================================
// Session Manager - High-level session operations
// PRIMARY: Start, resume, switch, fork, list sessions
// =============================================================================

import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { randomUUID } from "crypto"
import { createSessionStore, type SessionStore, type SessionMeta, type SerializedMessage } from "./store"
import { createThreadStoreService, type ThreadStoreService } from "../store/thread-store"
import { CONFIG_FILE } from "../providers/config.js"

const SESSION_DIR = ".freecode"

// =============================================================================
// Session Context
// =============================================================================

export interface SessionContext {
  id: string
  title: string
  projectPath: string
  provider: string
  status: "active" | "interrupted" | "archived" | "deleted"
  createdAt: number
  updatedAt: number
  lastTurnAt: number
  turnCount: number
  parentId?: string
  messages: SerializedMessage[]
}

// =============================================================================
// SessionManager
// =============================================================================

export class SessionManager {
  private sessionStore: SessionStore
  private threadStore: ThreadStoreService | undefined
  private currentSessionId: string | null = null

  constructor(sessionStore: SessionStore, threadStore?: ThreadStoreService) {
    this.sessionStore = sessionStore
    this.threadStore = threadStore
  }

  // Start a new session
  async start(projectPath: string, provider: string, title?: string): Promise<string> {
    const sessionTitle = title || `Session ${new Date().toLocaleDateString()}`

    // Use SessionStore to create the session
    const sessionId = await this.sessionStore.createSession({
      title: sessionTitle,
      projectPath,
      provider,
    })

    // Also create thread in ThreadStore for structured queries (if provided)
    if (this.threadStore) {
      await this.threadStore.create(sessionTitle, projectPath, provider)
    }

    this.currentSessionId = sessionId
    return sessionId
  }

  // Resume an existing session
  async resume(sessionId: string): Promise<SessionContext> {
    // List all sessions to find the one we want and get its projectPath
    const allMetas = await this.sessionStore.list()
    const meta = allMetas.find(m => m.id === sessionId)
    if (!meta) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    let messages = await this.sessionStore.getMessages(sessionId, meta.projectPath)

    // Detect interrupted state → inject resume marker
    if (meta.status === "interrupted") {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg?.interrupted) {
        const resumeMsg: SerializedMessage = {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", content: "Continue from where you left off." }],
          timestamp: Date.now(),
        }
        messages = [...messages, resumeMsg]
      }
    }

    this.currentSessionId = sessionId

    return {
      id: meta.id,
      title: meta.title,
      projectPath: meta.projectPath,
      provider: meta.provider,
      status: meta.status,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastTurnAt: meta.lastTurnAt,
      turnCount: meta.turnCount,
      parentId: meta.parentId,
      messages,
    }
  }

  // Switch to a different session (make it current)
  async switch(sessionId: string): Promise<void> {
    const allMetas = await this.sessionStore.list()
    const meta = allMetas.find(m => m.id === sessionId)
    if (!meta) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    this.currentSessionId = sessionId
  }

  // Fork session at current point
  async fork(sessionId: string): Promise<string> {
    const allMetas = await this.sessionStore.list()
    const meta = allMetas.find(m => m.id === sessionId)
    if (!meta) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const forkId = await this.sessionStore.fork(sessionId, meta.projectPath)
    this.currentSessionId = forkId
    return forkId
  }

  // List sessions
  async list(filter?: { projectPath?: string; status?: SessionMeta["status"] }): Promise<SessionContext[]> {
    const metas = await this.sessionStore.list(filter)

    return metas.map((meta) => ({
      id: meta.id,
      title: meta.title,
      projectPath: meta.projectPath,
      provider: meta.provider,
      status: meta.status,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastTurnAt: meta.lastTurnAt,
      turnCount: meta.turnCount,
      parentId: meta.parentId,
      messages: [], // Don't load messages for list
    }))
  }

  // Archive a session
  async archive(sessionId: string): Promise<void> {
    await this.sessionStore.updateStatus(sessionId, "archived")
  }

  // Delete a session
  async delete(sessionId: string): Promise<void> {
    await this.sessionStore.deleteSession(sessionId)
  }

  // Get current session
  async getCurrent(): Promise<SessionContext | null> {
    if (!this.currentSessionId) return null
    try {
      return await this.resume(this.currentSessionId)
    } catch {
      return null
    }
  }

  // Append message to session
  async appendMessage(sessionId: string, message: SerializedMessage): Promise<void> {
    await this.sessionStore.appendMessage(sessionId, message)
  }

  // Mark message as interrupted
  async markInterrupted(sessionId: string, messageId: string): Promise<void> {
    await this.sessionStore.markInterrupted(sessionId, messageId)
  }

  // Export session to remote sync endpoint
  async export(sessionId: string): Promise<{ url: string; expiresAt: number }> {
    const meta = await this.sessionStore.getMeta(sessionId)
    if (!meta) throw new Error("Session not found")
    const messages = await this.sessionStore.getMessages(sessionId)

    const payload = JSON.stringify({ meta, messages })
    const endpoint = this.getSyncEndpoint()

    const response = await fetch(`${endpoint}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) throw new Error("Export failed")
    return response.json() as Promise<{ url: string; expiresAt: number }>
  }

  // Import session from remote URL
  async import(url: string): Promise<string> {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error("Import failed")
    const { metadata: meta, messages } = await response.json() as { metadata: SessionMeta; messages: SerializedMessage[] }

    const newId = await this.sessionStore.createSession({
      title: meta.title + " (imported)",
      projectPath: meta.projectPath,
      provider: meta.provider,
    })

    for (const msg of messages) {
      await this.sessionStore.appendMessage(newId, msg)
    }

    await this.sessionStore.updateMeta(newId, { status: "active" })
    return newId
  }

  private getSyncEndpoint(): string {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, "utf-8")
        const config = JSON.parse(content) as { syncEndpoint?: string }
        if (config.syncEndpoint) return config.syncEndpoint
      }
    } catch {
      // ignore
    }
    return "https://sync.freecode.dev"
  }
}

// =============================================================================
// Factory
// =============================================================================

let globalSessionManager: SessionManager | null = null

export async function getSessionManager(): Promise<SessionManager> {
  if (!globalSessionManager) {
    const baseDir = path.join(os.homedir(), SESSION_DIR)
    const sessionStore = await createSessionStore(baseDir)
    const threadStore = await createThreadStoreService()
    globalSessionManager = new SessionManager(sessionStore, threadStore)
  }
  return globalSessionManager
}

export function createSessionManager(sessionStore: SessionStore, threadStore?: ThreadStoreService): SessionManager {
  return new SessionManager(sessionStore, threadStore)
}