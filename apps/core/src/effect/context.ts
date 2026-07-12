// =============================================================================
// Effect Context — Context.Tag declarations for core services (v3 spec DI)
// PRIMARY: Service identifiers resolved through the Effect runtime
// INPUT: none (declarations only)
// OUTPUT: Context.Tags consumed by effect/layers.ts and effect/runtime.ts
// PURPOSE: Single place where the service graph is named. Live/Test wiring
//          lives in effect/layers.ts; composition in effect/runtime.ts.
// =============================================================================

import { Context } from "effect";
import type { HookRuntime } from "../hooks/runtime.js";
import type { ToolOrchestrator } from "../tools/orchestrator.js";
import type { SessionStore } from "../session/store.js";
import type { MemoryService } from "../memory/service.js";
import type { RolloutRecorder } from "../rollout/recorder.js";
import type { AIProvider, ProviderInfo } from "../providers/types.js";
import type { SessionManager } from "../session/manager.js";

// The bus module exports a singleton instance, not its class — type via typeof.
export type BusService = typeof import("../bus/index.js").bus;

// Thin facade over providers/registry.js so consumers depend on an interface,
// not on module-level functions.
export interface ProviderRegistry {
  get(id: string): AIProvider;
  list(): ProviderInfo[];
}

// MemoryService and RolloutRecorder are stateful per-session, so the DI graph
// owns their construction recipe (factory) rather than a single instance.
export interface MemoryFactory {
  forSession(sessionId: string): MemoryService;
}

export interface RecorderFactory {
  forSession(sessionId: string): RolloutRecorder;
}

// =============================================================================
// Context.Tags
// =============================================================================

export class HookRuntimeTag extends Context.Tag("freecode/HookRuntime")<
  HookRuntimeTag,
  HookRuntime
>() {}

export class ToolOrchestratorTag extends Context.Tag(
  "freecode/ToolOrchestrator",
)<ToolOrchestratorTag, ToolOrchestrator>() {}

export class SessionStoreTag extends Context.Tag("freecode/SessionStore")<
  SessionStoreTag,
  SessionStore
>() {}

export class BusTag extends Context.Tag("freecode/Bus")<BusTag, BusService>() {}

export class ProviderRegistryTag extends Context.Tag(
  "freecode/ProviderRegistry",
)<ProviderRegistryTag, ProviderRegistry>() {}

export class MemoryFactoryTag extends Context.Tag("freecode/MemoryFactory")<
  MemoryFactoryTag,
  MemoryFactory
>() {}

export class RecorderFactoryTag extends Context.Tag("freecode/RecorderFactory")<
  RecorderFactoryTag,
  RecorderFactory
>() {}

export class SessionManagerTag extends Context.Tag("freecode/SessionManager")<
  SessionManagerTag,
  SessionManager
>() {}

// Union of everything AppLayerLive provides — the R type of the app runtime.
export type AppServices =
  | HookRuntimeTag
  | ToolOrchestratorTag
  | SessionStoreTag
  | BusTag
  | ProviderRegistryTag
  | MemoryFactoryTag
  | RecorderFactoryTag
  | SessionManagerTag;
