// =============================================================================
// AgentRegistry - the roster of live subagents, for the /agents panel.
//
// Unlike ShellRegistry there is ONE registry, not one per session: a subagent's
// session id is synthetic and unknown to the frontend, so resolving "which root
// session does this agent belong to" needs the whole tree in one place. Rows
// are grouped by `rootId` at read time instead (`listForRoot`).
//
// Activity is folded out of the bus rather than pushed in by the loop: a
// subagent's AgentLoop already publishes StreamEvents under its own session id,
// and nothing was listening. Subscribing here means nested agents are captured
// for free, and AgentLoop needs no knowledge of the panel.
// =============================================================================

import { bus } from "../../bus/index.js";
import type { AgentReadResult, AgentStatus, AgentSummary } from "./types.js";
import { formatActivity } from "./activity.js";

/** Per-agent ring-buffer cap. Smaller than a shell's: this is a summary. */
export const AGENT_BUFFER_CHARS = 64_000;
/** Trim in blocks so a chatty agent doesn't re-slice the buffer per delta. */
const TRIM_BLOCK = AGENT_BUFFER_CHARS >> 2;

/**
 * How deep the spawn tree may go. 1 means the main agent may delegate but a
 * subagent may not re-delegate — the same rule Claude Code states in its own
 * Agent tool description ("If you are the fork, execute directly").
 *
 * The cap exists because nothing else bounds the tree: a subagent runs in
 * `build` mode with the full tool set, `agent` included, so a model that
 * answers every task by delegating recurses until the token budget dies. Raise
 * it only alongside a budget that is shared across the tree rather than
 * per-loop.
 */
export const MAX_AGENT_DEPTH = 1;

/** Ceiling on subagents running concurrently under one root session. */
export const MAX_AGENTS_PER_ROOT = 8;

export interface AgentRegisterOptions {
  id: string;
  /** Session that spawned it: the root session, or another agent's id. */
  parentId: string;
  task: string;
  agentType: string;
  /** Cancels the subagent's loop; wired to `AgentLoop.interrupt`. */
  interrupt?: () => void;
  /** Notified on every activity chunk so the caller can relay it to the TUI. */
  onActivity?: (id: string, chunk: string) => void;
  /** Notified once the agent settles, for the same reason. */
  onExit?: (id: string, status: AgentStatus) => void;
}

interface AgentRecord {
  id: string;
  parentId: string;
  rootId: string;
  task: string;
  agentType: string;
  depth: number;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  buf: string;
  /** Characters dropped off the front of `buf`; also the buffer's base offset. */
  droppedChars: number;
  interrupt?: () => void;
  onActivity?: (id: string, chunk: string) => void;
  onExit?: (id: string, status: AgentStatus) => void;
}

export class AgentRegistry {
  private agents = new Map<string, AgentRecord>();
  private unsubscribe: (() => void) | null = null;

  /**
   * Record a spawn. Throws when it would breach the depth or concurrency cap —
   * the caller turns that into a tool error the model can read and act on,
   * which is the whole point of capping here rather than silently truncating.
   */
  register(options: AgentRegisterOptions): AgentSummary {
    const depth = this.depthOf(options.parentId) + 1;
    if (depth > MAX_AGENT_DEPTH) {
      throw new Error(
        `Subagents may not spawn subagents (depth limit ${MAX_AGENT_DEPTH}). Do this task directly instead of delegating it.`,
      );
    }

    const rootId = this.rootOf(options.parentId);
    if (this.runningCount(rootId) >= MAX_AGENTS_PER_ROOT) {
      throw new Error(
        `Too many subagents running (${MAX_AGENTS_PER_ROOT}). Wait for one to finish before spawning another.`,
      );
    }

    const record: AgentRecord = {
      id: options.id,
      parentId: options.parentId,
      rootId,
      task: options.task,
      agentType: options.agentType,
      depth,
      status: "running",
      startedAt: Date.now(),
      buf: "",
      droppedChars: 0,
      interrupt: options.interrupt,
      onActivity: options.onActivity,
      onExit: options.onExit,
    };
    this.agents.set(record.id, record);
    this.ensureSubscribed();
    return summarize(record);
  }

  /**
   * Late-bind the cancel handle. The loop does not exist yet when the agent is
   * registered — registration has to happen first so the depth check can refuse
   * the spawn before anything is constructed.
   */
  attachInterrupt(id: string, interrupt: () => void): void {
    const record = this.agents.get(id);
    if (record) record.interrupt = interrupt;
  }

