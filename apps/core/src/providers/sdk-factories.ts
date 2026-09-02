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
