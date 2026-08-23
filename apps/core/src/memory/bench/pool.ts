// =============================================================================
// Bench pool stage (spec D14): run every corpus query through the *production*
// retrieval path and record the ranked ids.
//
// The design constraint, taken from jcode's memory_recall_bench: this must call
// the real MemoryGraphService, not a reimplementation of its scoring. A
// benchmark of a reimplementation measures the reimplementation.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStore } from "../mem-store.js";
import { MemoryGraphService } from "../graph/index.js";
import { memoryId } from "../graph/builder.js";
import type { MemoryEntry, MemoryType } from "../mem-types.js";
import type { BenchQueryResult } from "./metrics.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(HERE, "corpus");

interface CorpusMemory {
  type: MemoryType;
  name: string;
  description: string;
  content: string;
  tags?: string[];
  supersedes?: string[];
}

export interface CorpusQuery {
  query: string;
  relevant: string[];
}

export function loadCorpus(dir = CORPUS_DIR): {
  memories: CorpusMemory[];
  queries: CorpusQuery[];
} {
  const read = <T>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as T;
  return {
    memories: read<CorpusMemory[]>("memories.json"),
    queries: read<CorpusQuery[]>("queries.json"),
  };
}

// Validate the fixture before measuring against it: a gold id pointing at a
// memory that does not exist silently caps recall at less than 1, which reads
// as a retrieval failure. Fail loudly instead.
export function validateCorpus(
  memories: CorpusMemory[],
  queries: CorpusQuery[],
): string[] {
  const ids = new Set(memories.map((m) => memoryId(m.type, m.name)));
  const problems: string[] = [];
  for (const q of queries) {
    for (const id of q.relevant) {
      if (!ids.has(id)) problems.push(`unknown gold id "${id}" in "${q.query}"`);
    }
  }
  const seen = new Set<string>();
  for (const m of memories) {
    const id = memoryId(m.type, m.name);
    if (seen.has(id)) problems.push(`duplicate memory id "${id}"`);
    seen.add(id);
  }
  return problems;
}

// A throwaway project key so the bench never touches a real memory store.
// MemoryStore derives its directory from the basename of the path it is given
// (mem-store.ts:31), so a unique temp basename yields a unique store.
export function withTempStore<T>(fn: (store: MemoryStore) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-bench-"));
  const store = new MemoryStore(dir);
  try {
    return fn(store);
  } finally {
    fs.rmSync(store.getMemoryDir(), { recursive: true, force: true });
    fs.rmSync(path.dirname(store.getMemoryDir()), {
      recursive: true,
      force: true,
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function toEntry(m: CorpusMemory): MemoryEntry {
  const now = Date.now();
  return {
    name: m.name,
    description: m.description,
    type: m.type,
    content: m.content,
    createdAt: now,
    updatedAt: now,
    ...(m.tags ? { tags: m.tags } : {}),
    ...(m.supersedes && m.supersedes.length > 0
      ? { supersedes: m.supersedes }
      : {}),
  };
}

export interface PoolOptions {
  limit?: number;
  corpusDir?: string;
  /**
   * Judge stand-in (spec D15). Given the query and the candidate descriptions,
   * returns the raw verdict string a model would return.
   *
   * The bench does not call a real provider: a benchmark that costs money per
   * run stops being run. Supplying an oracle here measures the *ceiling* the
   * judge can reach — how much of the abstention gap a perfect reader closes —
   * which is the number that decides whether the call is worth making at all.
   */
  judge?: (query: string, listed: string) => Promise<string>;
}

// Load the corpus into a temp store, run every query, return ranked ids.
export async function buildPool(
  options: PoolOptions = {},
): Promise<BenchQueryResult[]> {
  const { limit = 10, corpusDir, judge } = options;
  const { memories, queries } = loadCorpus(corpusDir);

  const problems = validateCorpus(memories, queries);
  if (problems.length > 0) {
    throw new Error(`corpus is invalid:\n  ${problems.join("\n  ")}`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-bench-"));
  const store = new MemoryStore(dir);
  const service = new MemoryGraphService(store);
  try {
    for (const m of memories) store.save(toEntry(m));

    const out: BenchQueryResult[] = [];
    for (const q of queries) {
      let entries = await service.retrieve(q.query, { limit });
      if (judge) {
        const { judgeMemories } = await import("../judge.js");
        const verdict = await judgeMemories({
          query: q.query,
          candidates: entries,
          provider: "bench",
          complete: async (_system, prompt) => judge(q.query, prompt),
        });
        entries = verdict.kept;
      }
      out.push({
        query: q.query,
        ranked: entries.map((e) => memoryId(e.type, e.name)),
        relevant: q.relevant,
      });
    }
    return out;
  } finally {
    service.dispose();
    fs.rmSync(store.getMemoryDir(), { recursive: true, force: true });
    fs.rmSync(path.dirname(store.getMemoryDir()), {
      recursive: true,
      force: true,
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
