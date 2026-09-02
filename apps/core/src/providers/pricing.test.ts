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

// Pin the models.dev cache to a path that does not exist, so these assert the
// built-in table and the override file only. Without this they would read
// ~/.freecode/cache/models-dev.json and pass or fail depending on whether the
// developer running them had opened the model picker — and models.dev prices
// several models this file asserts are unpriced.
process.env.FREECODE_MODELS_CACHE_FILE = path.join(
  os.tmpdir(),
  "freecode-pricing-test-no-such-cache.json",
);
resetPricingCache();

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

test("models.dev's rate card prices models the built-in table never listed", (t) => {
  // The gap this closes: the catalogue registers ~198 providers and the
  // built-in table lists 3, so cost reporting, eval spend, and the budget
  // breaker were blind for everything else. models.dev publishes `cost` for
  // ~7000 of its ~7500 models.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-price-"));
  const cacheFile = path.join(dir, "models-dev.json");
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      timestamp: Date.now(),
      data: [
        {
          id: "groq",
          name: "Groq",
          models: [
            {
              id: "llama-3.3-70b",
              name: "Llama 3.3 70B",
              cost: { input: 0.59, output: 0.79 },
            },
          ],
        },
      ],
    }),
  );

  const previous = process.env.FREECODE_MODELS_CACHE_FILE;
  process.env.FREECODE_MODELS_CACHE_FILE = cacheFile;
  resetPricingCache();
  t.after(() => {
    process.env.FREECODE_MODELS_CACHE_FILE = previous;
    resetPricingCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.deepEqual(priceFor("groq", "llama-3.3-70b"), {
    input: 0.59,
    output: 0.79,
    cacheRead: undefined,
    cacheWrite: undefined,
  });
  assert.equal(
    priceUsd("groq", "llama-3.3-70b", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
    0.59 + 0.79,
  );
});

test("a user override still outranks models.dev", (t) => {
  // Precedence is overrides -> models.dev -> built-in. `pricing.json` is the
  // documented way to be exact about a contracted rate, so nothing upstream
  // may displace it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-price-"));
  const cacheFile = path.join(dir, "models-dev.json");
  const overrideFile = path.join(dir, "pricing.json");
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      timestamp: Date.now(),
      data: [
        {
          id: "groq",
          name: "Groq",
          models: [{ id: "m", name: "m", cost: { input: 1, output: 1 } }],
        },
      ],
    }),
  );
  fs.writeFileSync(
    overrideFile,
    JSON.stringify({ "groq/m": { input: 99, output: 99 } }),
  );

  const prevCache = process.env.FREECODE_MODELS_CACHE_FILE;
  const prevPricing = process.env.FREECODE_PRICING_FILE;
  process.env.FREECODE_MODELS_CACHE_FILE = cacheFile;
  process.env.FREECODE_PRICING_FILE = overrideFile;
  resetPricingCache();
  t.after(() => {
    process.env.FREECODE_MODELS_CACHE_FILE = prevCache;
    if (prevPricing === undefined) delete process.env.FREECODE_PRICING_FILE;
    else process.env.FREECODE_PRICING_FILE = prevPricing;
    resetPricingCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(priceFor("groq", "m")?.input, 99);
});

test("a cold models.dev cache falls back to the built-in table", (t) => {
  const prev = process.env.FREECODE_MODELS_CACHE_FILE;
  process.env.FREECODE_MODELS_CACHE_FILE = path.join(
    os.tmpdir(),
    "freecode-definitely-absent-cache.json",
  );
  resetPricingCache();
  t.after(() => {
    process.env.FREECODE_MODELS_CACHE_FILE = prev;
    resetPricingCache();
  });
  assert.notEqual(priceFor("anthropic", "claude-sonnet-4-5"), undefined);
});
