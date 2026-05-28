import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { MemoryState } from "./types.js"

const SESSION_DIR = ".freecode/sessions"

export interface MemoryStorage {
  save(state: MemoryState): void
  load(sessionId: string): MemoryState | undefined
  listSessions(): string[]
  delete(sessionId: string): void
}

export class FileMemoryStorage implements MemoryStorage {
  constructor(private readonly basePath = process.cwd()) {}

  private sessionDir(sessionId: string): string {
    return join(this.basePath, SESSION_DIR, sessionId)
  }

  private memoryPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "memory.json")
  }

  save(state: MemoryState): void {
    mkdirSync(this.sessionDir(state.sessionId), { recursive: true })
    writeFileSync(this.memoryPath(state.sessionId), JSON.stringify(state, null, 2))
  }

  load(sessionId: string): MemoryState | undefined {
    const file = this.memoryPath(sessionId)
    if (!existsSync(file)) return undefined
    return JSON.parse(readFileSync(file, "utf8")) as MemoryState
  }

  listSessions(): string[] {
    const dir = join(this.basePath, SESSION_DIR)
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory())
  }

  delete(sessionId: string): void {
    rmSync(this.sessionDir(sessionId), { recursive: true, force: true })
  }
}