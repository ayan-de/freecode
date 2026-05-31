// =============================================================================
// Session Manager - High-level session operations
// PRIMARY: Start, resume, switch, fork, list sessions
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { randomUUID } from "crypto"
import { getThreadStore, createThreadStoreService, type ThreadStoreService } from "../store/thread-store"
import type { StoredThread, ThreadFilter } from "../store/types"

const SESSION_DIR = ".freecode"
const SESSIONS_DIR = "sessions"

function getSessionsDir(): string {
  return path.join(os.homedir(), SESSION_DIR, SESSIONS_DIR)
}

function getSessionDir(sessionId: string): string {
  return path.join(getSessionsDir(), sessionId)
}

function getMessagesPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "messages.jsonl")
}

function getMetadataPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "metadata.json")
}

// =============================================================================
// Session Context
// =============================================================================

export interface SessionContext {
  id: string
  title: string
  projectPath: string
  provider: string
  status: "active" | "archived" | "deleted"
  createdAt: number
  updatedAt: number
  lastTurnAt: number
  turnCount: number
  parentId?: string
  messages: SerializedMessage[]
}

export interface SerializedMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
}

// =============================================================================
// SessionManager
// =============================================================================

export class SessionManager {
  private store: ThreadStoreService
  private currentSessionId: string | null = null

  constructor(store: ThreadStoreService) {
    this.store = store
  }

  // Start a new session
  async start(projectPath: string, provider: string, title?: string): Promise<string> {
    const sessionId = randomUUID()
    const sessionTitle = title || `Session ${new Date().toLocaleDateString()}`

    // Create session directory
    const sessionDir = getSessionDir(sessionId)
    fs.mkdirSync(sessionDir, { recursive: true })

    // Create thread in store
    const threadId = await this.store.create(sessionTitle, projectPath, provider)

    // Save session metadata
    const metadata = {
      id: sessionId,
      threadId,
      title: sessionTitle,
      projectPath,
      provider,
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTurnAt: Date.now(),
      turnCount: 0,
    }
    fs.writeFileSync(getMetadataPath(sessionId), JSON.stringify(metadata, null, 2))

    // Initialize empty messages file
    fs.writeFileSync(getMessagesPath(sessionId), "", "utf-8")

    this.currentSessionId = sessionId
    return sessionId
  }

  // Resume an existing session
  async resume(sessionId: string): Promise<SessionContext> {
    const metadata = this.loadMetadata(sessionId)
    if (!metadata) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const messages = this.loadMessages(sessionId)
    this.currentSessionId = sessionId

    return {
      id: sessionId,
      title: metadata.title,
      projectPath: metadata.projectPath,
      provider: metadata.provider,
      status: metadata.status,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      lastTurnAt: metadata.lastTurnAt,
      turnCount: metadata.turnCount,
      parentId: metadata.parentId,
      messages,
    }
  }

  // Switch to a different session (make it current)
  async switch(sessionId: string): Promise<void> {
    const metadata = this.loadMetadata(sessionId)
    if (!metadata) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    this.currentSessionId = sessionId
  }

  // Fork session at current point
  async fork(sessionId: string, _point?: string): Promise<string> {
    const parent = await this.resume(sessionId)
    const newSessionId = randomUUID()

    // Create new session directory
    const newDir = getSessionDir(newSessionId)
    fs.mkdirSync(newDir, { recursive: true })

    // Copy messages
    const messages = this.loadMessages(sessionId)
    fs.writeFileSync(getMessagesPath(newSessionId), messages.map((m) => JSON.stringify(m)).join("\n"), "utf-8")

    // Create new metadata with parent reference
    const metadata = {
      id: newSessionId,
      threadId: parent.id, // Reuse thread for now
      title: `${parent.title} (fork)`,
      projectPath: parent.projectPath,
      provider: parent.provider,
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTurnAt: Date.now(),
      turnCount: 0,
      parentId: sessionId,
    }
    fs.writeFileSync(getMetadataPath(newSessionId), JSON.stringify(metadata, null, 2))

    this.currentSessionId = newSessionId
    return newSessionId
  }

  // List sessions
  async list(filter?: { projectPath?: string; status?: "active" | "archived" | "deleted" }): Promise<SessionContext[]> {
    const sessions: SessionContext[] = []
    const sessionsDir = getSessionsDir()

    if (!fs.existsSync(sessionsDir)) {
      return sessions
    }

    const entries = fs.readdirSync(sessionsDir)
    for (const entry of entries) {
      const sessionPath = path.join(sessionsDir, entry)
      if (!fs.statSync(sessionPath).isDirectory()) continue

      const metadata = this.loadMetadata(entry)
      if (!metadata) continue

      if (filter?.projectPath && metadata.projectPath !== filter.projectPath) continue
      if (filter?.status && metadata.status !== filter.status) continue

      sessions.push({
        id: entry,
        title: metadata.title,
        projectPath: metadata.projectPath,
        provider: metadata.provider,
        status: metadata.status,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        lastTurnAt: metadata.lastTurnAt,
        turnCount: metadata.turnCount,
        parentId: metadata.parentId,
        messages: [], // Don't load messages for list
      })
    }

    // Sort by lastTurnAt descending
    sessions.sort((a, b) => b.lastTurnAt - a.lastTurnAt)
    return sessions
  }

  // Archive a session
  async archive(sessionId: string): Promise<void> {
    const metadata = this.loadMetadata(sessionId)
    if (!metadata) return

    metadata.status = "archived"
    metadata.updatedAt = Date.now()
    fs.writeFileSync(getMetadataPath(sessionId), JSON.stringify(metadata, null, 2))
  }

  // Delete a session
  async delete(sessionId: string): Promise<void> {
    const sessionDir = getSessionDir(sessionId)
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true })
    }
  }

  // Get current session
  getCurrent(): SessionContext | null {
    if (!this.currentSessionId) return null
    try {
      return this.resume(this.currentSessionId) as unknown as SessionContext
    } catch {
      return null
    }
  }

  // Add message to current session
  addMessage(sessionId: string, role: "user" | "assistant", content: string): void {
    const messagesPath = getMessagesPath(sessionId)
    const message: SerializedMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: Date.now(),
    }
    fs.appendFileSync(messagesPath, JSON.stringify(message) + "\n", "utf-8")
  }

  // =============================================================================
  // Private helpers
  // =============================================================================

  private loadMetadata(sessionId: string): any {
    const metadataPath = getMetadataPath(sessionId)
    if (!fs.existsSync(metadataPath)) return null
    return JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
  }

  private loadMessages(sessionId: string): SerializedMessage[] {
    const messagesPath = getMessagesPath(sessionId)
    if (!fs.existsSync(messagesPath)) return []

    const content = fs.readFileSync(messagesPath, "utf-8")
    if (!content.trim()) return []

    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
  }
}

// =============================================================================
// Factory
// =============================================================================

let globalSessionManager: SessionManager | null = null

export async function getSessionManager(): Promise<SessionManager> {
  if (!globalSessionManager) {
    const store = await createThreadStoreService()
    globalSessionManager = new SessionManager(store)
  }
  return globalSessionManager
}
