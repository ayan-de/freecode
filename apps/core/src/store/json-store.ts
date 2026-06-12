// =============================================================================
// JSON Thread Store - File-based fallback for SQLite
// PRIMARY: Persist thread data to JSON files when SQLite is unavailable
// STORAGE: ~/.freecode/state/threads/{threadId}.json
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  ThreadStore,
  StoredThread,
  StoredTurn,
  StoredToolCall,
  ThreadFilter,
  StoredTurnItemsView,
  JsonThreadStore,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const STORE_DIR = ".freecode";
const STATE_DIR = "state";
const THREADS_DIR = "threads";
const METADATA_FILE = "store.json";

// ============================================================================
// Helpers
// ============================================================================

function getStoreDir(): string {
  return path.join(os.homedir(), STORE_DIR, STATE_DIR, THREADS_DIR);
}

function getMetadataPath(): string {
  return path.join(os.homedir(), STORE_DIR, STATE_DIR, METADATA_FILE);
}

function ensureDir(): void {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readMetadata(): JsonThreadStore {
  const metaPath = getMetadataPath();
  try {
    if (fs.existsSync(metaPath)) {
      const content = fs.readFileSync(metaPath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(`[JsonThreadStore] Failed to read metadata: ${error}`);
  }
  return {
    threads: {},
    turns: {},
    metadata: { version: 1, lastUpdated: Date.now() },
  };
}

function writeMetadata(store: JsonThreadStore): void {
  ensureDir();
  const metaPath = getMetadataPath();
  fs.writeFileSync(metaPath, JSON.stringify(store, null, 2));
}

function getThreadPath(threadId: string): string {
  return path.join(getStoreDir(), `${threadId}.json`);
}

// ============================================================================
// JsonThreadStore Implementation
// ============================================================================

export class JsonThreadStoreImpl implements ThreadStore {
  private store: JsonThreadStore;

  constructor() {
    this.store = readMetadata();
  }

  // ===========================================================================
  // Thread CRUD
  // ===========================================================================

  async createThread(
    thread: Omit<StoredThread, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const id = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const fullThread: StoredThread = {
      ...thread,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.store.threads[id] = fullThread;
    this.store.turns[id] = [];
    this.store.metadata.lastUpdated = now;
    writeMetadata(this.store);

    return id;
  }

  async getThread(threadId: string): Promise<StoredThread | null> {
    return this.store.threads[threadId] || null;
  }

  async updateThread(
    threadId: string,
    updates: Partial<StoredThread>,
  ): Promise<void> {
    const thread = this.store.threads[threadId];
    if (!thread) return;

    this.store.threads[threadId] = {
      ...thread,
      ...updates,
      id: threadId, // Preserve ID
      updatedAt: Date.now(),
    };
    this.store.metadata.lastUpdated = Date.now();
    writeMetadata(this.store);
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.updateThread(threadId, { status: "archived" });
  }

  async deleteThread(threadId: string): Promise<void> {
    delete this.store.threads[threadId];
    delete this.store.turns[threadId];
    this.store.metadata.lastUpdated = Date.now();
    writeMetadata(this.store);

    // Also delete the individual thread file if it exists
    const filePath = getThreadPath(threadId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async listThreads(filter?: ThreadFilter): Promise<StoredThread[]> {
    let threads = Object.values(this.store.threads);

    if (filter?.status) {
      threads = threads.filter((t) => t.status === filter.status);
    }
    if (filter?.projectPath) {
      threads = threads.filter((t) => t.projectPath === filter.projectPath);
    }
    if (filter?.provider) {
      threads = threads.filter((t) => t.provider === filter.provider);
    }

    // Sort by lastTurnAt descending
    threads.sort((a, b) => b.lastTurnAt - a.lastTurnAt);

    // Apply pagination
    if (filter?.offset) {
      threads = threads.slice(filter.offset);
    }
    if (filter?.limit) {
      threads = threads.slice(0, filter.limit);
    }

    return threads;
  }

  async searchThreads(query: string): Promise<StoredThread[]> {
    const q = query.toLowerCase();
    return Object.values(this.store.threads).filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.projectPath.toLowerCase().includes(q) ||
        (t.goal && t.goal.toLowerCase().includes(q)),
    );
  }

  // ===========================================================================
  // Turn Operations
  // ===========================================================================

  async createTurn(
    turn: Omit<StoredTurn, "id" | "createdAt">,
  ): Promise<string> {
    const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const fullTurn: StoredTurn = {
      ...turn,
      id,
      createdAt: now,
    };

    const turns = this.store.turns[turn.threadId] || [];
    turns.push(fullTurn);
    this.store.turns[turn.threadId] = turns;

    // Update thread's lastTurnAt and turnCount
    const thread = this.store.threads[turn.threadId];
    if (thread) {
      thread.lastTurnAt = now;
      thread.turnCount = turns.length;
      thread.updatedAt = now;
    }

    this.store.metadata.lastUpdated = now;
    writeMetadata(this.store);

    return id;
  }

  async getTurn(turnId: string): Promise<StoredTurn | null> {
    for (const turns of Object.values(this.store.turns)) {
      const turn = turns.find((t) => t.id === turnId);
      if (turn) return turn;
    }
    return null;
  }

  async getTurnsForThread(threadId: string): Promise<StoredTurn[]> {
    return this.store.turns[threadId] || [];
  }

  async getTurnItemsView(
    threadId: string,
    limit?: number,
  ): Promise<StoredTurnItemsView[]> {
    const turns = this.store.turns[threadId] || [];
    const sorted = [...turns].sort((a, b) => a.turnNumber - b.turnNumber);

    return sorted.slice(0, limit).map((turn) => ({
      threadId: turn.threadId,
      turnNumber: turn.turnNumber,
      prompt: turn.prompt,
      response: turn.response,
      createdAt: turn.createdAt,
      toolCalls: (turn.toolCalls || []).map((tc) => ({
        id: tc.id,
        toolName: tc.toolName,
        result: tc.result,
        error: tc.error,
        durationMs: tc.durationMs,
      })),
    }));
  }

  // ===========================================================================
  // Tool Call Operations
  // ===========================================================================

  async addToolCall(
    turnId: string,
    toolCall: Omit<StoredToolCall, "id" | "sequence">,
  ): Promise<string> {
    const id = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    for (const turns of Object.values(this.store.turns)) {
      const turn = turns.find((t) => t.id === turnId);
      if (turn) {
        const seq = (turn.toolCalls?.length || 0) + 1;
        turn.toolCalls = turn.toolCalls || [];
        turn.toolCalls.push({ ...toolCall, id, sequence: seq });
        writeMetadata(this.store);
        return id;
      }
    }
    throw new Error(`Turn ${turnId} not found`);
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  async close(): Promise<void> {
    // No-op for JSON store - data is already persisted
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createJsonThreadStore(): JsonThreadStoreImpl {
  return new JsonThreadStoreImpl();
}
