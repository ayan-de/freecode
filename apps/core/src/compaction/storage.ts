import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryState } from "./types.js";

// Home-rooted like every other ~/.freecode subsystem (sessions, rollout,
// state, config). Previously this defaulted to process.cwd(), which scattered
// compaction memory into whatever directory core was launched from (e.g. the
// repo root) and orphaned it from the session it belongs to.
const MEMORY_ROOT = join(homedir(), ".freecode", "memory");

export interface MemoryStorage {
  save(state: MemoryState): void;
  load(sessionId: string): MemoryState | undefined;
  listSessions(): string[];
  delete(sessionId: string): void;
}

export class FileMemoryStorage implements MemoryStorage {
  constructor(private readonly basePath = MEMORY_ROOT) {}

  private sessionDir(sessionId: string): string {
    return join(this.basePath, sessionId);
  }

  private memoryPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "memory.json");
  }

  save(state: MemoryState): void {
    mkdirSync(this.sessionDir(state.sessionId), { recursive: true });
    // Atomic write: a crash mid-write must not corrupt memory.json (load()
    // treats a corrupt file as "no memory" and discards the whole session's
    // state). Write to a temp file, then rename — rename is atomic on POSIX.
    const dest = this.memoryPath(state.sessionId);
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, dest);
  }

  load(sessionId: string): MemoryState | undefined {
    const file = this.memoryPath(sessionId);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as MemoryState;
    } catch {
      // Corrupted (e.g. crash mid-write) — start fresh rather than brick the session
      return undefined;
    }
  }

  listSessions(): string[] {
    if (!existsSync(this.basePath)) return [];
    return readdirSync(this.basePath).filter((entry) =>
      statSync(join(this.basePath, entry)).isDirectory(),
    );
  }

  delete(sessionId: string): void {
    rmSync(this.sessionDir(sessionId), { recursive: true, force: true });
  }
}
