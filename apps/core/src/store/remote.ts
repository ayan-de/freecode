// =============================================================================
// Remote Session Sync - Upload/download sessions to remote storage
// USP: Continue sessions on different computers
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { randomUUID } from "crypto"
import { SessionManager, getSessionManager } from "../session/manager"
import { MemoryStore } from "../memory/mem-store"
import type { MemoryEntry } from "../memory/mem-types"

const STORE_DIR = ".freecode"
const REMOTE_DIR = "remote"

function getRemoteDir(): string {
  return path.join(os.homedir(), STORE_DIR, REMOTE_DIR)
}

// =============================================================================
// Exported Session Format
// =============================================================================

export interface ExportedSession {
  version: 1
  metadata: {
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
  }
  messages: Array<{
    id: string
    role: "user" | "assistant"
    content: string
    timestamp: number
  }>
  memories: MemoryEntry[]
  exportedAt: number
  expiresAt?: number
}

export interface RemoteSessionConfig {
  endpoint: string
  apiKey?: string
}

// =============================================================================
// RemoteSessionSync
// =============================================================================

export class RemoteSessionSync {
  private sessionManager: SessionManager

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager
  }

  // Export session to JSON file (local export)
  async exportSession(sessionId: string): Promise<ExportedSession> {
    const context = await this.sessionManager.resume(sessionId)

    // Load memories for this project
    const memoryStore = new MemoryStore(context.projectPath)
    const memories = memoryStore.list()

    return {
      version: 1,
      metadata: {
        id: context.id,
        title: context.title,
        projectPath: context.projectPath,
        provider: context.provider,
        status: context.status,
        createdAt: context.createdAt,
        updatedAt: context.updatedAt,
        lastTurnAt: context.lastTurnAt,
        turnCount: context.turnCount,
        parentId: context.parentId,
      },
      messages: context.messages,
      memories,
      exportedAt: Date.now(),
    }
  }

  // Save exported session to local file
  saveExportToFile(sessionId: string, filePath?: string): string {
    const exportData = this.exportSession(sessionId)
    const targetPath = filePath || path.join(getRemoteDir(), `${sessionId}.json`)

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, JSON.stringify(exportData, null, 2))

    return targetPath
  }

  // Import session from JSON file
  async importFromFile(filePath: string): Promise<string> {
    const content = fs.readFileSync(filePath, "utf-8")
    const exportData = JSON.parse(content) as ExportedSession

    return this.importSession(exportData)
  }

  // Import session from ExportedSession object
  async importSession(data: ExportedSession): Promise<string> {
    // Create new session
    const newSessionId = await this.sessionManager.start(
      data.metadata.projectPath,
      data.metadata.provider,
      data.metadata.title
    )

    // Override metadata with imported values
    const sessionDir = path.join(getRemoteDir(), "..", "sessions", newSessionId)
    const metadataPath = path.join(sessionDir, "metadata.json")

    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
      metadata.parentId = data.metadata.id // Track that this was forked from another session
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
    }

    // Save messages
    const messagesPath = path.join(sessionDir, "messages.jsonl")
    if (data.messages.length > 0) {
      const messagesContent = data.messages.map((m) => JSON.stringify(m)).join("\n")
      fs.writeFileSync(messagesPath, messagesContent, "utf-8")
    }

    // Save memories
    if (data.memories.length > 0) {
      const memoryStore = new MemoryStore(data.metadata.projectPath)
      for (const memory of data.memories) {
        memoryStore.save(memory)
      }
    }

    return newSessionId
  }

  // Upload session to remote endpoint
  async upload(sessionId: string, config: RemoteSessionConfig): Promise<string> {
    const exportData = this.exportSession(sessionId)

    // Save to local temp file first
    const tempPath = path.join(os.tmpdir(), `session-${sessionId}.json`)
    fs.writeFileSync(tempPath, JSON.stringify(exportData, null, 2))

    // Upload to endpoint
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: fs.createReadStream(tempPath),
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
    }

    // Clean up temp file
    fs.unlinkSync(tempPath)

    // Return the URL where the session can be downloaded
    const result = await response.json() as { url?: string }
    return result.url || config.endpoint
  }

  // Download session from remote URL
  async download(url: string, config: RemoteSessionConfig): Promise<string> {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    const exportData = await response.json() as ExportedSession
    return this.importSession(exportData)
  }

  // Check if remote session is accessible
  async ping(url: string, config?: RemoteSessionConfig): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        ...(config?.apiKey && { headers: { Authorization: `Bearer ${config.apiKey}` } }),
      })
      return response.ok
    } catch {
      return false
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

let globalRemoteSync: RemoteSessionSync | null = null

export async function getRemoteSync(): Promise<RemoteSessionSync> {
  if (!globalRemoteSync) {
    const sessionManager = await getSessionManager()
    globalRemoteSync = new RemoteSessionSync(sessionManager)
  }
  return globalRemoteSync
}
