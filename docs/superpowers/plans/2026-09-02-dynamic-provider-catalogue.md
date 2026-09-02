# Dynamic Provider Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/core/src/providers/{anthropic,openai,gemini,minimax,deepseek,zai}.ts` (six near-duplicate provider implementations) with one generic driver fed by a small static provider catalogue, so a provider's identity (id, SDK, baseURL, defaults) has exactly one place to look and cannot silently diverge from what the registry answers to.

**Architecture:** A static `PROVIDER_CATALOGUE` data table (`catalogue.ts`) replaces the six files' hardcoded `PROVIDER_INFO` + SDK-selection logic. A small `SDK_FACTORIES` map (`sdk-factories.ts`) replaces each file's individual `createXxx` import. One `createGenericProvider(entry)` (`generic-provider.ts`) replaces the six files' near-identical `execute`/`stream`/`buildOptions`, branching on the entry's `npm` field (which SDK family) exactly where the six files today implicitly agree or diverge — this is not model-listing logic (that's `models-dev.ts`, already fixed, untouched here); it's provider *construction*.

**Tech Stack:** TypeScript, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/deepseek`, `@ai-sdk/google`), `node:test` (repo's existing test runner — see `utils.test.ts` for the pattern).

**Spec:** `docs/superpowers/specs/2026-09-02-dynamic-provider-catalogue-design.md`

## Global Constraints

- **No live models.dev fetch for provider construction.** The design doc floated a live-fetch-with-static-fallback approach; this plan drops the live fetch entirely for the registry. All 9 existing `getProvider()`/`initProviders()` call sites treat provider construction as synchronous (`server.ts:589`, `agent/loop.ts:1158,1850`, `agent/redirect/supervisor.ts:95`, `tools/agent.ts:107`, `hooks/executors/prompt.ts:43`, `effect/layers.ts:69,171`, `memory/{extract,consolidate,judge}.ts`, `eval/scorers/judge.ts`) — a static table preserves that contract with zero call-site changes and zero new failure mode (an unreachable models.dev at startup). `models-dev.ts`'s live fetch stays exactly as-is; it drives the `/model` picker's model *list*, not provider *construction*, and its own id-mismatch bug was already fixed 2026-09-02.
- **Catalogue values come from the current six files, not from models.dev's raw catalogue.** Verified during planning: `zai.ts` and `deepseek.ts` diverge from what `models.dev/api.json` reports for `zai`/`deepseek` (models.dev lists `zai` as `@ai-sdk/openai-compatible` against `https://api.z.ai/api/paas/v4`; freecode's `zai.ts` deliberately uses `@ai-sdk/anthropic` against `https://api.z.ai/api/anthropic` — a different endpoint and SDK, presumably chosen for tool-call fidelity. Likewise `deepseek.ts` uses the dedicated `@ai-sdk/deepseek` package, not `@ai-sdk/openai-compatible`). Copying models.dev's raw fields would silently change which endpoint/SDK three providers use. The catalogue table's `npm`/`baseURL` values must be transcribed from the current six files, never from a fresh models.dev fetch.
- **SDK imports stay static, not dynamic.** opencode dynamically `import()`s SDK packages because it bundles dozens of them and wants lazy loading. freecode uses exactly four SDK packages across all six providers, all already eagerly imported today. `sdk-factories.ts` imports all four statically — no bundle-size problem to solve, and it avoids turning `registerProvider`'s `create()` async.
- **Canonical provider id is freecode's existing id**, not models.dev's (`"gemini"`, not `"google"`) — this is what the catalogue table already encodes by construction (its rows are transcribed from the six files' existing `PROVIDER_INFO.id` values), so there is no remap step needed inside this subsystem.
- Every existing provider test must keep passing unchanged: `utils.test.ts`, `streaming.test.ts`, `provider-shared.test.ts`, `cache-awareness.test.ts`, `cache-miss.test.ts`, `multimodal.test.ts`, `openai-cache-key.test.ts`, `output-cap.test.ts`, `auxiliary-calls.test.ts`, `pricing.test.ts` — they test the shared utils being reused, not the six files being deleted.
- Do not commit anything (per explicit user instruction carried over from the design phase). Every task ends with a `git add`+`git commit` step per the plan template below for when the user later resumes work normally — but for **this** run, skip the commit steps and stop after verifying tests pass, leaving changes uncommitted. (Flagged again at the end of this document.)

---

## Task 1: Provider catalogue data table

**Files:**
- Create: `apps/core/src/providers/catalogue.ts`
- Test: `apps/core/src/providers/catalogue.test.ts`

**Interfaces:**
- Produces: `ProviderCatalogueEntry` type, `PROVIDER_CATALOGUE: ProviderCatalogueEntry[]` — consumed by Task 3 (`generic-provider.ts`) and Task 4 (`registry.ts` wiring).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/core/src/providers/catalogue.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_CATALOGUE } from "./catalogue.js";

test("catalogue has exactly the six known metered providers, each with a unique id", () => {
  const ids = PROVIDER_CATALOGUE.map((e) => e.id);
  assert.deepEqual(
    [...ids].sort(),
    ["anthropic", "deepseek", "gemini", "minimax", "openai", "zai"],
  );
  assert.equal(new Set(ids).size, ids.length);
});

test("every entry has a non-empty defaultModel and a supported npm family", () => {
  const known = new Set([
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/deepseek",
    "@ai-sdk/google",
  ]);
  for (const entry of PROVIDER_CATALOGUE) {
    assert.ok(entry.defaultModel.length > 0, `${entry.id} has a defaultModel`);
    assert.ok(known.has(entry.npm), `${entry.id} has a known npm family`);
  }
});

test("only minimax and zai carry a custom baseURL", () => {
  const withBaseUrl = PROVIDER_CATALOGUE.filter((e) => e.baseURL).map((e) => e.id);
  assert.deepEqual(withBaseUrl.sort(), ["minimax", "zai"]);
});

test("effortFamily is set only for anthropic, openai, and gemini", () => {
  const withEffort = PROVIDER_CATALOGUE.filter((e) => e.effortFamily).map((e) => e.id);
  assert.deepEqual(withEffort.sort(), ["anthropic", "gemini", "openai"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx tsx --test src/providers/catalogue.test.ts`
Expected: FAIL — `catalogue.ts` does not exist yet (module not found).

- [ ] **Step 3: Write the catalogue**

Transcribed from the current `PROVIDER_INFO` blocks and SDK-construction calls in `anthropic.ts`, `openai.ts`, `gemini.ts`, `minimax.ts`, `deepseek.ts`, `zai.ts` — values must match those files exactly, not models.dev's published data (see Global Constraints).

```typescript
// apps/core/src/providers/catalogue.ts
import type { EffortFamily } from "./generic-provider.js";

export interface ProviderCatalogueEntry {
  id: string;
  name: string;
  npm: "@ai-sdk/anthropic" | "@ai-sdk/openai" | "@ai-sdk/deepseek" | "@ai-sdk/google";
  /** Custom endpoint. Undefined uses the SDK's own default. */
  baseURL?: string;
  defaultModel: string;
  maxOutputTokens: number;
  /**
   * Which `applyEffort()` branch this provider uses, if any. Undefined means
   * effort is not routed for this provider — matches today's behavior:
   * minimax/deepseek/zai never call `applyEffort` even though minimax/zai
   * share the anthropic SDK family with `anthropic` itself.
   */
  effortFamily?: EffortFamily;
}

export const PROVIDER_CATALOGUE: ProviderCatalogueEntry[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    defaultModel: "claude-sonnet-4-5",
    maxOutputTokens: 4096,
    effortFamily: "anthropic",
  },
  {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    defaultModel: "gpt-4o",
    maxOutputTokens: 4096,
    effortFamily: "openai",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    npm: "@ai-sdk/google",
    // Verified against the live API 2026-08-29: `gemini-2.0-flash` returns "no
    // longer available" outright and `gemini-2.5-flash` "no longer available to
    // new users", both pointing here. A retired default is not a soft failure —
    // it breaks the provider for anyone who does not name a model.
    defaultModel: "gemini-3.6-flash",
    maxOutputTokens: 4096,
    effortFamily: "gemini",
  },
  {
    id: "minimax",
    name: "MiniMax",
    // MiniMax exposes an Anthropic Messages-compatible endpoint, so this
    // reuses @ai-sdk/anthropic with a custom baseURL instead of hand-rolling
    // a client (matches anthropic itself).
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.minimax.io/anthropic/v1",
    defaultModel: "MiniMax-M2",
    // The old 4096 default truncated large tool calls (e.g. a `write` with a
    // long body) mid-JSON, which the AI SDK then surfaced as an unparseable
    // tool call. The endpoint's own ceilings are far higher — 524288 for
    // MiniMax-M3, 196608 for MiniMax-M2 — so this only needs to be large
    // enough for a full file write in one call. It was 65536, but MiniMax
    // charges max_tokens against the same context window, so that reserved a
    // third of M2's 196608 and forced auto-compaction to fire at 60%
    // occupancy. 32000 (utils.ts's OUTPUT_TOKEN_CAP) keeps the write headroom
    // while giving the rest of the window back to the conversation.
    maxOutputTokens: 32_000,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    npm: "@ai-sdk/deepseek",
    defaultModel: "deepseek-chat",
    maxOutputTokens: 4096,
  },
  {
    id: "zai",
    name: "Z.ai (GLM)",
    // z.ai (GLM) exposes an Anthropic Messages-compatible endpoint, so this
    // reuses @ai-sdk/anthropic with a custom baseURL instead of a new SDK
    // dependency (same approach as minimax).
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.z.ai/api/anthropic",
    defaultModel: "glm-5.2",
    maxOutputTokens: 4096,
  },
];
```

Note: `minimax.ts` today imports `OUTPUT_TOKEN_CAP` from `utils.ts` and assigns it to a local `MAX_OUTPUT_TOKENS` constant that is also `32_000` — this plan inlines the literal `32_000` in the data table rather than importing `OUTPUT_TOKEN_CAP` here, to keep `catalogue.ts` free of behavioral imports (pure data). Confirm `utils.ts:415`'s `OUTPUT_TOKEN_CAP` is still `32_000` before transcribing (Step 3 sub-check): `grep -n "OUTPUT_TOKEN_CAP = " apps/core/src/providers/utils.ts` — if it has changed, use the current value instead of `32_000`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core && npx tsx --test src/providers/catalogue.test.ts`
Expected: PASS (all 4 tests). Note this step forward-references `EffortFamily` from `generic-provider.ts` (Task 3) purely as a type import — TypeScript type-only imports don't require the module to exist for `node:test` + `tsx` to run this file in isolation, but if the project's test runner resolves imports strictly, do Task 3 first and come back, or inline `effortFamily?: "anthropic" | "openai" | "gemini"` directly in this file instead of importing `EffortFamily` and skip the Task-3 type import (simpler — do this instead, it removes the ordering dependency):

```typescript
// Replace the top import line with:
export type EffortFamily = "anthropic" | "openai" | "gemini";
```

and drop the `import type { EffortFamily } from "./generic-provider.js";` line. `generic-provider.ts` (Task 3) will instead `import type { EffortFamily } from "./catalogue.js";` — catalogue is the data owner, generic-provider consumes it. Re-run Step 4 after this correction.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/providers/catalogue.ts apps/core/src/providers/catalogue.test.ts
git commit -m "feat(providers): add static provider catalogue table"
```

---

## Task 2: SDK factory map

**Files:**
- Create: `apps/core/src/providers/sdk-factories.ts`
- Test: `apps/core/src/providers/sdk-factories.test.ts`

**Interfaces:**
- Consumes: nothing new (statically imports the four AI SDK packages already used by the six files being deleted).
- Produces: `SDK_FACTORIES: Record<SdkFamily, SdkFactory>` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/core/src/providers/sdk-factories.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SDK_FACTORIES } from "./sdk-factories.js";

test("has a factory for every SDK family the catalogue uses", () => {
  for (const family of [
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/deepseek",
    "@ai-sdk/google",
  ] as const) {
    assert.equal(typeof SDK_FACTORIES[family], "function", family);
  }
});

test("anthropic factory builds a callable model provider", () => {
  const sdk = SDK_FACTORIES["@ai-sdk/anthropic"]({ apiKey: "test-key" });
  assert.equal(typeof sdk, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx tsx --test src/providers/sdk-factories.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the factory map**

```typescript
// apps/core/src/providers/sdk-factories.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type SdkFamily =
  | "@ai-sdk/anthropic"
  | "@ai-sdk/openai"
  | "@ai-sdk/deepseek"
  | "@ai-sdk/google";

export interface SdkFactoryOptions {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

export type SdkFactory = (opts: SdkFactoryOptions) => unknown;

// Every one of freecode's six providers uses one of these four AI SDK
// packages, and all four are already eager-imported today (one per provider
// file). Kept as static imports rather than opencode's dynamic-import
// BUNDLED_PROVIDERS map — that pattern exists there to lazy-load dozens of
// SDKs; freecode has four, already always loaded, so dynamic import would
// only turn `registerProvider`'s synchronous `create()` async for no benefit.
export const SDK_FACTORIES: Record<SdkFamily, SdkFactory> = {
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/deepseek": createDeepSeek,
  "@ai-sdk/google": createGoogleGenerativeAI,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core && npx tsx --test src/providers/sdk-factories.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/providers/sdk-factories.ts apps/core/src/providers/sdk-factories.test.ts
git commit -m "feat(providers): add static SDK factory map"
```

---

## Task 3: Generic provider driver

This is the core of the plan: one `createGenericProvider` replacing six copies of `execute`/`stream`/`buildOptions`. Branches on `entry.npm` exactly where the six files today implicitly agree (anthropic-family: `minimax`, `zai`, `anthropic` all call `buildAnthropicSystemParam` + `applyMessageCaching`) or diverge (only `openai.ts` sets `promptCacheKey`; only `gemini.ts` calls `.languageModel(model)` instead of calling the SDK instance directly; `effortFamily` is set only for `anthropic`/`openai`/`gemini`).

One additional, deliberate normalization over the six files: `echoedModel: result.response?.modelId` is included unconditionally. Today `zai.ts` and `deepseek.ts` omit this field while the other four include it — per `types.ts`'s own doc comment ("Undefined means the provider did not say — never assume it matches"), this is an oversight in those two files, not an intentional difference, so unifying it is a bugfix riding along with the consolidation, not new scope. Flagged here so a reviewer can see it's deliberate.

**Files:**
- Create: `apps/core/src/providers/generic-provider.ts`
- Test: `apps/core/src/providers/generic-provider.test.ts`

**Interfaces:**
- Consumes: `ProviderCatalogueEntry` (Task 1, but see Task 1 Step 4 correction — `EffortFamily` is defined in `catalogue.ts`), `SDK_FACTORIES`/`SdkFactory` (Task 2), and from `types.ts`: `AIProvider`, `ExecuteOptions`, `ExecuteResult`, `ProviderChunk`, `ExecuteUsage`; from `config.ts`: `getApiKey`; from `fetch-timeout.ts`: `createTimeoutFetch`; from `utils.ts`: `convertToCoreMessages`, `buildAnthropicSystemParam`, `buildToolsParam`, `applyMessageCaching`, `resolveModel`, `PROVIDER_MAX_RETRIES`, `silenceStreamErrors`; from `streaming.ts`: `normalizeAiSdkStream`; from `provider-shared.ts`: `mapUsage`; from `effort.ts`: `applyEffort` (re-keyed — see Step 3b below).
- Produces: `createGenericProvider(entry: ProviderCatalogueEntry): AIProvider`, and the pure `buildGenerateOptions(entry, modelHandle, opts)` helper (exported for the test in this task) — consumed by Task 4 (`registry.ts`).

- [ ] **Step 1: Write the failing test**

Tests the pure request-shape builder (`buildGenerateOptions`) without hitting the network, mirroring the shape each of the six files currently produces. `modelHandle` is a plain sentinel object since only its identity, not its behavior, is asserted here.

```typescript
// apps/core/src/providers/generic-provider.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGenerateOptions } from "./generic-provider.js";
import type { ProviderCatalogueEntry } from "./catalogue.js";

const modelHandle = { __model: true };

const anthropicEntry: ProviderCatalogueEntry = {
  id: "anthropic",
  name: "Anthropic",
  npm: "@ai-sdk/anthropic",
  defaultModel: "claude-sonnet-4-5",
  maxOutputTokens: 4096,
  effortFamily: "anthropic",
};

const openaiEntry: ProviderCatalogueEntry = {
  id: "openai",
  name: "OpenAI",
  npm: "@ai-sdk/openai",
  defaultModel: "gpt-4o",
  maxOutputTokens: 4096,
  effortFamily: "openai",
};

const geminiEntry: ProviderCatalogueEntry = {
  id: "gemini",
  name: "Google Gemini",
  npm: "@ai-sdk/google",
  defaultModel: "gemini-3.6-flash",
  maxOutputTokens: 4096,
  effortFamily: "gemini",
};

const minimaxEntry: ProviderCatalogueEntry = {
  id: "minimax",
  name: "MiniMax",
  npm: "@ai-sdk/anthropic",
  baseURL: "https://api.minimax.io/anthropic/v1",
  defaultModel: "MiniMax-M2",
  maxOutputTokens: 32_000,
};

test("anthropic-family: system goes through buildAnthropicSystemParam, messages get cache breakpoints", () => {
  const opts = buildGenerateOptions(anthropicEntry, modelHandle, {
    system: "be helpful",
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] as any,
  });
  assert.equal(opts.model, modelHandle);
  assert.ok(Array.isArray(opts.system) || typeof opts.system === "object");
  assert.ok(Array.isArray(opts.messages));
});

test("minimax (anthropic npm family, no effortFamily): effort is never applied", () => {
  const opts = buildGenerateOptions(minimaxEntry, modelHandle, {
    prompt: "hi",
    effort: "high",
  });
  assert.equal(opts.providerOptions, undefined);
});

test("anthropic (effortFamily set): effort is routed under providerOptions.anthropic", () => {
  const opts = buildGenerateOptions(anthropicEntry, modelHandle, {
    prompt: "hi",
    effort: "high",
  });
  assert.deepEqual((opts.providerOptions as any).anthropic, { effort: "high" });
});

test("openai: sessionId sets providerOptions.openai.promptCacheKey", () => {
  const opts = buildGenerateOptions(openaiEntry, modelHandle, {
    prompt: "hi",
    sessionId: "sess-123",
  });
  assert.equal((opts.providerOptions as any).openai.promptCacheKey, "sess-123");
});

test("openai: system is flattened to a plain string, not the anthropic block form", () => {
  const opts = buildGenerateOptions(openaiEntry, modelHandle, {
    system: [{ text: "one" }, { text: "two" }],
  } as any);
  assert.equal(opts.system, "one\n\ntwo");
});

test("gemini: xhigh effort clamps to high thinkingLevel", () => {
  const opts = buildGenerateOptions(geminiEntry, modelHandle, {
    prompt: "hi",
    effort: "xhigh",
  });
  assert.deepEqual((opts.providerOptions as any).google, {
    thinkingConfig: { thinkingLevel: "high" },
  });
});

test("maxOutputTokens: caller override wins over catalogue default", () => {
  const opts = buildGenerateOptions(minimaxEntry, modelHandle, {
    prompt: "hi",
    maxTokens: 9000,
  });
  assert.equal(opts.maxOutputTokens, 9000);
});

test("maxOutputTokens: falls back to the catalogue entry's value", () => {
  const opts = buildGenerateOptions(minimaxEntry, modelHandle, { prompt: "hi" });
  assert.equal(opts.maxOutputTokens, 32_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx tsx --test src/providers/generic-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Write the generic provider driver**

```typescript
// apps/core/src/providers/generic-provider.ts
import { generateText, streamText } from "ai";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ExecuteUsage,
  ProviderChunk,
} from "./types.js";
import { getApiKey } from "./config.js";
import { createTimeoutFetch } from "./fetch-timeout.js";
import {
  convertToCoreMessages,
  buildAnthropicSystemParam,
  buildToolsParam,
  applyMessageCaching,
  resolveModel,
  PROVIDER_MAX_RETRIES,
  silenceStreamErrors,
} from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";
import { mapUsage } from "./provider-shared.js";
import { applyEffort } from "./effort.js";
import { SDK_FACTORIES } from "./sdk-factories.js";
import type { ProviderCatalogueEntry } from "./catalogue.js";

/**
 * Assembles the AI SDK request options for one call, branching on the
 * catalogue entry's SDK family exactly where the six now-deleted provider
 * files implicitly agreed or diverged:
 *
 * - anthropic-family (`anthropic`, `minimax`, `zai` — all `@ai-sdk/anthropic`,
 *   `minimax`/`zai` against a custom baseURL): system via
 *   `buildAnthropicSystemParam`, messages get cache breakpoints via
 *   `applyMessageCaching`.
 * - `@ai-sdk/openai`: system flattened to a plain string; a `sessionId`
 *   caller hint sets `providerOptions.openai.promptCacheKey` for cache
 *   routing (openai only — this was never set for deepseek/minimax/zai).
 * - `@ai-sdk/deepseek` / `@ai-sdk/google`: system flattened to a plain
 *   string; no cache-key routing.
 *
 * `effortFamily` gates `applyEffort` exactly as the six files did — set only
 * for the `anthropic`/`openai`/`gemini` catalogue entries, never for
 * `minimax`/`deepseek`/`zai` even though `minimax`/`zai` share the anthropic
 * SDK family.
 */
export function buildGenerateOptions(
  entry: ProviderCatalogueEntry,
  modelHandle: unknown,
  opts: ExecuteOptions,
): any {
  const tools = buildToolsParam(opts.tools);
  const generateOptions: any = {
    model: modelHandle,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxTokens || entry.maxOutputTokens,
    tools: tools as any,
    abortSignal: opts.abortSignal,
    maxRetries: PROVIDER_MAX_RETRIES,
  };

  if (entry.npm === "@ai-sdk/anthropic") {
    if (opts.system) {
      generateOptions.system = buildAnthropicSystemParam(opts.system);
    }
    if (opts.messages) {
      const coreMessages = convertToCoreMessages(opts.messages);
      applyMessageCaching(coreMessages);
      generateOptions.messages = coreMessages;
    } else {
      generateOptions.prompt = opts.prompt;
    }
  } else {
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system?.map((b) => b.text).join("\n\n");
    generateOptions.system = systemPrompt;
    if (opts.messages) {
      generateOptions.messages = convertToCoreMessages(opts.messages);
    } else {
      generateOptions.prompt = opts.prompt;
    }
    if (entry.npm === "@ai-sdk/openai" && opts.sessionId) {
      generateOptions.providerOptions = {
        openai: { promptCacheKey: opts.sessionId },
      };
    }
  }

  if (entry.effortFamily) {
    applyEffort(generateOptions, entry.effortFamily, opts.effort);
  }

  return generateOptions;
}

export function createGenericProvider(entry: ProviderCatalogueEntry): AIProvider {
  const factory = SDK_FACTORIES[entry.npm];
  const sdk: any = factory({
    apiKey: getApiKey(entry.id),
    baseURL: entry.baseURL,
    fetch: createTimeoutFetch(),
  });

  // @ai-sdk/google's provider object is called via `.languageModel(id)`
  // rather than as a callable — matches `gemini.ts`'s existing
  // `gemini.languageModel(model)` (not `gemini(model)`).
  function modelHandle(model: string): unknown {
    return entry.npm === "@ai-sdk/google" ? sdk.languageModel(model) : sdk(model);
  }

  const info = {
    id: entry.id,
    name: entry.name,
    defaultModel: entry.defaultModel,
    supportsStreaming: true,
    supportsTools: true,
    maxOutputTokens: entry.maxOutputTokens,
  };

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = resolveModel(
      opts.model,
      entry.id,
      entry.defaultModel,
      !opts.quietModelFallback,
    );
    const generateOptions = buildGenerateOptions(entry, modelHandle(model), opts);
    const result = await generateText(generateOptions);

    const toolCalls = result.toolCalls?.map(
      (tc): { name: string; args: Record<string, unknown>; id: string } => {
        const input = (tc as unknown as { input: Record<string, unknown> }).input;
        return { name: tc.toolName, args: input, id: tc.toolCallId };
      },
    );

    const usage: ExecuteUsage | undefined = result.usage
      ? mapUsage(result.usage, result.providerMetadata) ?? undefined
      : undefined;

    return {
      content: result.text || "",
      thinking: undefined,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage,
      stopReason:
        result.finishReason === "tool-calls"
          ? "tool_use"
          : result.finishReason === "length"
            ? "max_tokens"
            : "stop",
      provider: entry.id,
      model,
      echoedModel: result.response?.modelId,
    };
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    const model = resolveModel(
      opts.model,
      entry.id,
      entry.defaultModel,
      !opts.quietModelFallback,
    );
    const generateOptions = buildGenerateOptions(entry, modelHandle(model), opts);
    const result = streamText({ ...generateOptions, onError: silenceStreamErrors });
    yield* normalizeAiSdkStream(
      result.fullStream as unknown as AsyncIterable<{ type: string } & Record<string, unknown>>,
    );
  }

  return { info, execute, stream };
}
```

- [ ] **Step 3b: Re-key `effort.ts` from provider id to SDK family**

`effort.ts` currently switches on the literal provider id (`"anthropic" | "openai" | "gemini"`), which happened to work because those three ids equal their own SDK family names. The generic driver calls `applyEffort(generateOptions, entry.effortFamily, opts.effort)` — `entry.effortFamily` is typed `"anthropic" | "openai" | "gemini"` (see Task 1 Step 4's correction: `EffortFamily` is exported from `catalogue.ts`), which is exactly `effort.ts`'s existing parameter type. **No change needed to `effort.ts` itself** — confirm its signature still reads `providerId: "anthropic" | "openai" | "gemini"` and rename that parameter to `family` for clarity only if touching the file; behavior is identical either way. Do not widen it to accept `minimax`/`deepseek`/`zai` — those must keep going through the `if (entry.effortFamily)` guard in `generic-provider.ts`, never calling `applyEffort` at all, matching current behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core && npx tsx --test src/providers/generic-provider.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the full existing provider test suite to check for regressions**

Run: `cd apps/core && npx tsx --test src/providers/*.test.ts`
Expected: PASS — this file only adds new tests and new modules; nothing existing is modified yet (Task 4 does the deletion/wiring).

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/providers/generic-provider.ts apps/core/src/providers/generic-provider.test.ts
git commit -m "feat(providers): add generic provider driver built from the catalogue"
```

---

## Task 4: Wire the registry to the catalogue and delete the six provider files

**Files:**
- Modify: `apps/core/src/providers/registry.ts:54-70` (`initProviders`)
- Delete: `apps/core/src/providers/anthropic.ts`
- Delete: `apps/core/src/providers/openai.ts`
- Delete: `apps/core/src/providers/gemini.ts`
- Delete: `apps/core/src/providers/minimax.ts`
- Delete: `apps/core/src/providers/deepseek.ts`
- Delete: `apps/core/src/providers/zai.ts`
- Test: `apps/core/src/providers/registry.test.ts` (new — no existing test file covers `initProviders`/`getProvider` end-to-end today; verify with `ls apps/core/src/providers/registry.test.ts` before writing, in case one was added since this plan was written)

**Interfaces:**
- Consumes: `PROVIDER_CATALOGUE` (Task 1), `createGenericProvider` (Task 3).
- Produces: nothing new — `registerProvider`/`getProvider`/`listProviders`/`allowsAuxiliaryCalls`/`providerRequiresApiKey`/`initProviders` keep their existing exported signatures from `registry.ts`, so none of the 9 call sites listed in Global Constraints change.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/core/src/providers/registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { initProviders, getProvider, listProviders } from "./registry.js";

test("initProviders registers all six catalogue providers plus gemini-web", async () => {
  await initProviders();
  const ids = listProviders().map((p) => p.id).sort();
  assert.deepEqual(ids, [
    "anthropic",
    "deepseek",
    "gemini",
    "gemini-web",
    "minimax",
    "openai",
    "zai",
  ]);
});

test("getProvider('gemini') resolves without throwing 'not registered'", async () => {
  await initProviders();
  const provider = getProvider("gemini" as any);
  assert.equal(provider.info.id, "gemini");
  assert.equal(typeof provider.execute, "function");
});

test("getProvider('google') still throws — catalogue ids are freecode's own, not models.dev's raw id", async () => {
  await initProviders();
  assert.throws(() => getProvider("google" as any), /not registered/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx tsx --test src/providers/registry.test.ts`
Expected: FAIL — `registry.ts` still imports the six deleted-in-this-task files; nothing wired to the catalogue yet, so this fails at the current `initProviders` implementation (still passes today's ids, which is fine — but confirms the test file runs before the real change; if it unexpectedly passes because ids already match, proceed to Step 3 anyway since the point of this task is removing the six files, not just the id list).

- [ ] **Step 3: Rewrite `initProviders`**

```typescript
// apps/core/src/providers/registry.ts — replace initProviders (lines 54-70)
export async function initProviders(): Promise<void> {
  const { PROVIDER_CATALOGUE } = await import("./catalogue.js");
  const { createGenericProvider } = await import("./generic-provider.js");
  for (const entry of PROVIDER_CATALOGUE) {
    registerProvider(entry.id, {
      info: {
        id: entry.id,
        name: entry.name,
        defaultModel: entry.defaultModel,
        supportsStreaming: true,
        supportsTools: true,
        maxOutputTokens: entry.maxOutputTokens,
      },
      create: () => createGenericProvider(entry),
    });
  }
  // Ask/review over a logged-in Gemini web session (see gemini-web/index.ts).
  // Not in models.dev's catalogue and never will be — registration is
  // metadata-only and the sidecar is only contacted on first use, so a
  // provider nobody selects costs one module import at startup.
  await import("./gemini-web/index.js");
}
```

Kept as dynamic `import()` here (not static top-of-file imports) deliberately — this matches the *existing* `initProviders` implementation's own pattern (it already dynamically imports all six provider files plus `gemini-web/index.js` today, per the file's current comment "Providers self-register via side effect when imported"), so this is not a new async pattern, just the same one now pointed at two new modules instead of six old ones plus one unchanged one.

- [ ] **Step 4: Delete the six provider files**

```bash
rm apps/core/src/providers/anthropic.ts
rm apps/core/src/providers/openai.ts
rm apps/core/src/providers/gemini.ts
rm apps/core/src/providers/minimax.ts
rm apps/core/src/providers/deepseek.ts
rm apps/core/src/providers/zai.ts
```

- [ ] **Step 5: Grep for any other reference to the deleted files**

Run: `cd apps/core && grep -rn "providers/anthropic\|providers/openai\|providers/gemini\.\|providers/minimax\|providers/deepseek\|providers/zai" src --include=*.ts | grep -v gemini-web`
Expected: no output. If anything shows up (e.g. a stray import elsewhere), fix it before proceeding — do not leave a dangling import.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/core && npx tsx --test src/providers/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full provider test suite**

Run: `cd apps/core && npx tsx --test src/providers/*.test.ts`
Expected: PASS — every pre-existing test (`utils.test.ts`, `streaming.test.ts`, `provider-shared.test.ts`, `cache-awareness.test.ts`, `cache-miss.test.ts`, `multimodal.test.ts`, `openai-cache-key.test.ts`, `output-cap.test.ts`, `auxiliary-calls.test.ts`, `pricing.test.ts`) plus the four new files from Tasks 1-4.

- [ ] **Step 8: Run the full core test suite**

Run: `cd apps/core && npx tsx --test src/**/*.test.ts` (or the project's normal test command, e.g. `pnpm --filter @thisisayande/freecode-core test` — check `apps/core/package.json`'s `scripts.test` first and use that instead if it differs)
Expected: PASS. This is the real regression check — it exercises everything downstream of `getProvider`/`initProviders` (agent loop tests, memory tests, eval scorer tests) against the new generic driver.

- [ ] **Step 9: Type-check**

Run: `cd apps/core && npx tsc --noEmit` (or `pnpm --filter @thisisayande/freecode-core typecheck` if that script exists — check `package.json`)
Expected: no errors. This catches any remaining `ProviderId`-typed reference to the deleted files' exports (there shouldn't be any — the six files never exported anything besides their side-effecting `registerProvider` call — but confirm).

- [ ] **Step 10: Manual verification — `/model` picker end to end**

Per the design doc's testing section, this is the flow the original bug broke. Build and run:

```bash
pnpm build:bun
./dist/freecode-bun
```

In the running TUI, run `/model`, and for each of `anthropic`, `openai`, `gemini`, `minimax`, `deepseek`, `zai`: select it, pick a model, send a one-line prompt, confirm a response comes back with no `not registered` error. Then check `gemini-web` still appears in the picker (it's not in the catalogue — confirms Step 3's `gemini-web/index.js` import still runs).

- [ ] **Step 11: Commit**

```bash
git add apps/core/src/providers/registry.ts apps/core/src/providers/registry.test.ts
git add -u apps/core/src/providers/anthropic.ts apps/core/src/providers/openai.ts apps/core/src/providers/gemini.ts apps/core/src/providers/minimax.ts apps/core/src/providers/deepseek.ts apps/core/src/providers/zai.ts
git commit -m "refactor(providers): build the registry from the catalogue, delete the six hardcoded provider files"
```

---

## Self-Review Notes (for whoever executes this plan)

1. **Spec coverage:** Task 1 covers the design's "New: `providers/catalogue.ts`" section (minus the live-fetch part, deliberately dropped per Global Constraints — the design doc flagged this as an open question and planning resolved it toward the static table). Task 2 covers "New: `providers/sdk-factories.ts`" (trimmed to freecode's actual 4 SDKs, and made static rather than dynamic-import — a deviation from the design doc's opencode-mirroring pseudocode, justified in Global Constraints). Task 3 covers "New: `providers/generic-provider.ts`". Task 4 covers "`registry.ts` — Unchanged interface" and "Deleted" sections. The design doc's "Canonical id" section resolved to option B (keep freecode's ids) — reflected by the catalogue simply using freecode's existing ids directly, no remap table needed inside this subsystem.
2. **Divergence from the design doc, corrected during planning:** the design doc's `CANONICAL_ID`/`DEFAULT_MODEL`/`PROVIDER_POLICY` sketch assumed models.dev's raw `npm`/`api` fields were usable as-is for `minimax`/`deepseek`/`zai`. Verified false during planning (see Global Constraints) — `zai` and `deepseek` use different SDK packages/endpoints than models.dev's own catalogue reports. The catalogue in this plan transcribes the *current file contents*, not a fresh models.dev fetch, closing that gap.
3. **Type consistency check:** `EffortFamily` is defined once, in `catalogue.ts` (Task 1 Step 4 correction), and imported by `generic-provider.ts` (Task 3) — not the reverse, avoiding the circular-import risk in the design doc's original sketch (which had `catalogue.ts` importing from a would-be `generic-provider.ts` type).
4. **Not committing:** the user asked not to commit anything for this task. Every task above still lists its own `git add`/`git commit` step per the plan template — for the actual execution of this plan right now, **skip every Step marked "Commit"** and stop after Task 4 Step 10's manual verification, leaving all changes staged-or-not as they land, uncommitted. If executing via `subagent-driven-development`, tell each task's subagent explicitly to skip its commit step.
