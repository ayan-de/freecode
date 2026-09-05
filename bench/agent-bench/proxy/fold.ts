import * as fs from "fs";
import * as path from "path";
import { audit } from "./audit.js";
import { priceUsd } from "./price.js";
import type { LoggedCall } from "./server.js";
import type { Usage } from "./usage.js";

export interface TrialMeter {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number | undefined;
  leaks: number;
  auditOk: boolean;
}

const ZERO: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function readLog(file: string): LoggedCall[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedCall);
}

export function foldTrial(calls: LoggedCall[], model: string): TrialMeter {
  const modelCalls = calls.filter((c) => c.modelEndpoint);
  const usage = modelCalls.reduce<Usage>(
    (acc, c) => ({
      inputTokens: acc.inputTokens + (c.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (c.usage?.outputTokens ?? 0),
      cacheReadTokens: acc.cacheReadTokens + (c.usage?.cacheReadTokens ?? 0),
      cacheWriteTokens: acc.cacheWriteTokens + (c.usage?.cacheWriteTokens ?? 0),
    }),
    { ...ZERO },
  );
  const isolation = audit(calls);
  return {
    turns: modelCalls.length,
    ...usage,
    usd: priceUsd(model, usage),
    leaks: isolation.leaks.length,
    // An empty log is not a clean audit: the agent never went through the
    // meter (wrong base URL, or it talked around us).
    auditOk: isolation.ok && modelCalls.length > 0,
  };
}

/** Fold the jsonl into usage.json + audit.json next to it. */
export function persistTrialMeter(artifactDir: string, model: string): TrialMeter {
  const logPath = path.join(artifactDir, "proxy.jsonl");
  const calls = readLog(logPath);
  const usage = foldTrial(calls, model);
  fs.writeFileSync(
    path.join(artifactDir, "usage.json"),
    JSON.stringify(usage, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(artifactDir, "audit.json"),
    JSON.stringify(audit(calls), null, 2) + "\n",
  );
  return usage;
}
