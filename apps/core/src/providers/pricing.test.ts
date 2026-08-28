import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  formatUsd,
  priceFor,
  priceUsd,
  resetPricingCache,
  totalUsd,
} from "./pricing.js";

test("an unknown model prices as undefined, never as zero", () => {
  // A confidently wrong dollar figure is worse than none: nothing downstream
  // can tell it apart from a real one.
  assert.equal(priceFor("minimax", "MiniMax-M3"), undefined);
  assert.equal(
    priceUsd("minimax", "MiniMax-M3", { inputTokens: 1_000_000 }),
    undefined,
  );
});

test("never falls back to a near-miss name", () => {
  // gpt-4o and gpt-4o-mini differ by 16x; a prefix match would report the
  // wrong one with total confidence.
  assert.equal(priceFor("openai", "gpt-4o-2099-preview"), undefined);
  assert.notEqual(priceFor("openai", "gpt-4o"), undefined);
  assert.notEqual(priceFor("openai", "gpt-4o-mini"), undefined);
});

test("a bare model id matches whatever provider routed it", () => {
  assert.deepEqual(
    priceFor("some-gateway", "claude-sonnet-4-5"),
    priceFor("anthropic", "claude-sonnet-4-5"),
  );
});

test("prices plain input and output at the headline rate", () => {
  // 1M in at $3 + 1M out at $15.
  const usd = priceUsd("anthropic", "claude-sonnet-4-5", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(usd, 18);
});

test("a cache read is a DISCOUNT off input, not an extra charge", () => {
  // This is the one that matters. `inputTokens` is the inclusive prompt total
  // with cache reads already folded in, so charging the read on top would
  // double-count exactly the tokens the cache made cheap — and would report a
  // prompt-cache win as a cost increase.
  const cached = priceUsd("anthropic", "claude-sonnet-4-5", {
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
  });
  const uncached = priceUsd("anthropic", "claude-sonnet-4-5", {
    inputTokens: 1_000_000,
  });
  assert.equal(cached, 0.3); // 1M at the 0.3 read rate, not 3 + 0.3
  assert.equal(uncached, 3);
  assert.ok(cached! < uncached!, "caching must be cheaper, not dearer");
});

test("a cache write costs more than plain input", () => {
  const written = priceUsd("anthropic", "claude-sonnet-4-5", {
    inputTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
  });
  assert.equal(written, 3.75);
});

test("a read larger than the total cannot produce a negative bill", () => {
  const usd = priceUsd("anthropic", "claude-sonnet-4-5", {
    inputTokens: 1_000,
    cacheReadTokens: 5_000,
  });
  assert.ok(usd !== undefined && usd > 0);
});

test("a provider with no published cache rate bills cache as input", () => {
  // gemini-2.0-flash has a read rate; construct the fallback explicitly.
  const withoutRate = priceUsd("openai", "gpt-4o", {
    inputTokens: 1_000_000,
    cacheWriteTokens: 1_000_000, // gpt-4o has no cacheWrite entry
  });
  assert.equal(withoutRate, 2.5);
});

test("totalUsd reports a partial when some calls are unpriced", () => {
  const total = totalUsd([
    { provider: "anthropic", model: "claude-sonnet-4-5", inputTokens: 1_000_000 },
    { provider: "minimax", model: "MiniMax-M3", inputTokens: 1_000_000 },
  ]);
  assert.deepEqual(total, { usd: 3, partial: true });
});

test("totalUsd is undefined only when NOTHING was priceable", () => {
  assert.equal(
    totalUsd([{ provider: "minimax", model: "MiniMax-M3", inputTokens: 10 }]),
    undefined,
  );
  assert.equal(totalUsd([]), undefined);
});

test("formatUsd keeps small costs visible", () => {
  // Two decimals would render every sub-cent run as $0.00.
  assert.equal(formatUsd({ usd: 0.0043, partial: false }), "$0.0043");
  assert.equal(formatUsd({ usd: 0.431, partial: false }), "$0.431");
  assert.equal(formatUsd({ usd: 12.3456, partial: false }), "$12.35");
  assert.equal(formatUsd({ usd: 0.0043, partial: true }), "$0.0043*");
});

test("an override file wins over the built-in table", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-pricing-"));
  const file = path.join(dir, "pricing.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ "minimax/MiniMax-M3": { input: 1, output: 2 } }),
  );
  const prev = process.env.FREECODE_PRICING_FILE;
  process.env.FREECODE_PRICING_FILE = file;
  resetPricingCache();
  try {
    assert.equal(
      priceUsd("minimax", "MiniMax-M3", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
      3,
    );
  } finally {
    if (prev === undefined) delete process.env.FREECODE_PRICING_FILE;
    else process.env.FREECODE_PRICING_FILE = prev;
    resetPricingCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed override file is ignored, not thrown", () => {
  // Pricing is a display concern; it must never be why a trace fails to render.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-pricing-"));
  const file = path.join(dir, "pricing.json");
  fs.writeFileSync(file, "{ not json");
  const prev = process.env.FREECODE_PRICING_FILE;
  process.env.FREECODE_PRICING_FILE = file;
  resetPricingCache();
  try {
    assert.notEqual(priceFor("anthropic", "claude-sonnet-4-5"), undefined);
  } finally {
    if (prev === undefined) delete process.env.FREECODE_PRICING_FILE;
    else process.env.FREECODE_PRICING_FILE = prev;
    resetPricingCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
