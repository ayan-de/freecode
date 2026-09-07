// =============================================================================
// AgentRegistry singleton.
//
// One instance for the process, not one per session: see the header of
// registry.ts for why the tree has to live in a single map.
// =============================================================================

import { AgentRegistry } from "./registry.js";

export { AgentRegistry } from "./registry.js";
export {
  AGENT_BUFFER_CHARS,
  MAX_AGENT_DEPTH,
  MAX_AGENTS_PER_ROOT,
} from "./registry.js";
export type { AgentRegisterOptions } from "./registry.js";
export type { AgentStatus, AgentSummary, AgentReadResult } from "./types.js";
export { formatActivity } from "./activity.js";

const registry = new AgentRegistry();

export function getAgentRegistry(): AgentRegistry {
  return registry;
}

/** Session end: stop and forget every agent this session's tree spawned. */
export function disposeAgentsForRoot(rootId: string): void {
  registry.disposeRoot(rootId);
}

/** Process teardown — nothing may outlive the daemon. */
export function disposeAllAgents(): void {
  registry.disposeAll();
}
