// One rate card for every agent. Spec §6.4 / §7: comparing four vendors'
// self-reports is comparing four rounding policies. Cache reads are a
// discount off the inclusive input count, matching providers/pricing.ts —
// adding them on top would report a cache win as a cost increase.
//
// This copy lives here on purpose: agent-bench shares no code with
// apps/core/src/eval, and importing pricing.ts would pull the models.dev
// catalogue (and whatever ~/.freecode/pricing.json the operator has) into
// a published number. A committed table with a vintage is the honest stamp.

import type { Usage } from "./usage.js";

const MILLION = 1_000_000;

/** USD per million tokens. Vintage: MiniMax pay-as-you-go, standard ≤512k, 2026-09. */
export interface Rate {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export const RATES_AS_OF = "2026-09 MiniMax standard ≤512k";

const RATES: Record<string, Rate> = {
  "minimax-m3": { input: 0.3, output: 1.2, cacheRead: 0.06 },
};

function key(model: string): string {
  const bare = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return bare.toLowerCase();
}

export function priceUsd(model: string, usage: Usage): number | undefined {
  const rate = RATES[key(model)];
  if (!rate) return undefined;
  const cacheRead = usage.cacheReadTokens;
  const cacheWrite = usage.cacheWriteTokens;
  const plainInput = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  let usd = (plainInput / MILLION) * rate.input;
  usd += (cacheRead / MILLION) * (rate.cacheRead ?? rate.input);
  usd += (cacheWrite / MILLION) * (rate.cacheWrite ?? rate.input);
  usd += (usage.outputTokens / MILLION) * rate.output;
  return usd;
}
