// =============================================================================
// Bench entrypoint (spec D14): `pnpm bench:recall`.
//
// Prints recall@k / precision / MRR / nDCG / abstention accuracy for the
// current retrieval implementation against the committed synthetic corpus.
// `--json` emits the raw numbers for diffing two runs; `--verbose` prints the
// per-query breakdown, which is what you read when a number moves.
//
// Model-call and token counters are reported and are zero for every
// configuration in this plan. The fields exist so that a future LLM reranker is
// compared against this baseline at equal cost rather than declared better for
// spending more (jcode's memory_recall_bench does the same).
// =============================================================================

import * as embedder from "../graph/embedder.js";
import { buildPool } from "./pool.js";
import {
  aggregate,
  formatMetrics,
  ndcgAtK,
  recallAtK,
  type BenchQueryResult,
} from "./metrics.js";

interface Cost {
  modelCalls: number;
  promptTokens: number;
  outputTokens: number;
}

// Which retrieval path the numbers below actually describe. `fastembed` is an
// optional dependency, so a machine without it silently benchmarks the lexical
// path alone — and a baseline table captured that way is not comparable with
// one captured with embeddings. Probe before measuring and label the output.
async function probeMode(): Promise<"fused" | "lexical_only"> {
  try {
    await embedder.embed("probe");
    return "fused";
  } catch {
    return "lexical_only";
  }
}

function perQueryTable(results: BenchQueryResult[]): string {
  const rows = results.map((r) => {
    const kind = r.relevant.length === 0 ? "abstain" : "scored";
    const score =
      r.relevant.length === 0
        ? r.ranked.length === 0
          ? "ok"
          : `LEAKED ${r.ranked.length}`
        : `${(recallAtK(r.ranked, r.relevant, 10) * 100).toFixed(0)}% / ${(
            ndcgAtK(r.ranked, r.relevant, 10) * 100
          ).toFixed(0)}%`;
    const q = r.query.length > 52 ? `${r.query.slice(0, 49)}...` : r.query;
    return `| ${q} | ${kind} | ${score} |`;
  });
  return [
    "| query | kind | R@10 / nDCG@10 |",
    "| --- | --- | ---: |",
    ...rows,
  ].join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const verbose = argv.includes("--verbose");

  const mode = await probeMode();
  const started = Date.now();
  const results = await buildPool({ limit: 10 });
  const metrics = aggregate(results);
  const cost: Cost = { modelCalls: 0, promptTokens: 0, outputTokens: 0 };
  const elapsedMs = Date.now() - started;

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ mode, metrics, cost, elapsedMs, results }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write(`${formatMetrics(metrics, mode)}\n\n`);
  if (mode === "lexical_only") {
    process.stdout.write(
      "WARNING: the embedder is unavailable (fastembed not installed), so these\n" +
        "numbers describe the lexical path alone. Do not compare them against a\n" +
        "run captured with embeddings available.\n\n",
    );
  }
  if (verbose) process.stdout.write(`${perQueryTable(results)}\n\n`);
  process.stdout.write(
    `${cost.modelCalls} model calls, ${cost.promptTokens + cost.outputTokens} tokens, ${elapsedMs} ms\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`bench failed: ${String(err)}\n`);
  process.exitCode = 1;
});
