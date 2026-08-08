// =============================================================================
// Session-frozen project context — keeps position 0 of the prompt byte-stable.
//
// The dynamic user message (file tree + git head + clock) is the most
// cache-sensitive slot in the request: every byte after it depends on it.
// tree-cache still refreshes for the process (TTL + watcher), but what the
// *prompt* sees must not move mid-session — otherwise a top-level add from
// write/bash, or a 5-minute TTL expiry, rewrites position 0 and busts the
// whole conversation prefix.
//
// Keyed by sessionId like read-state / cache-awareness: the AgentLoop is
// reconstructed every user turn (server.ts runSessionTurn), so freezing on
// the instance alone would only cover tool turns within one message.
// Claude Code freezes its directory listing for the same reason.
// =============================================================================

import {
  getProjectContext,
  type ProjectContext,
} from "./tree-cache.js";

export interface FrozenSessionContext {
  ctx: ProjectContext;
  /** Hour-rounded clock captured with the tree — same freeze, same reason. */
  clock: string;
}

const frozen = new Map<string, FrozenSessionContext>();

function hourClock(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13) + ":00:00Z";
}

/**
 * Return the project context (and clock) frozen for this session.
 * First call snapshots; later calls reuse it even if tree-cache was
 * invalidated underneath.
 */
export function getFrozenSessionContext(
  sessionId: string,
  projectPath: string,
  now?: Date,
): FrozenSessionContext {
  const hit = frozen.get(sessionId);
  if (hit && hit.ctx.projectPath === projectPath) return hit;

  // Snapshot fields — do not alias the tree-cache object, which may be
  // replaced on the next invalidate/TTL miss.
  const live = getProjectContext(projectPath);
  const snap: FrozenSessionContext = {
    ctx: {
      name: live.name,
      projectPath: live.projectPath,
      tree: live.tree,
      gitHead: live.gitHead,
    },
    clock: hourClock(now),
  };
  frozen.set(sessionId, snap);
  return snap;
}

/** Drop the freeze — session.delete / tests. Next get re-snapshots. */
export function disposeFrozenSessionContext(sessionId: string): void {
  frozen.delete(sessionId);
}
