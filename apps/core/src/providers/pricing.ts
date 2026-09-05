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
import {
  readCachedProviders,
  readCachedProvidersWrittenAt,
} from "../models-dev.js";

/**
 * The vintage of the BUILT-IN table only. Prefer `pricesAsOf()` for anything
 * user-facing — most prices now come from models.dev, and stamping those with
 * this constant would report a rate fetched today as four months old.
 */
export const PRICES_AS_OF = "2026-05";

/**
 * The vintage of the prices actually in use, for display.
 *
 * Surfaced wherever a cost is shown so a stale number is visibly stale rather
 * than silently wrong — which is the whole discipline of this module, and it
 * cuts both ways: reporting a fresh price as stale is the same class of lie.
 * When the models.dev cache is supplying rates, the honest stamp is when that
 * cache was written, not when the fallback table was last hand-edited.
 */
export function pricesAsOf(): string {
  const written = catalogueWrittenAt();
  if (written) return `models.dev ${written.toISOString().slice(0, 10)}`;
  return PRICES_AS_OF;
}

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
 * Built-in prices, keyed `provider/model`. The offline floor only — models.dev
 * carries a rate card for ~7000 models and is consulted first (see
 * `catalogueprices`). This table is what remains when its cache is cold.
 *
 * Deliberately short: an entry that is present but wrong is worse than one
 * that is absent, because absence is visible at the call site and a wrong
 * number is not.
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
let catalogue: Map<string, ModelPrice> | null = null;

/**
 * Prices from models.dev's own rate cards, read out of the disk cache that
 * `models-dev.ts` already maintains.
 *
 * This is where a price for anything beyond the three hand-listed providers
 * comes from: the catalogue now registers ~198 providers, and pricing 3 of
 * them meant cost reporting, eval spend, and the budget breaker were blind for
 * the rest. models.dev publishes `cost` for ~7000 of its ~7500 models and
 * refreshes continuously, which is strictly better than a table with a
 * `PRICES_AS_OF` stamp four months old.
 *
 * Keyed `provider/model` with the id lowercased, since ids from config vary in
 * casing (`MiniMax-M2`). Absent — a cold cache, or a model models.dev prices
 * as unknown — falls through to `BUILTIN` and then to `undefined`.
 */
/** When the models.dev cache was written, if it is supplying any prices. */
function catalogueWrittenAt(): Date | undefined {
  if (cataloguePrices().size === 0) return undefined;
  return readCachedProvidersWrittenAt() ?? undefined;
}

function cataloguePrices(): Map<string, ModelPrice> {
  if (catalogue) return catalogue;
  catalogue = new Map();
  for (const provider of readCachedProviders() ?? []) {
    for (const model of provider.models) {
      if (!model.cost) continue;
      catalogue.set(`${provider.id}/${model.id}`.toLowerCase(), {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
      });
    }
  }
  return catalogue;
}

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

/** Drops the override and catalogue caches. For tests, and for a config reload. */
export function resetPricingCache(): void {
  overrides = null;
  catalogue = null;
}

/**
 * The price for one model, or `undefined` when nothing knows it.
 *
 * Precedence: `~/.freecode/pricing.json` (the user's own contracted rate, and
 * the supported way to be exact) → models.dev's published rate card → the
 * built-in offline floor. models.dev outranks `BUILTIN` deliberately: it
 * refreshes continuously while the table carries a fixed `PRICES_AS_OF`, so
 * preferring the table would mean serving a knowingly older number.
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
  const qualified = `${provider}/${model}`;

  const userOverrides = loadOverrides();
  if (userOverrides[qualified]) return userOverrides[qualified];

  const fromCatalogue = cataloguePrices().get(qualified.toLowerCase());
  if (fromCatalogue) return fromCatalogue;

  if (BUILTIN[qualified]) return BUILTIN[qualified];

  // Bare-model-id fallback, same precedence order.
  for (const table of [userOverrides, BUILTIN]) {
    for (const [key, price] of Object.entries(table)) {
      if (key.slice(key.indexOf("/") + 1) === model) return price;
    }
  }
  for (const [key, price] of cataloguePrices()) {
    if (key.slice(key.indexOf("/") + 1) === model.toLowerCase()) return price;
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
 * How a recorded call was authenticated. Only "oauth" changes pricing, and it
 * is stamped on the event when the call is made (`rollout/types.ts`).
 */
export type AuthModeAtCall = "oauth" | "api-key";

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
  authMode?: AuthModeAtCall,
): number | undefined {
  // Subscription inference has no per-token dollar price. `undefined`, not
  // $0 — a zero would poison cost rollups with fake savings, and nothing
  // downstream could tell it from a real free call (OAuth spec §5).
  //
  // Passed in, never read from config here: the caller pricing a trace is
  // pricing calls that already happened. Reading the CURRENT auth mode meant
  // logging in once repriced every historical API-key session as
  // "subscription" — and made the price of a span depend on the machine
  // reading it.
  if (authMode === "oauth") return undefined;
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
  calls: Array<
    { provider: string; model: string; authMode?: AuthModeAtCall } & TokenCounts
  >,
): { usd: number; partial: boolean } | undefined {
  let usd = 0;
  let priced = 0;
  for (const call of calls) {
    const cost = priceUsd(call.provider, call.model, call, call.authMode);
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
