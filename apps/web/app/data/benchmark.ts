import results1 from "./results-1.json";
import results10 from "./results-10.json";
import freecodeBench from "./freecode-bench-results.json";

// Shape of a single tool entry in the benchmark JSON produced by
// scripts/bench_memory.py. Only the fields the charts consume are typed.
interface RawResult {
  tool: string;
  pss_mb: number | null;
  seconds_to_input_ready_med: number | null;
}

interface RawPayload {
  results: RawResult[];
}

export interface BenchmarkItem {
  tool: string;
  value: number | null;
  displayValue: string;
  comparison: string;
  isFreeCode: boolean;
}

const FREECODE_TOOL = "freecode";

function formatMemory(mb: number): string {
  return `${mb.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MB`;
}

function formatSeconds(s: number): string {
  return `${s.toFixed(2)} s`;
}

/**
 * Turn raw benchmark rows into chart-ready items:
 * - keeps only rows that have a value for the chosen metric
 * - sorts ascending (freecode, being the lightest/fastest, leads)
 * - computes the "N× more RAM" / "N× slower" comparison against freecode
 */
function toItems(
  payload: RawPayload,
  metric: "pss_mb" | "seconds_to_input_ready_med",
  format: (v: number) => string,
  ratioSuffix: string,
): BenchmarkItem[] {
  const rows = payload.results
    .map((r) => ({ tool: r.tool, value: r[metric] }))
    .filter((r): r is { tool: string; value: number } => r.value != null)
    .sort((a, b) => a.value - b.value);

  const baseline = rows.find((r) => r.tool === FREECODE_TOOL)?.value ?? null;

  return rows.map((r) => {
    const isFreeCode = r.tool === FREECODE_TOOL;
    let comparison = "";
    if (isFreeCode) {
      comparison = "baseline";
    } else if (baseline && baseline > 0) {
      comparison = `${(r.value / baseline).toFixed(1)}× ${ratioSuffix}`;
    }
    return {
      tool: r.tool,
      value: r.value,
      displayValue: format(r.value),
      comparison,
      isFreeCode,
    };
  });
}

export const memory1SessionData: BenchmarkItem[] = toItems(
  results1 as RawPayload,
  "pss_mb",
  formatMemory,
  "more RAM",
);

export const timeToReadyData: BenchmarkItem[] = toItems(
  results1 as RawPayload,
  "seconds_to_input_ready_med",
  formatSeconds,
  "slower",
);

export const memory10SessionsData: BenchmarkItem[] = toItems(
  results10 as RawPayload,
  "pss_mb",
  formatMemory,
  "more RAM",
);

// ---------- FreeCode bench v1 ----------
// Inspired by jcode's "jcode bench v1" (https://jcode.sh/models) — same three
// optimization-depth tasks, same scoring (log2 speedup, geometric mean across
// tasks). FreeCode row at top, then jcode's published frontier models for
// context. Higher is better.

export interface FreeCodeBenchRow {
  model: string;
  isFreeCode: boolean;
  jsonUnescape: number;
  floatPrint: number;
  utf16Transcode: number;
  geomean: number;
  typicalSpeedupX: number;
}

export interface FreeCodeBenchSection {
  published: boolean;
  generatedAt: string;
  agent: string;
  hardware: string;
  rows: FreeCodeBenchRow[];
}

function buildFreeCodeBench(): FreeCodeBenchSection | null {
  const data = freecodeBench as {
    published: boolean;
    generated_at: string;
    agent: string;
    model: string;
    hardware: string;
    tasks: Record<string, { score: number }>;
    geomean: number;
    typical_speedup_x: number;
    _jcode_reference?: { rows: Array<{ model: string; "json-unescape": number; "float-print": number; "utf16-transcode": number; geomean: number; typical_speedup_x: number }> };
  };
  if (!data.published) return null;
  const fcScores = data.tasks;
  const freecode: FreeCodeBenchRow = {
    model: `FreeCode (${data.model})`,
    isFreeCode: true,
    jsonUnescape: fcScores["json-unescape"]?.score ?? 0,
    floatPrint: fcScores["float-print"]?.score ?? 0,
    utf16Transcode: fcScores["utf16-transcode"]?.score ?? 0,
    geomean: data.geomean,
    typicalSpeedupX: data.typical_speedup_x,
  };
  const refRows = (data._jcode_reference?.rows ?? []).map((r) => ({
    model: r.model,
    isFreeCode: false,
    jsonUnescape: r["json-unescape"],
    floatPrint: r["float-print"],
    utf16Transcode: r["utf16-transcode"],
    geomean: r.geomean,
    typicalSpeedupX: r.typical_speedup_x,
  }));
  return {
    published: true,
    generatedAt: data.generated_at,
    agent: data.agent,
    hardware: data.hardware,
    rows: [freecode, ...refRows],
  };
}

export const freecodeBenchSection: FreeCodeBenchSection | null = buildFreeCodeBench();
