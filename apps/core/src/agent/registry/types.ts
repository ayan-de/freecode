// =============================================================================
// Subagent roster types — shared by the registry, the agent tool, and IPC.
//
// Deliberately shaped like `tools/shells/types.ts`: the /agents panel is the
// same card as /shells with a different noun, and keeping the two payloads
// congruent is what lets the TUI reuse the ring-buffer + cursor idiom.
// =============================================================================

export type AgentStatus = "running" | "completed" | "failed" | "killed";

/** What the TUI's agents panel and `agents.list` render. No activity payload. */
export interface AgentSummary {
  id: string;
  /** Session id of whoever spawned it — the root session, or another agent. */
  parentId: string;
  /** Root session the whole tree hangs off; the panel groups by this. */
  rootId: string;
  /** The `task` argument: a one-line description, shown as the row's title. */
  task: string;
  /** Provider override the spawn requested, or "agent" when it took the parent's. */
  agentType: string;
  /** 1 for an agent the root spawned, 2 for one of its children, and so on. */
  depth: number;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  /** Characters still held in the ring buffer, not the total ever produced. */
  bufferedChars: number;
  /** True once the ring buffer has dropped activity off the front. */
  truncated: boolean;
}

export interface AgentReadResult {
  found: boolean;
  /** Activity since the caller's cursor (or since the start for a fresh reader). */
  text: string;
  status: AgentStatus;
  droppedChars: number;
  /** Cursor to pass to the next positional read. */
  nextCursor: number;
}
