#!/usr/bin/env tsx
// Re-publish an old run's report.json without paying to re-run it:
//   pnpm exec tsx bench/jcode-bench/runner/publish-cli.ts bench/jcode-bench/results/<run> [--fresh]
import * as fs from "fs";
import * as path from "path";
import { publish } from "./publish.js";
import { ensureUpstream, taskOneLiner } from "./tasks.js";
import type { Report } from "./types.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: publish-cli.ts <results/run-dir> [--fresh]");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf-8")) as Report;
const upstream = ensureUpstream();
const oneLiners = Object.fromEntries(
  [...new Set(report.trials.map((t) => t.task))].map((t) => [t, taskOneLiner(upstream.dir, t)]),
);
for (const f of publish(report, oneLiners, { fresh: process.argv.includes("--fresh") })) {
  console.log(path.relative(process.cwd(), f));
}
