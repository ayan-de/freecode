#!/usr/bin/env tsx
// =============================================================================
// bench_tool_comparison.ts — cross-tool token comparison for large tool output.
//
// HONESTY: this is NOT a live API measurement. It models each tool's *actual
// truncation policy*, read from that tool's source, and runs identical fixtures
// through each. Every number derives from a real constant in the tool's code
// (cited per tool via `source`); tools whose model-facing behaviour couldn't be
// confirmed from the available bundle are marked `verified: false`.
//
// Scenario (uniform across all tools, so the comparison is fair): a big tool
// output whose needed data is in the TAIL. We count the model-input tokens each
// tool's harness spends to get head + tail:
//   total = firstTurnView  +  (hasRetrieval ? one bounded tail slice
//                                            : re-run → another firstTurnView)
//
// Run:  pnpm bench:compare                       (writes JSON for the frontend)
//       npx tsx scripts/bench_tool_comparison.ts --json-out path.json
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import { estimateTokenCount } from "../apps/core/src/compaction/tokens.js";

// ---- Tool policies, each grounded in that tool's source ---------------------

type Shape = "head" | "head-tail";

interface ToolPolicy {
  label: string;
  capLines?: number; // truncate to N lines (if the tool caps by lines)
  capBytes: number; // and/or to N bytes
  shape: Shape; // head-only, or head+tail preview
  hasRetrieval: boolean; // can fetch the rest WITHOUT re-running the tool?
  verified: boolean; // policy confirmed from source?
  source: string; // where the numbers come from
}

const KB = 1024;

const TOOLS: ToolPolicy[] = [
  {
    label: "freecode (new)",
    capBytes: 30_000,
    shape: "head-tail",
    hasRetrieval: true,
    verified: true,
    source: "tools/output-store/{truncate,store}.ts — 24k head + 6k tail, in-memory output store",
  },
  {
    label: "opencode",
    capLines: 2000,
    capBytes: 50 * KB,
    shape: "head-tail",
    hasRetrieval: true,
    verified: true,
    source: "opencode packages/opencode/src/tool/truncate.ts + core/tool-output-store.ts (MAX_LINES 2000 / MAX_BYTES 50KB, full output → file)",
  },
  {
    label: "pi",
    capLines: 2000,
    capBytes: 50 * KB,
    shape: "head",
    hasRetrieval: true,
    verified: true,
    source: "pi packages/agent/src/harness/utils/truncate.ts (2000 lines / 50KB, full output → fullOutputPath)",
  },
  {
    label: "freecode (old)",
    capBytes: 30_000,
    shape: "head",
    hasRetrieval: false,
    verified: true,
    source: "prior capModelOutput — 30k head-only, no retrieval (re-run to recover tail)",
  },
  {
    label: "claude-code",
    capBytes: 30_000,
    shape: "head",
    hasRetrieval: false,
    verified: false,
    source: "assumed head-truncate + re-run; model-facing bash store not confirmable from the bundle (verified:false)",
  },
];

// ---- Fixtures (deterministic, mirror real tool output) ----------------------

interface Fixture {
  name: string;
  text: string;
}

function makeFixtures(): Fixture[] {
  const grep: string[] = [];
  for (let i = 1; i <= 6000; i++)
    grep.push(`src/pkg/module_${i % 40}/file_${i}.ts:${i}: const result = compute(${i});`);
  const build: string[] = [];
  for (let i = 1; i <= 9000; i++) build.push(`[info] compiled chunk ${i} ok`);
  build.push("[error] TS2322: Type 'string' is not assignable to type 'number'.");
  build.push("[error] Build failed with 1 error.");
  const file: string[] = [];
  for (let i = 1; i <= 7000; i++) file.push(`${i}: line of source code number ${i};`);
  return [
    { name: "grep (6k hits)", text: grep.join("\n") },
    { name: "build log (9k lines, error at end)", text: build.join("\n") },
    { name: "large file read (7k lines)", text: file.join("\n") },
  ];
}

// ---- Policy application -----------------------------------------------------

