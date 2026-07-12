// apps/core/src/providers/index.ts
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
} from "./registry.js";

// Initialize providers by eagerly importing all provider modules
import { initProviders } from "./registry.js";
initProviders(); // fire and forget — registration is synchronous via side effect
