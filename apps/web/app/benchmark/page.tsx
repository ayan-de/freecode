import * as fs from "fs";
import * as path from "path";
import type { Metadata } from "next";
import { AgentBenchmark } from "../components/AgentBenchmark";
import { PageWrapper } from "../components/PageWrapper";
import { deriveView, type BenchView, type RawBenchmark } from "../data/agent-bench";

export const metadata: Metadata = {
  title: "Agent benchmark — FreeCode",
  description:
    "freecode against other coding agents on SWE-bench Lite: same tasks, same model, same key.",
};

const DIR = path.join(process.cwd(), "app", "data", "benchmarks");

/**
 * Read at build time, not imported.
 *
 * `pnpm bench:agents` writes one file per matchup, so a new pairing appears on
 * the page by existing — nobody has to remember to add an import. This is a
 * server component and /benchmark is prerendered, so the directory is read
 * during the build and no filesystem call reaches a visitor.
 */
function loadViews(): BenchView[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8")) as RawBenchmark)
    .map(deriveView)
    // A solo run is a pipeline check, not a matchup — one agent compared to
    // nobody has no business on a comparison page.
    .filter((v) => v.agents.length >= 2)
    // Widest matchup first: the one with the most agents, then the most
    // instances, is the one worth opening on.
    .sort(
      (a, b) =>
        b.agents.length - a.agents.length ||
        b.sharedInstances.length - a.sharedInstances.length ||
        a.slug.localeCompare(b.slug),
    );
}

export default function BenchmarkPage() {
  return (
    <PageWrapper>
      <AgentBenchmark views={loadViews()} />
    </PageWrapper>
  );
}
