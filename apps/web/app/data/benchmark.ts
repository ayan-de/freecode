import results1 from "./results-1.json";
import results10 from "./results-10.json";

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