  /** Mark an agent finished. Idempotent: the first settle wins. */
  settle(id: string, status: Exclude<AgentStatus, "running">): void {
    const record = this.agents.get(id);
    if (!record || record.status !== "running") return;
    record.status = status;
    record.endedAt = Date.now();
    record.onExit?.(id, status);
  }

  /**
   * Positional read that mirrors `ShellRegistry.readFrom`. There is no model-
   * facing cursor here: the parent never polls a subagent's activity, it waits
   * for the final summary, so the panel is the only reader.
   */
  readFrom(id: string, cursor: number): AgentReadResult {
    const record = this.agents.get(id);
    if (!record) {
      return {
        found: false,
        text: "",
        status: "failed",
        droppedChars: 0,
        nextCursor: 0,
      };
    }
    const end = record.droppedChars + record.buf.length;
    const from = Math.max(cursor, record.droppedChars);
    return {
      found: true,
      text: record.buf.slice(from - record.droppedChars),
      status: record.status,
      droppedChars: Math.max(0, record.droppedChars - cursor),
      nextCursor: end,
    };
  }

  /** Every agent under this root, oldest first — spawn order is the reading order. */
  listForRoot(rootId: string): AgentSummary[] {
    return [...this.agents.values()]
      .filter((a) => a.rootId === rootId)
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(summarize);
  }

  get(id: string): AgentSummary | undefined {
    const record = this.agents.get(id);
    return record ? summarize(record) : undefined;
  }

  /**
   * Cancel a running agent. Settles the record here rather than waiting for the
   * loop to unwind, for the same reason `ShellRegistry.kill` does: a second
   * stop is then a no-op and the panel flips immediately. The loop's own
   * completion path finds the record already settled and does nothing.
   */
  stop(id: string): boolean {
    const record = this.agents.get(id);
    if (!record || record.status !== "running") return false;
    try {
      record.interrupt?.();
    } catch {
      // An interrupt that throws must not leave the row stuck on "running".
    }
    record.status = "killed";
    record.endedAt = Date.now();
    record.onExit?.(id, "killed");
    return true;
  }

  /** Forget a settled agent. Refuses a running one — stop it first. */
  remove(id: string): boolean {
    const record = this.agents.get(id);
    if (!record || record.status === "running") return false;
    this.agents.delete(id);
    return true;
  }

  /** 0 for a session that is not itself an agent (i.e. a root session). */
  depthOf(sessionId: string): number {
    return this.agents.get(sessionId)?.depth ?? 0;
  }

  /** A session that is not an agent is its own root. */
  rootOf(sessionId: string): string {
    return this.agents.get(sessionId)?.rootId ?? sessionId;
  }

  /** Session teardown: stop and forget everything under this root. */
  disposeRoot(rootId: string): void {
    for (const record of [...this.agents.values()]) {
      if (record.rootId !== rootId) continue;
      if (record.status === "running") this.stop(record.id);
      this.agents.delete(record.id);
    }
    this.maybeUnsubscribe();
  }

  /** Process teardown — no agent may outlive the daemon. */
  disposeAll(): void {
    for (const record of this.agents.values()) {
      if (record.status === "running") this.stop(record.id);
    }
    this.agents.clear();
    this.maybeUnsubscribe();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private runningCount(rootId: string): number {
    let n = 0;
    for (const a of this.agents.values()) {
      if (a.rootId === rootId && a.status === "running") n++;
    }
    return n;
  }

  private ensureSubscribed(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = bus.subscribe("stream", (event) => {
      const record = this.agents.get(event.sessionId);
      // Every other session on the bus — the root's own turn above all — falls
      // out here, so this stays a map lookup on the hot streaming path.
      if (!record || record.status !== "running") return;
      const chunk = formatActivity(event.event);
      if (chunk) this.append(record, chunk);
    });
  }

  private maybeUnsubscribe(): void {
    if (this.agents.size > 0 || !this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
  }

  private append(record: AgentRecord, chunk: string): void {
    record.buf += chunk;
    if (record.buf.length > AGENT_BUFFER_CHARS) {
      const drop = record.buf.length - AGENT_BUFFER_CHARS + TRIM_BLOCK;
      record.buf = record.buf.slice(drop);
      record.droppedChars += drop;
    }
    record.onActivity?.(record.id, chunk);
  }
}

function summarize(record: AgentRecord): AgentSummary {
  return {
    id: record.id,
    parentId: record.parentId,
    rootId: record.rootId,
    task: record.task,
    agentType: record.agentType,
    depth: record.depth,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    bufferedChars: record.buf.length,
    truncated: record.droppedChars > 0,
  };
}