// The first-turn view the model receives for `text` under a tool's policy.
function firstTurnView(text: string, p: ToolPolicy): string {
  let lines = text.split("\n");
  if (p.capLines && lines.length > p.capLines) {
    if (p.shape === "head-tail") {
      const head = Math.floor(p.capLines * 0.9);
      const tail = p.capLines - head;
      lines = [...lines.slice(0, head), "...truncated...", ...lines.slice(-tail)];
    } else {
      lines = lines.slice(0, p.capLines);
    }
  }
  let view = lines.join("\n");
  if (view.length > p.capBytes) {
    if (p.shape === "head-tail") {
      const tailB = Math.floor(p.capBytes * 0.2);
      view = view.slice(0, p.capBytes - tailB) + "\n...truncated...\n" + view.slice(-tailB);
    } else {
      view = view.slice(0, p.capBytes);
    }
  }
  return view;
}

// A bounded tail retrieval (~200 lines) — same for every tool's retrieval path,
// so the only difference is whether the tool HAS retrieval or must re-run.
function tailSlice(text: string): string {
  return text.split("\n").slice(-200).join("\n");
}

interface ToolResult {
  label: string;
  verified: boolean;
  hasRetrieval: boolean;
  source: string;
  totalTokens: number;
  perFixture: { fixture: string; firstTurn: number; recovery: number; total: number }[];
}

function run() {
  const fixtures = makeFixtures();
  const results: ToolResult[] = TOOLS.map((p) => {
    const perFixture = fixtures.map((f) => {
      const firstTurn = estimateTokenCount(firstTurnView(f.text, p));
      const recovery = p.hasRetrieval
        ? estimateTokenCount(tailSlice(f.text)) // one bounded read
        : firstTurn; // no retrieval → re-run costs another first-turn view
      return { fixture: f.name, firstTurn, recovery, total: firstTurn + recovery };
    });
    return {
      label: p.label,
      verified: p.verified,
      hasRetrieval: p.hasRetrieval,
      source: p.source,
      totalTokens: perFixture.reduce((s, r) => s + r.total, 0),
      perFixture,
    };
  });
  results.sort((a, b) => a.totalTokens - b.totalTokens);
  return {
    generatedAt: new Date().toISOString(),
    kind: "modeled-from-source",
    assumption: "Model needs the tail once. Numbers are tokens the harness sends the model; each tool's caps are read from its source (see per-tool `source`). Not a live API measurement.",
    caveats: [
      "Two axes drive the total: (1) first-turn cap size, (2) whether the tool has retrieval (avoids a re-run double-spend).",
      "freecode's lead comes largely from a TIGHTER first-turn cap (30KB) vs opencode/pi (50KB) — a deliberate tradeoff: fewer tokens up front, but less shown before a follow-up. It is not strictly 'more capable', it is more frugal.",
      "opencode & pi also have retrieval (file-based), so they too avoid the re-run penalty that freecode-old / claude-code pay; their higher total is the larger cap, not a missing feature.",
      "claude-code is unverified (verified:false) — treat its row as illustrative, not a measured claim.",
    ],
    fixtures: fixtures.map((f) => f.name),
    tools: results,
  };
}

function print(data: ReturnType<typeof run>) {
  console.log(`\nCross-tool token comparison — ${data.kind} (lower = better)\n`);
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);
  console.log(pad("tool", 18) + padL("total tokens", 14) + padL("retrieval", 12) + "  basis");
  console.log("-".repeat(78));
  const best = data.tools[0].totalTokens;
  for (const t of data.tools) {
    const rel = t.totalTokens === best ? "best" : `+${(((t.totalTokens - best) / best) * 100).toFixed(0)}%`;
    console.log(
      pad(t.label + (t.verified ? "" : " *"), 18) +
        padL(t.totalTokens.toLocaleString(), 14) +
        padL(t.hasRetrieval ? "yes" : "re-run", 12) +
        `  ${rel}`,
    );
  }
  console.log("-".repeat(78));
  console.log("* unverified policy. retrieval=yes ⇒ no re-run double-spend.");
  console.log("Note: freecode's lead is a tighter 30KB first-turn cap (vs opencode/pi 50KB) — frugal by design, not strictly more capable. See `caveats` in the JSON.\n");
}

function main() {
  const data = run();
  print(data);

  const idx = process.argv.indexOf("--json-out");
  const out = idx !== -1 && process.argv[idx + 1]
    ? process.argv[idx + 1]
    : path.resolve(__dirname, "../apps/web/app/data/tool-token-benchmark.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`Wrote ${out}`);
}

main();
