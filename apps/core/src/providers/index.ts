// apps/core/src/providers/index.ts
export {
  type AIProvider,
  type ProviderInfo,
  type ExecuteOptions,
  type ExecuteResult,
  type ToolDef,
} from "./types";
export { type ProviderId } from "./config";
export {
  getApiKey,
  readConfig,
  writeConfig,
  CONFIG_DIR,
  CONFIG_FILE,
} from "./config";
export {
  registerProvider,
  getProvider,
  listProviders,
  initProviders,
} from "./registry";

// Initialize providers by eagerly importing all provider modules
import { initProviders } from "./registry";
initProviders(); // fire and forget — registration is synchronous via side effect
