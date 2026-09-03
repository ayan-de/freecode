// =============================================================================
// SWE-bench Lite instances — fetch once, cache locally, drop the answer key.
//
// The task set stays external (spec §6.1): we do not author these and we do not
// edit them. The only local processing is REMOVING fields.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { Instance } from "./types.js";

const DATASET = "princeton-nlp/SWE-bench_Lite";
const API = "https://datasets-server.huggingface.co/filter";
const PAGE = 100; // the datasets-server maximum

export const CACHE_DIR = path.join(import.meta.dirname, "..", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "instances.jsonl");

/**
 * `patch` and `test_patch` are the gold fix; `hints_text` is the maintainer
 * discussion that frequently contains it in prose. None of the three is written
 * to disk, ever.
 *
 * This is not paranoia about the agent under test — it cannot see this repo
 * from its workspace. It is about THIS repo: a committed answer key is a file
 * that any future agent working in freecode can grep, and a benchmark whose
 * answers live next to it is worth nothing.
 */
function reduce(row: Record<string, unknown>): Instance {
  return {
    instanceId: String(row.instance_id),
    repo: String(row.repo),
    baseCommit: String(row.base_commit),
    problemStatement: String(row.problem_statement),
  };
}

async function fetchPage(repo: string, offset: number) {
  const where = encodeURIComponent(`"repo"='${repo}'`);
  const url =
    `${API}?dataset=${encodeURIComponent(DATASET)}&config=default&split=test` +
    `&where=${where}&offset=${offset}&length=${PAGE}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`datasets-server ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as {
    num_rows_total: number;
    rows: { row: Record<string, unknown> }[];
  };
}

/** Downloads every instance for `repo` into the cache. Network, one-time. */
export async function refreshCache(repo = "django/django"): Promise<number> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out: Instance[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = await fetchPage(repo, offset);
    total = page.num_rows_total;
    out.push(...page.rows.map((r) => reduce(r.row)));
  }
  fs.writeFileSync(
    CACHE_FILE,
    out.map((i) => JSON.stringify(i)).join("\n") + "\n",
  );
  return out.length;
}

export function readCache(): Map<string, Instance> {
  if (!fs.existsSync(CACHE_FILE)) return new Map();
  const map = new Map<string, Instance>();
  for (const line of fs.readFileSync(CACHE_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const inst = JSON.parse(line) as Instance;
    map.set(inst.instanceId, inst);
  }
  return map;
}

/**
 * Resolves the requested ids, refreshing the cache once if any are missing.
 * A still-missing id is a hard error: silently running 4 of 5 requested
 * instances would publish a mean over a set nobody chose.
 */
export async function loadInstances(ids: string[]): Promise<Instance[]> {
  let cache = readCache();
  if (ids.some((id) => !cache.has(id))) {
    await refreshCache();
    cache = readCache();
  }
  return ids.map((id) => {
    const inst = cache.get(id);
    if (!inst) throw new Error(`instance not in ${DATASET}: ${id}`);
    return inst;
  });
}

/** Reads an instance-id list file, ignoring blanks and `#` comments. */
export function readIdList(file: string): string[] {
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((l) => l.split("#")[0]!.trim())
    .filter(Boolean);
}
