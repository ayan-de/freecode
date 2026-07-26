// =============================================================================
// MemoryGraphService - single entry point the loop / IPC call (spec §4).
// Phase 1: local vector retrieval over the persistent memory store, with a
// keyword fallback (spec D6). Wraps MemoryStore, never replaces it. Graph edges
// + cascade arrive in Phase 2 behind this same facade.
// =============================================================================

import * as crypto from "crypto";
import * as path from "path";
import type { MemoryEntry, MemoryType, MemoryQueryOptions } from "../mem-types.js";
import { MemoryStore, getMemoryStore, onMemoryChange } from "../mem-store.js";
import type { MemoryChange } from "../mem-store.js";
import { findRelevantMemories } from "../mem-query.js";
import * as embedder from "./embedder.js";
import { MODEL_ID } from "./embedder.js";
import { VectorStore } from "./vector-store.js";

const GRAPH_DIR = ".graph";

function entryId(type: MemoryType, name: string): string {
  return `${type}/${name}`;
}

function splitId(id: string): { type: MemoryType; name: string } {
  const slash = id.indexOf("/");
  return {
    type: id.slice(0, slash) as MemoryType,
    name: id.slice(slash + 1),
  };
}

// What we embed for a memory: name + description + body carry its meaning.
function embedText(e: MemoryEntry): string {
  return `${e.name}\n${e.description}\n${e.content}`;
}

function hashOf(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export class MemoryGraphService {
  private store: MemoryStore;
  private vectors: VectorStore;
  // Single-flight queue so concurrent saves can't corrupt the sidecar (D2).
  private queue: Promise<void> = Promise.resolve();

  constructor(store: MemoryStore) {
    this.store = store;
    this.vectors = new VectorStore(
      path.join(store.getMemoryDir(), GRAPH_DIR),
      MODEL_ID,
    );
    onMemoryChange((change) => {
      if (change.store.getMemoryDir() === this.store.getMemoryDir()) {
        void this.onChange(change);
      }
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  // Incremental index update on save/delete — fire-and-forget, never throws.
  async onChange(change: MemoryChange): Promise<void> {
    try {
      if (change.deleted) {
        const id = entryId(change.deleted.type, change.deleted.name);
        await this.enqueue(async () => this.vectors.remove(id));
        return;
      }
      if (change.entry && embedder.available()) {
        const e = change.entry;
        const id = entryId(e.type, e.name);
        const hash = hashOf(embedText(e));
        if (this.vectors.hasFresh(id, hash)) return;
        const vec = await embedder.embed(embedText(e));
        await this.enqueue(async () => this.vectors.put(id, hash, vec));
      }
    } catch {
      // Eventual consistency: this entry gets embedded on the next drain.
    }
  }

  // Bring the vector index in line with the files: embed changed/missing
  // entries, drop stale ones. Serialized through the write queue.
  private async sync(): Promise<void> {
    const entries = this.store.list();
    const liveIds = new Set<string>();
    for (const e of entries) {
      const id = entryId(e.type, e.name);
      liveIds.add(id);
      const hash = hashOf(embedText(e));
      if (this.vectors.hasFresh(id, hash)) continue;
      if (!embedder.available()) return; // backend died mid-sync → bail
      const vec = await embedder.embed(embedText(e));
      await this.enqueue(async () => this.vectors.put(id, hash, vec));
    }
    for (const id of this.vectors.allIds()) {
      if (!liveIds.has(id)) {
        await this.enqueue(async () => this.vectors.remove(id));
      }
    }
  }

  // Retrieve the memories most relevant to `query`. Falls back to the keyword
  // scorer whenever embeddings are unavailable (spec D6) — never throws.
  async retrieve(
    query: string,
    options: MemoryQueryOptions = {},
  ): Promise<MemoryEntry[]> {
    const { limit = 8, types } = options;
    const fallback = () => findRelevantMemories(query, this.store, options);

    if (!embedder.available() || query.trim().length === 0) return fallback();

    try {
      await this.sync();
      if (!embedder.available() || this.vectors.size() === 0) return fallback();

      const qvec = await embedder.embed(query);
      // Over-fetch, then filter by type and cap at limit.
      const scored = this.vectors.cosineTopK(qvec, limit * 3, 0.4);
      const out: MemoryEntry[] = [];
      for (const { id } of scored) {
        const { type, name } = splitId(id);
        if (types && types.length > 0 && !types.includes(type)) continue;
        const entry = this.store.load(name, type);
        if (entry) out.push(entry);
        if (out.length >= limit) break;
      }
      return out.length > 0 ? out : fallback();
    } catch {
      return fallback();
    }
  }

  // Full rebuild from files (maintenance). Clears vectors, then re-syncs.
  async rebuild(): Promise<void> {
    await this.enqueue(async () => this.vectors.clear());
    await this.sync();
  }

  stats(): { vectors: number; dims: number; embedder: boolean } {
    return {
      vectors: this.vectors.size(),
      dims: this.vectors.getDims(),
      embedder: embedder.available(),
    };
  }
}

// =============================================================================
// Factory — one service per project, mirroring getMemoryStore.
// =============================================================================

let globalService: MemoryGraphService | null = null;
let globalProjectPath: string | null = null;

export function getMemoryGraphService(projectPath: string): MemoryGraphService {
  if (!globalService || globalProjectPath !== projectPath) {
    globalService = new MemoryGraphService(getMemoryStore(projectPath));
    globalProjectPath = projectPath;
  }
  return globalService;
}
