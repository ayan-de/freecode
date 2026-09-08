// =============================================================================
// ShellRegistry factory - one registry per session.
//
// Deliberately NOT an LRU like the OutputStore: evicting a registry would kill
// a dev server the user is still using. Registries are dropped on session end
// (`session/end-session.ts`), which is the only point at which killing the
// session's processes is the right thing to do.
// =============================================================================

import { ShellRegistry } from "./registry.js";

export { ShellRegistry } from "./registry.js";
export { SHELL_BUFFER_CHARS, MAX_SHELLS_PER_SESSION } from "./registry.js";
export type { ShellStatus, ShellSummary, ShellReadResult } from "./types.js";

const registries = new Map<string, ShellRegistry>();

export function getShellRegistry(sessionId: string): ShellRegistry {
  let registry = registries.get(sessionId);
  if (!registry) {
    registry = new ShellRegistry();
    registries.set(sessionId, registry);
  }
  return registry;
}

/** Read-only peek: never creates a registry, so an IPC poll can't leak one. */
export function peekShellRegistry(
  sessionId: string,
): ShellRegistry | undefined {
  return registries.get(sessionId);
}

export function disposeShellRegistry(sessionId: string): void {
  registries.get(sessionId)?.killAll();
  registries.delete(sessionId);
}

/** Process teardown — nothing may outlive the daemon. */
export function disposeAllShellRegistries(): void {
  for (const registry of registries.values()) registry.killAll();
  registries.clear();
}
