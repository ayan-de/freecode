import * as fs from "fs";
import * as path from "path";
import type { Metadata } from "next";
import { BenchHub } from "../components/BenchHub";
import { PageWrapper } from "../components/PageWrapper";
import { deriveView, type RawBenchmark } from "../data/agent-bench";
import { deriveOptView, type RawOptTask } from "../data/jcode-bench";
import { EMPTY_SIGNALS, type SignalsReport } from "../data/harness-signals";

export const metadata: Metadata = {
  title: "Benchmarks — FreeCode",
  description:
    "Every way freecode is measured: resource efficiency, agent comparison, optimisation tasks, confidence stepping, hill-climbable goals, auto-poke.",
};

const DATA = path.join(process.cwd(), "app", "data");

/**
 * Everything is read at build time, never imported: each harness writes its
 * own file(s) into app/data/, and a new run appears on the page by existing.
 * This is a server component and /bench is prerendered.
 */
function readJsonDir<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as T);
}

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : fallback;
}

export default function BenchPage() {
  const opt = deriveOptView(readJsonDir<RawOptTask>(path.join(DATA, "jcode-bench")));
  const signals = readJson<SignalsReport>(
    path.join(DATA, "harness", "signals.json"),
    EMPTY_SIGNALS,
  );
  const matchups = readJsonDir<RawBenchmark>(path.join(DATA, "benchmarks"))
    .map(deriveView)
    .filter((v) => v.agents.length >= 2)
    .map((v) => ({
      slug: v.slug,
      title: v.title,
      model: v.model,
      graded: v.graded,
      isolation: v.isolation,
      instances: v.sharedInstances.length,
      agents: v.agents.map((a) => ({
        id: a.id,
        isFreeCode: a.isFreeCode,
        rate: a.rate,
        successes: a.successes,
        trials: a.trials,
        meanTokens: a.meanTokens,
        meanUsd: a.meanUsd,
      })),
      metric: v.metric.label,
    }));

  return (
    <PageWrapper>
      <BenchHub opt={opt} signals={signals} matchups={matchups} />
    </PageWrapper>
  );
}
