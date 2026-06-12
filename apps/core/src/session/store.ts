// =============================================================================
// SessionStore - JSONL-based file operations for session persistence
// PRIMARY: Provides file-based session storage at ~/.freecode/sessions/
// STORAGE: Sessions stored at {baseDir}/sessions/{projectDir}/{sessionId}/ with meta.json + messages.jsonl
// PROJECT DIR: Project path is formatted using path-formatter (e.g., /home/ayande/Project → home__ayande__Project)
// =============================================================================

import { mkdir, readFile, writeFile, readdir } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { formatSessionDirName } from "../store/path-formatter.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionMeta {
  id: string;
  title: string;
  projectPath: string;
  provider: string;
  model?: string;
  status: "active" | "interrupted" | "archived" | "deleted";
  createdAt: number;
  updatedAt: number;
  lastTurnAt: number;
  turnCount: number;
  parentId?: string;
  aggregatedTokenCount?: number;
}

export interface SerializedMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{
    type: "text" | "code" | "tool";
    content?: string;
    language?: string;
    tool?: { name: string; args: Record<string, unknown> };
    result?: string;
  }>;
  timestamp: number;
  interrupted?: boolean;
}

export interface CreateSessionOptions {
  title: string;
  projectPath: string;
  provider: string;
  model?: string;
}

// Context cache for file requests across turns
export interface ContextCache {
  requestedFiles: string[];
  fileContents: Record<string, string>; // path -> content
  lastUpdated: number;
  turnCount: number;
}

export interface SessionStore {
  createSession(opts: CreateSessionOptions, forcedId?: string): Promise<string>;
  getMeta(sessionId: string, projectPath?: string): Promise<SessionMeta | null>;
  getMetaBySessionId(
    formattedProjDir: string,
    sessionId: string,
  ): Promise<SessionMeta | null>;
  updateMeta(
    sessionId: string,
    updates: Partial<SessionMeta>,
    projectPath?: string,
  ): Promise<void>;
  updateStatus(
    sessionId: string,
    status: SessionMeta["status"],
    projectPath?: string,
  ): Promise<void>;
  deleteSession(sessionId: string, projectPath?: string): Promise<void>;

  appendMessage(
    sessionId: string,
    message: SerializedMessage,
    projectPath?: string,
  ): Promise<void>;
  getMessages(
    sessionId: string,
    projectPath?: string,
  ): Promise<SerializedMessage[]>;
  markInterrupted(
    sessionId: string,
    messageId: string,
    projectPath?: string,
  ): Promise<void>;

  getContextCache(
    sessionId: string,
    projectPath?: string,
  ): Promise<ContextCache | null>;
  setContextCache(
    sessionId: string,
    cache: ContextCache,
    projectPath?: string,
  ): Promise<void>;
  clearContextCache(sessionId: string, projectPath?: string): Promise<void>;

  list(filter?: {
    status?: SessionMeta["status"];
    projectPath?: string;
  }): Promise<SessionMeta[]>;
  fork(sessionId: string, newProjectPath?: string): Promise<string>;

  getInterruptedSession(): Promise<{
    sessionId: string;
    messageId: string;
  } | null>;
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_DIR = "sessions";
const META_FILE = "meta.json";
const MESSAGES_FILE = "messages.jsonl";
const CONTEXT_CACHE_FILE = "context-cache.json";

// ============================================================================
// Helpers
// ============================================================================

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // already exists
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

// ============================================================================
// Factory
// ============================================================================

export async function createSessionStore(
  baseDir: string,
): Promise<SessionStore> {
  await ensureDir(join(baseDir, SESSION_DIR));
  return new SessionStoreImpl(baseDir);
}

// ============================================================================
// Implementation
// ============================================================================

class SessionStoreImpl implements SessionStore {
  constructor(
    private baseDir: string,
    private projectDir?: string,
  ) {}

  private getProjectDir(projectPath: string): string {
    return formatSessionDirName(projectPath);
  }

