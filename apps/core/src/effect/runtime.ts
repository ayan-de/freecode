// =============================================================================
// Effect Runtime — application runtime composed from AppLayerLive (v3 spec DI)
// PRIMARY: Lazily-built ManagedRuntime shared by server.ts / cli.ts
// INPUT: AppLayerLive (or a test layer via makeRuntime)
// OUTPUT: getAppRuntime() — runPromise/runSync entry point for effects
// PURPOSE: Single composition point. Server code resolves services with
//          `getAppRuntime().runPromise(SomeTag)` instead of module singletons.
// =============================================================================

import { ManagedRuntime, type Layer } from "effect";
import { AppLayerLive } from "./layers.js";
import type { AppServices } from "./context.js";

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

let appRuntime: AppRuntime | null = null;

// Build a runtime from any layer providing the full service graph — used by
// tests to run the real composition against makeTestLayer().
export function makeRuntime(
  layer: Layer.Layer<AppServices, never, never>,
): AppRuntime {
  return ManagedRuntime.make(layer);
}

export function getAppRuntime(): AppRuntime {
  if (!appRuntime) {
    appRuntime = ManagedRuntime.make(AppLayerLive);
  }
  return appRuntime;
}

export async function disposeAppRuntime(): Promise<void> {
  if (appRuntime) {
    await appRuntime.dispose();
    appRuntime = null;
  }
}
