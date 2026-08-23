// Diagnostic: what do the two retrievers actually score for on-topic vs
// abstention queries? Not part of the benchmark; run by hand when a floor
// needs choosing. `npx tsx apps/core/src/memory/bench/probe.ts`
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryStore } from "../mem-store.js";
import { MemoryGraphService } from "../graph/index.js";
import { Bm25Index } from "../bm25.js";
import { VectorStore } from "../graph/vector-store.js";
import * as embedder from "../graph/embedder.js";
import { MODEL_ID } from "../graph/embedder.js";
import { memoryId } from "../graph/builder.js";
import { loadCorpus } from "./pool.js";
import type { MemoryEntry } from "../mem-types.js";

async function main(): Promise<void> {
  const { memories, queries } = loadCorpus();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-probe-"));
  const store = new MemoryStore(dir);
  const service = new MemoryGraphService(store);

  const now = Date.now();
  for (const m of memories) {
    store.save({ ...m, createdAt: now, updatedAt: now } as MemoryEntry);
  }
  // Force a sync so the vector sidecar is populated.
  await service.retrieve("warmup", { limit: 1 });

  const lexical = new Bm25Index(store.list(), (e) => memoryId(e.type, e.name));
  const vectors = new VectorStore(
    path.join(store.getMemoryDir(), ".graph"),
    MODEL_ID,
  );

  const n = store.list().length;
  const stats = (xs: number[]): { mean: number; sd: number } => {
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const varr =
      xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1);
    return { mean, sd: Math.sqrt(varr) };
  };

  console.log("| query | kind | cos top | cos z | bm25 top | bm25 z |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const q of queries) {
    const kind = q.relevant.length === 0 ? "abstain" : "scored";
    const qvec = await embedder.embed(q.query);

    // Every document, not just the top-k: the question is how far the best hit
    // stands out from the corpus for THIS query, which needs the whole spread.
    const cos = vectors.cosineTopK(qvec, n, -1).map((r) => r.score);
    const cs = stats(cos);
    const cosZ = cs.sd === 0 ? 0 : ((cos[0] ?? 0) - cs.mean) / cs.sd;

    const hits = lexical.search(q.query, n).map((r) => r.score);
    // BM25 drops zero-scoring documents, so pad back to corpus size: a query
    // matching two documents out of forty has 38 real zeros, and ignoring them
    // would understate how unusual the top hit is.
    const bm = [...hits, ...Array(Math.max(0, n - hits.length)).fill(0)];
    const bs = stats(bm);
    const bmZ = bs.sd === 0 ? 0 : ((bm[0] ?? 0) - bs.mean) / bs.sd;

    const label = q.query.length > 40 ? `${q.query.slice(0, 37)}...` : q.query;
    console.log(
      `| ${label} | ${kind} | ${(cos[0] ?? 0).toFixed(3)} | ${cosZ.toFixed(2)} | ${(bm[0] ?? 0).toFixed(2)} | ${bmZ.toFixed(2)} |`,
    );
  }

  service.dispose();
  fs.rmSync(store.getMemoryDir(), { recursive: true, force: true });
  fs.rmSync(path.dirname(store.getMemoryDir()), {
    recursive: true,
    force: true,
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

void main();
