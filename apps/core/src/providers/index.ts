// apps/core/src/providers/index.ts
import { logger } from "../utils/logger.js";

export {
  type AIProvider,
  type ProviderInfo,
  type ExecuteOptions,
  type ExecuteResult,
  type ToolDef,
} from "./types.js";
export { type ProviderId } from "./config.js";
export {
  getApiKey,
  readConfig,
  writeConfig,
  CONFIG_DIR,
  CONFIG_FILE,
} from "./config.js";
export {
  registerProvider,
  getProvider,
  listProviders,
  initProviders,
  allowsAuxiliaryCalls,
  providerRequiresApiKey,
} from "./registry.js";

// Start registration as soon as this module is imported, so a caller that
// reaches `getProvider()` without having awaited `initProviders()` is racing a
// head start rather than an empty registry.
//
// It is NOT synchronous, whatever this comment used to claim: registration
// awaits the catalogue and the generic driver, both dynamically imported. The
// three real entrypoints (server.ts, cli/commands/run.ts, eval/runner.ts) all
// await `initProviders()`, which is memoized, so this costs nothing there.
//
// Explicitly caught: an unawaited rejection here would otherwise be an
// unhandled promise rejection at startup — on newer Node, a process exit — and
// the one thing worse than starting with no providers is doing it silently.
import { initProviders } from "./registry.js";
void initProviders().catch((err) => {
  logger.error(
    `[providers] registration failed: ${err instanceof Error ? err.message : String(err)}`,
  );
});
