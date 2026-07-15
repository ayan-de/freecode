// =============================================================================
// Effect Layers — Live and Test wiring for the core service graph (v3 spec DI)
// PRIMARY: Layer definitions for every Context.Tag in effect/context.ts
// INPUT: existing service constructors (hooks, tools, session, memory, ...)
// OUTPUT: AppLayerLive (production graph), makeTestLayer() (test graph)
// PURPOSE: Composition root. Consumers resolve services through the runtime
//          (effect/runtime.ts) instead of importing module singletons.
// =============================================================================

import { Layer, Effect } from "effect";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { mkdtempSync } from "fs";
import { getHookRuntime, type HookRuntime } from "../hooks/runtime.js";
import {
  createToolOrchestrator,
  type ToolOrchestrator,
} from "../tools/orchestrator.js";
import { createSessionStore, type SessionStore } from "../session/store.js";
import { bus } from "../bus/index.js";
import { MemoryService } from "../compaction/service.js";
import type { MemoryState } from "../compaction/types.js";
import { createRecorder } from "../rollout/recorder.js";
import { getProvider, listProviders } from "../providers/registry.js";
import type { ProviderId } from "../providers/config.js";
import { createSessionManager } from "../session/manager.js";
import {
  createRecoveryManager,
  createRecoveryManagerFromConfig,
  type RecoveryManager,
} from "../agent/recovery/manager.js";
import {
  HookRuntimeTag,
  ToolOrchestratorTag,
  SessionStoreTag,
  BusTag,
  ProviderRegistryTag,
  MemoryFactoryTag,
  RecorderFactoryTag,
  SessionManagerTag,
  RecoveryManagerTag,
  type MemoryFactory,
  type RecorderFactory,
  type ProviderRegistry,
} from "./context.js";

// Re-export: the loop-health evaluator lived here before this file became the
// Layer wiring module. Keep the old import path working.
export {
  createLoopHealthEvaluator,
  type LoopHealthEvaluator,
} from "./loop-health.js";

// =============================================================================
// Live Layers — production wiring
// =============================================================================

export const HookRuntimeLive = Layer.sync(HookRuntimeTag, () =>
  getHookRuntime(),
);

export const ToolOrchestratorLive = Layer.sync(ToolOrchestratorTag, () =>
  createToolOrchestrator(),
);

export const BusLive = Layer.succeed(BusTag, bus);

export const ProviderRegistryLive = Layer.succeed(ProviderRegistryTag, {
  get: (id: string) => getProvider(id as ProviderId),
  list: () => listProviders(),
} satisfies ProviderRegistry);

const SESSION_BASE_DIR = join(homedir(), ".freecode");

export const SessionStoreLive = Layer.effect(
  SessionStoreTag,
  Effect.promise(() => createSessionStore(SESSION_BASE_DIR)),
);

// Memory is constructed per session with the DI-provided hook runtime, so a
// test graph automatically propagates its mock hooks into memory compaction.
export const MemoryFactoryLive = Layer.effect(
  MemoryFactoryTag,
  Effect.map(
    HookRuntimeTag,
    (hooks): MemoryFactory => ({
      forSession: (sessionId) => new MemoryService(sessionId, { hooks }),
    }),
  ),
).pipe(Layer.provide(HookRuntimeLive));

export const RecorderFactoryLive = Layer.succeed(RecorderFactoryTag, {
  forSession: (sessionId: string) => createRecorder(sessionId),
} satisfies RecorderFactory);

export const SessionManagerLive = Layer.effect(
  SessionManagerTag,
  Effect.map(SessionStoreTag, (store) => createSessionManager(store)),
).pipe(Layer.provide(SessionStoreLive));

export const RecoveryManagerLive = Layer.sync(RecoveryManagerTag, () =>
  createRecoveryManagerFromConfig(),
);

// Full production graph. Layers are memoized by reference, so SessionStoreLive
// and HookRuntimeLive build exactly once even though they appear twice.
export const AppLayerLive = Layer.mergeAll(
  HookRuntimeLive,
  ToolOrchestratorLive,
  BusLive,
  ProviderRegistryLive,
  SessionStoreLive,
  MemoryFactoryLive,
  RecorderFactoryLive,
  SessionManagerLive,
  RecoveryManagerLive,
);

// =============================================================================
// Test Layers — in-memory / no-side-effect wiring with per-service overrides
// =============================================================================

export interface TestLayerOverrides {
  hooks?: HookRuntime;
  orchestrator?: ToolOrchestrator;
  sessionStore?: SessionStore;
  memoryFactory?: MemoryFactory;
  recorderFactory?: RecorderFactory;
  providerRegistry?: ProviderRegistry;
  recoveryManager?: RecoveryManager;
}

// In-memory MemoryStorage so tests never touch .freecode-memory on disk.
function createInMemoryStorage() {
  const states = new Map<string, MemoryState>();
  return {
    save: (state: MemoryState) => {
      states.set(state.sessionId, state);
    },
    load: (sessionId: string) => states.get(sessionId),
    listSessions: () => Array.from(states.keys()),
    delete: (sessionId: string) => {
      states.delete(sessionId);
    },
  };
}

export function makeTestLayer(overrides: TestLayerOverrides = {}) {
  const hooks = overrides.hooks ?? getHookRuntime();

  const memoryFactory: MemoryFactory = overrides.memoryFactory ?? {
    forSession: (sessionId) =>
      new MemoryService(sessionId, { hooks, storage: createInMemoryStorage() }),
  };

  // Rollout writes disabled by default — tests must not litter ~/.freecode.
  const recorderFactory: RecorderFactory = overrides.recorderFactory ?? {
    forSession: (sessionId) => createRecorder(sessionId, { enabled: false }),
  };

  const sessionStoreLayer = overrides.sessionStore
    ? Layer.succeed(SessionStoreTag, overrides.sessionStore)
    : Layer.effect(
        SessionStoreTag,
        Effect.promise(() =>
          createSessionStore(mkdtempSync(join(tmpdir(), "freecode-test-"))),
        ),
      );

  const providerRegistry: ProviderRegistry = overrides.providerRegistry ?? {
    get: (id: string) => getProvider(id as ProviderId),
    list: () => listProviders(),
  };

  return Layer.mergeAll(
    Layer.succeed(HookRuntimeTag, hooks),
    Layer.succeed(
      ToolOrchestratorTag,
      overrides.orchestrator ?? createToolOrchestrator(),
    ),
    Layer.succeed(BusTag, bus),
    Layer.succeed(ProviderRegistryTag, providerRegistry),
    sessionStoreLayer,
    Layer.succeed(MemoryFactoryTag, memoryFactory),
    Layer.succeed(RecorderFactoryTag, recorderFactory),
    Layer.succeed(
      RecoveryManagerTag,
      // No fallbacks by default — tests opt in explicitly.
      overrides.recoveryManager ??
        createRecoveryManager({ fallbackProviders: [] }),
    ),
    Layer.effect(
      SessionManagerTag,
      Effect.map(SessionStoreTag, (store) => createSessionManager(store)),
    ).pipe(Layer.provide(sessionStoreLayer)),
  );
}
