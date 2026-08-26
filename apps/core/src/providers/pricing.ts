// =============================================================================
// Model pricing — USD per token, so a token count can become a cost.
//
// Spec `2026-08-23-eval-harness.md` §12.1: "there is no USD anywhere", and
// without it "this prompt change made every turn 18% more expensive" is
// undetectable. `usage/tracker.ts` records tokens and `usage.get` serves them;
// nothing in the repo ever turned those into money.
//
// WHAT THIS IS FOR, and what it is not: comparing runs against each other.
// A published price changes without warning and this table cannot notice, so
// the number it produces is an ESTIMATE with a stated vintage (`PRICES_AS_OF`)
// — good for "did this change make turns more expensive", useless for
// reconciling an invoice. `~/.freecode/pricing.json` overrides any entry, and
// that is the supported way to be exact.
//
// An unknown model prices as `undefined`, never as zero and never as a guess
// from a similar name. A confidently wrong dollar figure is worse than none:
// nothing downstream can tell it apart from a real one.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * The vintage of the built-in table. Surfaced wherever a cost is displayed, so
 * a stale number is visibly stale rather than silently wrong.
 */
export const PRICES_AS_OF = "2026-05";

/** USD per MILLION tokens. Per-token division happens once, in `priceUsd`. */
export interface ModelPrice {
  input: number;
  output: number;
  /**
   * Cache reads, when the provider bills them separately. Anthropic charges
   * 0.1x input for a read and 1.25x for a write; a provider that has not
   * published cache pricing simply omits these and the tokens price as input.
   */
  cacheRead?: number;
  cacheWrite?: number;
}

const MILLION = 1_000_000;

/**
 * Built-in prices, keyed `provider/model`. Deliberately short: an entry that
 * is present but wrong is worse than one that is absent, because absence is
 * visible at the call site and a wrong number is not.
 *
 * MiniMax is absent on purpose — it had not published a rate card in a form
 * this table could cite, and inventing one to make the column non-empty is
 * exactly the failure this module's header warns about. Set it in
 * `~/.freecode/pricing.json` if you know your own rate.
 */
const BUILTIN: Record<string, ModelPrice> = {
  "anthropic/claude-opus-4-1": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "anthropic/claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "anthropic/claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "openai/gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "gemini/gemini-2.0-flash": { input: 0.1, output: 0.4, cacheRead: 0.025 },
};

let overrides: Record<string, ModelPrice> | null = null;

function pricingFile(): string {
  return (
    process.env.FREECODE_PRICING_FILE ??
    path.join(os.homedir(), ".freecode", "pricing.json")
  );
}

/**
 * User overrides, same `provider/model` keys and same USD-per-million units.
 * Read once and cached: this is consulted per model span, and a file read per
 * span on a long trace is a cost of its own.
 *
 * A malformed file is ignored rather than thrown: pricing is a display
 * concern, and it must never be the reason a trace fails to render.
 */
export function loadOverrides(): Record<string, ModelPrice> {
  if (overrides) return overrides;
  try {
    const parsed = JSON.parse(fs.readFileSync(pricingFile(), "utf-8"));
    overrides =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, ModelPrice>)
        : {};
  } catch {
    overrides = {};
  }
  return overrides;
}

/** Drops the override cache. For tests, and for a config reload. */
export function resetPricingCache(): void {
  overrides = null;
}

/**
 * The price for one model, or `undefined` when nothing knows it.
 *
 * Matching is exact on `provider/model`, then on the bare model id — a model
 * reached through a gateway carries the same id under a different provider
 * name. It never falls back to a prefix or a "closest" entry: `gpt-4o` and
 * `gpt-4o-mini` differ by 16x, and a near-miss match would report the wrong
 * one with total confidence.
 */
export function priceFor(
  provider: string,
  model: string,
): ModelPrice | undefined {
  const table = { ...BUILTIN, ...loadOverrides() };
  const qualified = `${provider}/${model}`;
  if (table[qualified]) return table[qualified];
  for (const [key, price] of Object.entries(table)) {
    if (key.slice(key.indexOf("/") + 1) === model) return price;
  }
  return undefined;
}

export interface TokenCounts {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Cost of one call in USD, or `undefined` if the model is unpriced.
 *
 * `inputTokens` is the INCLUSIVE prompt total — cache reads and writes are
 * already folded into it by `providers/provider-shared.ts`. So a cache read
 * billed at 0.1x is charged as a DISCOUNT off the input line, not as an extra
 * addend. Adding it on top would double-count exactly the tokens the cache was
 * supposed to make cheap, and would report a prompt-cache win as a cost
 * increase — the precise opposite of the truth.
 */
export function priceUsd(
  provider: string,
  model: string,
  usage: TokenCounts,
): number | undefined {
  const price = priceFor(provider, model);
  if (!price) return undefined;

  const input = usage.inputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  // Whatever is left after the separately-billed portions is charged at the
  // full input rate. Clamped: a provider that reports a read larger than the
  // total must not produce a negative bill.
  const plainInput = Math.max(0, input - cacheRead - cacheWrite);

  let usd = (plainInput / MILLION) * price.input;
  usd += (cacheRead / MILLION) * (price.cacheRead ?? price.input);
  usd += (cacheWrite / MILLION) * (price.cacheWrite ?? price.input);
  usd += ((usage.outputTokens ?? 0) / MILLION) * price.output;
  return usd;
}

/**
 * Cost across many calls. `undefined` only when NOTHING was priceable — a
 * session that used one known model and one unknown one returns the known
 * part, with `partial` set, because "we can price most of this" is a more
 * useful answer than silence and a less dangerous one than a total that
 * quietly omits a model.
 */
export function totalUsd(
  calls: Array<{ provider: string; model: string } & TokenCounts>,
): { usd: number; partial: boolean } | undefined {
  let usd = 0;
  let priced = 0;
  for (const call of calls) {
    const cost = priceUsd(call.provider, call.model, call);
    if (cost === undefined) continue;
    usd += cost;
    priced++;
  }
  if (priced === 0) return undefined;
  return { usd, partial: priced < calls.length };
}

/** `$0.0431`, or `$0.0431*` when some calls in the set could not be priced. */
export function formatUsd(total: { usd: number; partial: boolean }): string {
  const digits = total.usd < 0.01 ? 4 : total.usd < 1 ? 3 : 2;
  return `$${total.usd.toFixed(digits)}${total.partial ? "*" : ""}`;
}