  private sessionDir(sessionId: string, projectPath?: string): string {
    let projDir = projectPath
      ? this.getProjectDir(projectPath)
      : this.projectDir;
    if (!projDir) {
      const sessionsDir = join(this.baseDir, SESSION_DIR);
      if (existsSync(sessionsDir)) {
        try {
          const entries = readdirSync(sessionsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const candidate = join(sessionsDir, entry.name, sessionId);
              if (existsSync(candidate)) {
                projDir = entry.name;
                break;
              }
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    }
    if (!projDir) throw new Error("Project path required");
    return join(this.baseDir, SESSION_DIR, projDir, sessionId);
  }

  private sessionDirFromFormatted(
    sessionId: string,
    formattedProjDir: string,
  ): string {
    return join(this.baseDir, SESSION_DIR, formattedProjDir, sessionId);
  }

  private metaPath(sessionId: string, projectPath?: string): string {
    return join(this.sessionDir(sessionId, projectPath), META_FILE);
  }

  private metaPathFromFormatted(
    sessionId: string,
    formattedProjDir: string,
  ): string {
    return join(
      this.sessionDirFromFormatted(sessionId, formattedProjDir),
      META_FILE,
    );
  }

  private messagesPath(sessionId: string, projectPath?: string): string {
    return join(this.sessionDir(sessionId, projectPath), MESSAGES_FILE);
  }

  private messagesPathFromFormatted(
    sessionId: string,
    formattedProjDir: string,
  ): string {
    return join(
      this.sessionDirFromFormatted(sessionId, formattedProjDir),
      MESSAGES_FILE,
    );
  }

  private projectSessionsDir(projectPath: string): string {
    return join(this.baseDir, SESSION_DIR, this.getProjectDir(projectPath));
  }

  async createSession(
    opts: CreateSessionOptions,
    forcedId?: string,
  ): Promise<string> {
    const id = forcedId || randomUUID();
    const now = Date.now();
    const meta: SessionMeta = {
      id,
      title: opts.title,
      projectPath: opts.projectPath,
      provider: opts.provider,
      model: opts.model,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastTurnAt: now,
      turnCount: 0,
    };
    const projDir = this.getProjectDir(opts.projectPath);
    await ensureDir(join(this.baseDir, SESSION_DIR, projDir));
    await ensureDir(this.sessionDir(id, opts.projectPath));
    await writeJson(this.metaPath(id, opts.projectPath), meta);
    await writeFile(this.messagesPath(id, opts.projectPath), "", "utf-8");
    return id;
  }

  async getMeta(
    sessionId: string,
    projectPath?: string,
  ): Promise<SessionMeta | null> {
    return readJson<SessionMeta>(this.metaPath(sessionId, projectPath));
  }

  async getMetaBySessionId(
    formattedProjDir: string,
    sessionId: string,
  ): Promise<SessionMeta | null> {
    return readJson<SessionMeta>(
      this.metaPathFromFormatted(sessionId, formattedProjDir),
    );
  }

  async updateMeta(
    sessionId: string,
    updates: Partial<SessionMeta>,
    projectPath?: string,
  ): Promise<void> {
    const meta = await this.getMeta(sessionId, projectPath);
    if (!meta) return;
    const updated = { ...meta, ...updates, updatedAt: Date.now() };
    await writeJson(this.metaPath(sessionId, projectPath), updated);
  }

  async updateStatus(
    sessionId: string,
    status: SessionMeta["status"],
    projectPath?: string,
  ): Promise<void> {
    await this.updateMeta(sessionId, { status }, projectPath);
  }

  async deleteSession(sessionId: string, projectPath?: string): Promise<void> {
    await this.updateStatus(sessionId, "deleted", projectPath);
  }

  async appendMessage(
    sessionId: string,
    message: SerializedMessage,
    projectPath?: string,
  ): Promise<void> {
    const line = JSON.stringify(message) + "\n";
    await writeFile(this.messagesPath(sessionId, projectPath), line, {
      flag: "a",
    });
  }

  async getMessages(
    sessionId: string,
    projectPath?: string,
  ): Promise<SerializedMessage[]> {
    const content = await readFile(
      this.messagesPath(sessionId, projectPath),
      "utf-8",
    ).catch(() => "");
    if (!content.trim()) return [];
    return content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SerializedMessage);
  }

  async markInterrupted(
    sessionId: string,
    messageId: string,
    projectPath?: string,
  ): Promise<void> {
    const messages = await this.getMessages(sessionId, projectPath);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      messages[idx] = { ...messages[idx], interrupted: true };
    }
    const content = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
    await writeFile(
      this.messagesPath(sessionId, projectPath),
      content,
      "utf-8",
    );
    await this.updateStatus(sessionId, "interrupted", projectPath);
  }

  async list(filter?: {
    status?: SessionMeta["status"];
    projectPath?: string;
  }): Promise<SessionMeta[]> {
    const sessionsDir = join(this.baseDir, SESSION_DIR);
    let projectDirs: string[];
    try {
      projectDirs = await readdir(sessionsDir);
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const projDir of projectDirs) {
      const projPath = join(sessionsDir, projDir);
      let sessionIds: string[];
      try {
        sessionIds = await readdir(projPath);
      } catch {
        continue;
      }
      for (const id of sessionIds) {
        const meta = await this.getMetaBySessionId(projDir, id);
        if (!meta) continue;
        if (filter?.status && meta.status !== filter.status) continue;
        if (filter?.projectPath && meta.projectPath !== filter.projectPath)
          continue;
        metas.push(meta);
      }
    }
    return metas.sort((a, b) => b.lastTurnAt - a.lastTurnAt);
  }

  async fork(sessionId: string, newProjectPath?: string): Promise<string> {
    const meta = await this.getMeta(sessionId);
    if (!meta) throw new Error("Session not found");
    const targetProjectPath = newProjectPath || meta.projectPath;
    const newId = await this.createSession({
      title: meta.title + " (fork)",
      projectPath: targetProjectPath,
      provider: meta.provider,
      model: meta.model,
    });
    await this.updateMeta(
      newId,
      { parentId: sessionId, turnCount: meta.turnCount },
      targetProjectPath,
    );
    const messages = await this.getMessages(sessionId, meta.projectPath);
    for (const msg of messages) {
      await this.appendMessage(newId, msg, targetProjectPath);
    }
    return newId;
  }

  async getContextCache(
    sessionId: string,
    projectPath?: string,
  ): Promise<ContextCache | null> {
    const content = await readFile(
      join(this.sessionDir(sessionId, projectPath), CONTEXT_CACHE_FILE),
      "utf-8",
    ).catch(() => "");
    if (!content.trim()) return null;
    try {
      return JSON.parse(content) as ContextCache;
    } catch {
      return null;
    }
  }

  async setContextCache(
    sessionId: string,
    cache: ContextCache,
    projectPath?: string,
  ): Promise<void> {
    await ensureDir(this.sessionDir(sessionId, projectPath));
    await writeJson(
      join(this.sessionDir(sessionId, projectPath), CONTEXT_CACHE_FILE),
      cache,
    );
  }

  async clearContextCache(
    sessionId: string,
    projectPath?: string,
  ): Promise<void> {
    try {
      const { unlink } = await import("fs/promises");
      await unlink(
        join(this.sessionDir(sessionId, projectPath), CONTEXT_CACHE_FILE),
      );
    } catch {
      // doesn't exist, that's fine
    }
  }

  async getInterruptedSession(): Promise<{
    sessionId: string;
    messageId: string;
  } | null> {
    const all = await this.list({ status: "interrupted" });
    if (all.length === 0) return null;
    const session = all[0];
    const messages = await this.getMessages(session.id, session.projectPath);
    const last = messages[messages.length - 1];
    return last ? { sessionId: session.id, messageId: last.id } : null;
  }
}
