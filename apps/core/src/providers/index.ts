// apps/core/src/providers/index.ts
export { type AIProvider, type ProviderInfo, type ExecuteOptions, type ExecuteResult, type ToolDef } from './types'
export { type ProviderId } from './config'
export { getApiKey, readConfig, writeConfig, CONFIG_DIR, CONFIG_FILE } from './config'
export { registerProvider, getProvider, listProviders, initProviders } from './registry'

// Re-export and initialize
import { initProviders } from './registry'
initProviders()