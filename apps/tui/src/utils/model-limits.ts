/**
 * Model context-window limits. The numbers live in one place — core resolves
 * them from models.dev (`models.contextLimit` IPC) — so this frontend keeps no
 * hardcoded table. This module only caches core's answers so the hot send path
 * doesn't issue an IPC round-trip per call.
 */

import { getModelContextLimit as fetchContextLimit } from "../ipc/client.js";

// Keyed by `provider/model`. A per-process cache is fine — the model list
// changes rarely enough that staleness isn't a concern within a session.
const contextLimitCache = new Map<string, number>();

/**
 * Context limit for a `provider/model` id. Returns 0 when unknown (callers
 * hide the context meter rather than divide by zero). Cached after the first
 * lookup; IPC failures resolve to 0 and are cached to avoid repeated retries.
 */
export async function getModelContextLimit(modelId: string): Promise<number> {
  const cached = contextLimitCache.get(modelId);
  if (cached !== undefined) return cached;

  const slash = modelId.indexOf("/");
  const provider = slash >= 0 ? modelId.slice(0, slash) : "";
  const model = slash >= 0 ? modelId.slice(slash + 1) : modelId;

  let limit = 0;
  try {
    limit = await fetchContextLimit(provider, model);
  } catch {
    limit = 0;
  }
  contextLimitCache.set(modelId, limit);
  return limit;
}
