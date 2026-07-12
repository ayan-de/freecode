// =============================================================================
// SQLite Thread Store - Primary persistence for threads
// PRIMARY: Fast SQL storage with migrations
// FALLBACK: JsonStore if SQLite unavailable
// =============================================================================

import type {
  ThreadStore,
  StoredThread,
  StoredTurn,
  StoredToolCall,
  ThreadFilter,
  StoredTurnItemsView,
} from "./types.js";

// ============================================================================
// SQLite Store Implementation
// ============================================================================

export class SqliteThreadStoreImpl implements ThreadStore {
  private db: any; // sqlite3.Database - using any to avoid import issues
  private available: boolean = false;

  private constructor(db: any, available: boolean) {
    this.db = db;
    this.available = available;
  }

  static async create(): Promise<SqliteThreadStoreImpl> {
    try {
      // Try to dynamically import better-sqlite3
      let Database: any = null;

      // Dynamic require to avoid TypeScript warnings about missing modules
      const tryBetterSqlite3 = () => {
        try {
          return require("better-sqlite3");
        } catch {
          return null;
        }
      };
      const trySqlJs = () => {
        try {
          return require("sql.js");
        } catch {
          return null;
        }
      };

      const betterSqlite3 = tryBetterSqlite3();
      if (betterSqlite3) {
        Database = betterSqlite3.default;
      } else {
        const sqljs = trySqlJs();
        if (sqljs) {
          Database = sqljs.default;
        }
      }

      if (!Database) {
        return new SqliteThreadStoreImpl(null, false);
      }

      // Create database path
      const homeDir = process.env.HOME || "/tmp";
      const dbDir = `${homeDir}/.freecode/state`;
      const dbPath = `${dbDir}/freecode.db`;

      // Create directory if needed
      const fs = await import("fs");
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      const db = new Database(dbPath);

      // Run migrations
      const store = new SqliteThreadStoreImpl(db, true);
      await store.migrate();

      return store;
    } catch (error) {
      console.warn(`[SqliteStore] Failed to initialize: ${error}`);
      return new SqliteThreadStoreImpl(null, false);
    }
  }

  isAvailable(): boolean {
    return this.available && this.db != null;
  }

  // ===========================================================================
  // Thread CRUD
  // ===========================================================================

  async createThread(
    thread: Omit<StoredThread, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    const id = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO threads (id, title, createdAt, updatedAt, lastTurnAt, status, projectPath, provider, turnCount, iterationCount, goal, goalStatus, goalUpdatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      thread.title,
      now,
      now,
      now,
      thread.status,
      thread.projectPath,
      thread.provider,
      thread.turnCount,
      thread.iterationCount,
      thread.goal || null,
      thread.goalStatus || null,
      thread.goalUpdatedAt || null,
    );

    return id;
  }

