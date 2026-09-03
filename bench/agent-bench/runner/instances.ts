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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * datasets-server answers 500 "the dataset index is loading, this may take
 * longer than usual" when the dataset is cold — a documented, self-clearing
 * state rather than a failure, and the first thing anyone setting this up hits.
 * Backing off is the whole fix; the alternative is a stack trace that reads
 * like the harness is broken.
 */
async function fetchPage(repo: string, offset: number, attempts = 5) {
  const where = encodeURIComponent(`"repo"='${repo}'`);
  const url =
    `${API}?dataset=${encodeURIComponent(DATASET)}&config=default&split=test` +
    `&where=${where}&offset=${offset}&length=${PAGE}`;

  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      return (await res.json()) as {
        num_rows_total: number;
        rows: { row: Record<string, unknown> }[];
      };
    }
    last = `${res.status}: ${(await res.text()).slice(0, 200)}`;
    // 4xx other than rate-limiting is our bug — a wrong dataset name or filter
    // will never come right, and retrying it just delays the real message.
    if (res.status < 500 && res.status !== 429) break;
    if (attempt < attempts) {
      const waitMs = 3_000 * attempt;
      console.log(`  datasets-server ${res.status}, retry ${attempt}/${attempts - 1} in ${waitMs / 1000}s`);
      await sleep(waitMs);
    }
  }
  throw new Error(
    `datasets-server ${last}\n` +
      `The cache at ${CACHE_FILE} is untouched, so an existing one still works — ` +
      `this only blocks fetching instances you do not have yet.`,
  );
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
    // A refresh failure is not fatal on its own — the ids may all be cached
    // already, and a Hub outage should not cancel a run that needs nothing from
    // it. Fall through to the per-id check, which knows what is actually
    // missing and says so.
    try {
      await refreshCache();
      cache = readCache();
    } catch (err) {
      console.warn(`  instance refresh failed: ${(err as Error).message}`);
    }
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
