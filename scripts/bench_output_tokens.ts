#!/usr/bin/env tsx
// =============================================================================
// bench_output_tokens.ts — token-saving benchmark for the tool-output store.
//
// Deterministic, no API key, no cost: it measures the TOKENS THE MODEL RECEIVES
// under two policies on the same large tool outputs, for the scenario the store
// is built for — the model needs data in the TAIL of a big output (a build
// error at the end, the last grep matches, the bottom of a long file).
//
//   BASELINE (old head-only truncation, no retrieval):
//     Turn 1 shows the head-only cap; the tail is gone, so the model RE-RUNS the
//     tool to try again → it receives another capped output. Cost ≈ 2 × head cap.
//     (Conservative: head-only often still can't surface the tail, so real
//      baseline is worse — we count a single successful re-run.)
//
//   WITH STORE (head+tail adaptiveTruncate + `output` retrieval):
//     Turn 1 shows head+tail; one `output(id, offset)` returns a bounded tail
//     slice. Cost ≈ truncated view + one small slice.
//
// Run:  pnpm bench:output        (or: npx tsx scripts/bench_output_tokens.ts --json-out out.json)
// =============================================================================

import { estimateTokenCount } from "../apps/core/src/compaction/tokens.js";
import { adaptiveTruncate } from "../apps/core/src/tools/output-store/truncate.js";
import { OutputStore } from "../apps/core/src/tools/output-store/store.js";

interface Fixture {
  name: string;
  text: string;
}

// Deterministic fixtures (no RNG), each well over the 30 KB model cap so
// truncation actually engages. Shapes mirror real tool output.
function makeFixtures(): Fixture[] {
  const grep: string[] = [];
  for (let i = 1; i <= 6000; i++) {
    grep.push(`src/pkg/module_${i % 40}/file_${i}.ts:${i}: const result = compute(${i});`);
  }
  const build: string[] = [];
  for (let i = 1; i <= 9000; i++) build.push(`[info] compiled chunk ${i} ok`);
  // Errors at the very end — exactly what head-only truncation loses.
  build.push("[error] TS2322: Type 'string' is not assignable to type 'number'.");
  build.push("[error] Build failed with 1 error. See above.");

  const file: string[] = [];
  for (let i = 1; i <= 7000; i++) file.push(`${i}: line of source code number ${i};`);

  return [
    { name: "grep (6k hits)", text: grep.join("\n") },
    { name: "build log (9k lines, error at end)", text: build.join("\n") },
    { name: "large file read (7k lines)", text: file.join("\n") },
  ];
}

// Old head-only cap (what capModelOutput did before this feature).
const HEAD_ONLY_CAP = 30_000;
function headOnly(text: string): string {
  return text.length <= HEAD_ONLY_CAP ? text : text.slice(0, HEAD_ONLY_CAP);
}

interface Row {
  name: string;
  fullTokens: number; // naive "inject everything" upper bound
  baselineTokens: number; // head-only + one re-run
  storeTokens: number; // head+tail view + one tail retrieval
  savedTokens: number;
  savedPct: number;
}

function bench(): Row[] {
  const store = new OutputStore();
  return makeFixtures().map(({ name, text }, i) => {
    const id = `call-${i}`;
    store.put(id, text);
    const totalLines = text.split("\n").length;

    const fullTokens = estimateTokenCount(text);

    // Baseline: head-only view twice (first turn + one re-run to chase the tail).
    const headView = headOnly(text);
    const baselineTokens = estimateTokenCount(headView) * 2;

    // With store: head+tail truncated view + one bounded tail retrieval.
    const { modelOutput } = adaptiveTruncate(text, id);
    const tail = store.slice(id, Math.max(1, totalLines - 200), 200);
    const storeTokens =
      estimateTokenCount(modelOutput) + estimateTokenCount(tail.text);

    const savedTokens = baselineTokens - storeTokens;
    return {
      name,
      fullTokens,
      baselineTokens,
      storeTokens,
      savedTokens,
      savedPct: (savedTokens / baselineTokens) * 100,
    };
  });
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function main(): void {
  const rows = bench();
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);

  console.log("\nTool-output store — token savings (deterministic, tail-recovery scenario)\n");
  console.log(
    pad("fixture", 38) +
      padL("full", 10) +
      padL("baseline", 12) +
      padL("w/ store", 12) +
      padL("saved", 10) +
      padL("saved%", 9),
  );
  console.log("-".repeat(91));
  let tBase = 0;
  let tStore = 0;
  for (const r of rows) {
    tBase += r.baselineTokens;
    tStore += r.storeTokens;
    console.log(
      pad(r.name, 38) +
        padL(fmt(r.fullTokens), 10) +
        padL(fmt(r.baselineTokens), 12) +
        padL(fmt(r.storeTokens), 12) +
        padL(fmt(r.savedTokens), 10) +
        padL(r.savedPct.toFixed(1) + "%", 9),
    );
  }
  console.log("-".repeat(91));
  const totalSaved = tBase - tStore;
  const totalPct = (totalSaved / tBase) * 100;
  console.log(
    pad("TOTAL", 38) +
      padL("", 10) +
      padL(fmt(tBase), 12) +
      padL(fmt(tStore), 12) +
      padL(fmt(totalSaved), 10) +
      padL(totalPct.toFixed(1) + "%", 9),
  );
  console.log(
    `\nAcross ${rows.length} fixtures: ${fmt(totalSaved)} model-input tokens saved ` +
      `(${totalPct.toFixed(1)}% vs the re-run baseline).`,
  );
  console.log(
    "Assumption: the model needs the tail once. Head-only truncation often can't\n" +
      "surface it even after a re-run, so this understates the real saving.\n",
  );

  const jsonOutIdx = process.argv.indexOf("--json-out");
  if (jsonOutIdx !== -1 && process.argv[jsonOutIdx + 1]) {
    const fs = require("fs");
    fs.writeFileSync(
      process.argv[jsonOutIdx + 1],
      JSON.stringify({ rows, totalBaseline: tBase, totalStore: tStore, totalSaved, totalPct }, null, 2),
    );
    console.log(`Wrote ${process.argv[jsonOutIdx + 1]}`);
  }

  // ponytail: self-check — the whole point is a positive, material saving.
  if (totalSaved <= 0) {
    console.error("FAIL: expected positive token savings");
    process.exit(1);
  }
}

main();