  async getThread(threadId: string): Promise<StoredThread | null> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    const stmt = this.db.prepare("SELECT * FROM threads WHERE id = ?");
    const row = stmt.get(threadId);
    return row ? this.rowToThread(row) : null;
  }

  async updateThread(
    threadId: string,
    updates: Partial<StoredThread>,
  ): Promise<void> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }
    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
    if (updates.turnCount !== undefined) {
      fields.push("turnCount = ?");
      values.push(updates.turnCount);
    }
    if (updates.iterationCount !== undefined) {
      fields.push("iterationCount = ?");
      values.push(updates.iterationCount);
    }
    if (updates.goal !== undefined) {
      fields.push("goal = ?");
      values.push(updates.goal);
    }
    if (updates.goalStatus !== undefined) {
      fields.push("goalStatus = ?");
      values.push(updates.goalStatus);
    }
    if (updates.lastTurnAt !== undefined) {
      fields.push("lastTurnAt = ?");
      values.push(updates.lastTurnAt);
    }

    fields.push("updatedAt = ?");
    values.push(Date.now());
    values.push(threadId);

    const stmt = this.db.prepare(
      `UPDATE threads SET ${fields.join(", ")} WHERE id = ?`,
    );
    stmt.run(...values);
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.updateThread(threadId, { status: "archived" });
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    this.db
      .prepare(
        "DELETE FROM tool_calls WHERE turnId IN (SELECT id FROM turns WHERE threadId = ?)",
      )
      .run(threadId);
    this.db.prepare("DELETE FROM turns WHERE threadId = ?").run(threadId);
    this.db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  }

  async listThreads(filter?: ThreadFilter): Promise<StoredThread[]> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    let query = "SELECT * FROM threads WHERE 1=1";
    const params: any[] = [];

    if (filter?.status) {
      query += " AND status = ?";
      params.push(filter.status);
    }
    if (filter?.projectPath) {
      query += " AND projectPath = ?";
      params.push(filter.projectPath);
    }
    if (filter?.provider) {
      query += " AND provider = ?";
      params.push(filter.provider);
    }

    query += " ORDER BY lastTurnAt DESC";

    if (filter?.limit) {
      query += " LIMIT ?";
      params.push(filter.limit);
    }
    if (filter?.offset) {
      query += " OFFSET ?";
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map((r: any) => this.rowToThread(r));
  }

  async searchThreads(query: string): Promise<StoredThread[]> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    const q = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM threads
      WHERE title LIKE ? OR projectPath LIKE ? OR goal LIKE ?
      ORDER BY lastTurnAt DESC
    `);
    const rows = stmt.all(q, q, q);
    return rows.map((r: any) => this.rowToThread(r));
  }

  // ===========================================================================
  // Turn Operations
  // ===========================================================================

  async createTurn(
    turn: Omit<StoredTurn, "id" | "createdAt">,
  ): Promise<string> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO turns (id, threadId, turnNumber, prompt, response, createdAt, durationMs, toolCallCount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      turn.threadId,
      turn.turnNumber,
      turn.prompt,
      turn.response || null,
      now,
      turn.durationMs || null,
      turn.toolCallCount || 0,
    );

    // Update thread's lastTurnAt
    this.db
      .prepare("UPDATE threads SET lastTurnAt = ?, turnCount = ? WHERE id = ?")
      .run(now, turn.turnNumber, turn.threadId);

    return id;
  }

  async getTurn(turnId: string): Promise<StoredTurn | null> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    const stmt = this.db.prepare("SELECT * FROM turns WHERE id = ?");
    const row = stmt.get(turnId);
    if (!row) return null;

    return this.rowToTurn(row);
  }

  async getTurnsForThread(threadId: string): Promise<StoredTurn[]> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    const stmt = this.db.prepare(
      "SELECT * FROM turns WHERE threadId = ? ORDER BY turnNumber ASC",
    );
    const rows = stmt.all(threadId);
    return rows.map((r: any) => this.rowToTurn(r));
  }

  async getTurnItemsView(
    threadId: string,
    limit?: number,
  ): Promise<StoredTurnItemsView[]> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    let query = `
      SELECT t.*, tc.id as tcId, tc.toolName, tc.result, tc.error, tc.durationMs, tc.sequence
      FROM turns t
      LEFT JOIN tool_calls tc ON tc.turnId = t.id
      WHERE t.threadId = ?
      ORDER BY t.turnNumber ASC, tc.sequence ASC
    `;

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(threadId);

    // Group tool calls by turn
    const turnMap = new Map<string, StoredTurnItemsView>();

    for (const row of rows) {
      if (!turnMap.has(row.id)) {
        turnMap.set(row.id, {
          threadId: row.threadId,
          turnNumber: row.turnNumber,
          prompt: row.prompt,
          response: row.response,
          createdAt: row.createdAt,
          toolCalls: [],
        });
      }

      if (row.tcId) {
        turnMap.get(row.id)!.toolCalls.push({
          id: row.tcId,
          toolName: row.toolName,
          result: row.result,
          error: row.error,
          durationMs: row.durationMs,
        });
      }
    }

    return Array.from(turnMap.values());
  }

  // ===========================================================================
  // Tool Call Operations
  // ===========================================================================

  async addToolCall(
    turnId: string,
    toolCall: Omit<StoredToolCall, "id" | "sequence">,
  ): Promise<string> {
    if (!this.isAvailable()) throw new Error("SQLite not available");

    // Get next sequence number
    const seqStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM tool_calls WHERE turnId = ?",
    );
    const { count } = seqStmt.get(turnId);

    const id = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const stmt = this.db.prepare(`
      INSERT INTO tool_calls (id, turnId, toolName, args, result, error, durationMs, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      turnId,
      toolCall.toolName,
      JSON.stringify(toolCall.args),
      toolCall.result || null,
      toolCall.error || null,
      toolCall.durationMs || null,
      count + 1,
    );

    // Update turn's tool call count
    this.db
      .prepare("UPDATE turns SET toolCallCount = ? WHERE id = ?")
      .run(count + 1, turnId);

    return id;
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private rowToThread(row: any): StoredThread {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastTurnAt: row.lastTurnAt,
      status: row.status,
      projectPath: row.projectPath,
      provider: row.provider,
      turnCount: row.turnCount,
      iterationCount: row.iterationCount,
      goal: row.goal,
      goalStatus: row.goalStatus,
      goalUpdatedAt: row.goalUpdatedAt,
    };
  }

  private rowToTurn(row: any): StoredTurn {
    return {
      id: row.id,
      threadId: row.threadId,
      turnNumber: row.turnNumber,
      prompt: row.prompt,
      response: row.response,
      createdAt: row.createdAt,
      durationMs: row.durationMs,
      toolCallCount: row.toolCallCount,
    };
  }

  // ===========================================================================
  // Schema Migrations
  // ===========================================================================

  private static readonly MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastTurnAt INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      projectPath TEXT,
      provider TEXT,
      turnCount INTEGER DEFAULT 0,
      iterationCount INTEGER DEFAULT 0,
      goal TEXT,
      goalStatus TEXT,
      goalUpdatedAt INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      threadId TEXT NOT NULL,
      turnNumber INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT,
      createdAt INTEGER NOT NULL,
      durationMs INTEGER,
      toolCallCount INTEGER DEFAULT 0,
      FOREIGN KEY (threadId) REFERENCES threads(id)
    )`,
    `CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      turnId TEXT NOT NULL,
      toolName TEXT NOT NULL,
      args TEXT,
      result TEXT,
      error TEXT,
      durationMs INTEGER,
      sequence INTEGER NOT NULL,
      FOREIGN KEY (turnId) REFERENCES turns(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status)`,
    `CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(projectPath)`,
    `CREATE INDEX IF NOT EXISTS idx_turns_thread ON turns(threadId)`,
    `CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turnId)`,
  ];

  /**
   * Run migrations to set up the database schema
   */
  async migrate(): Promise<void> {
    if (!this.isAvailable()) return;

    for (const sql of SqliteThreadStoreImpl.MIGRATIONS) {
      this.db.exec(sql);
    }
  }
}
