// =============================================================================
// Rollout Replay - Reconstruct state from events
// PRIMARY: Rebuild session state by replaying event log
// =============================================================================

import type {
  RolloutEvent,
  FunctionCallEvent,
  FunctionOutputEvent,
  TurnStartedEvent,
} from "./types.js";
import type { SessionEvents } from "./history.js";
import { loadSessionEvents } from "./history.js";

// ============================================================================
// Replay State Types
// ============================================================================

export interface ReplayedTurn {
  turnId: string;
  startedAt: number;
  calls: Array<{
    tool: string;
    args: Record<string, unknown>;
    output?: string;
    duration_ms?: number;
  }>;
}

export interface ReplayResult {
  sessionId: string;
  totalTurns: number;
  totalCalls: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
  turns: ReplayedTurn[];
  compactCount: number;
  errors: string[];
}

/**
 * Replay events and reconstruct session state
 */
export function replaySession(sessionId: string): ReplayResult | null {
  const session = loadSessionEvents(sessionId);
  if (!session) return null;

  const result: ReplayResult = {
    sessionId,
    totalTurns: 0,
    totalCalls: 0,
    totalTokensBefore: 0,
    totalTokensAfter: 0,
    turns: [],
    compactCount: 0,
    errors: [],
  };

  // Group events by turn
  const turnMap = new Map<string, ReplayedTurn>();
  const turnOrder: string[] = [];

  for (const event of session.events) {
    switch (event.type) {
      case "turn.started": {
        const typedEvent = event as TurnStartedEvent;
        const turn: ReplayedTurn = {
          turnId: typedEvent.turnId,
          startedAt: typedEvent.timestamp,
          calls: [],
        };
        turnMap.set(typedEvent.turnId, turn);
        turnOrder.push(typedEvent.turnId);
        result.totalTurns++;
        break;
      }

      case "function.call": {
        const typedEvent = event as FunctionCallEvent;
        const turn = turnMap.get(typedEvent.turnId);
        if (turn) {
          turn.calls.push({
            tool: typedEvent.tool,
            args: typedEvent.args,
          });
          result.totalCalls++;
        }
        break;
      }

      case "function.output": {
        const typedEvent = event as FunctionOutputEvent;
        // Find the turn this output belongs to
        for (const turn of turnMap.values()) {
          const lastCall = turn.calls[turn.calls.length - 1];
          if (lastCall && !lastCall.output) {
            lastCall.output = typedEvent.output;
            lastCall.duration_ms = typedEvent.duration_ms;
            break;
          }
        }
        break;
      }

      case "compact.occurred": {
        result.totalTokensBefore += (event as any).beforeTokens ?? 0;
        result.totalTokensAfter += (event as any).afterTokens ?? 0;
        result.compactCount++;
        break;
      }

      case "parse.error": {
        result.errors.push(`${(event as any).parser}: ${(event as any).error}`);
        break;
      }
    }
  }

  // Build ordered turn list
  for (const turnId of turnOrder) {
    const turn = turnMap.get(turnId);
    if (turn) result.turns.push(turn);
  }

  return result;
}

/**
 * Get a summary of what happened in a session
 */
export function getSessionSummary(sessionId: string): string | null {
  const replay = replaySession(sessionId);
  if (!replay) return null;

  const lines = [
    `Session: ${sessionId}`,
    `Turns: ${replay.totalTurns}`,
    `Tool Calls: ${replay.totalCalls}`,
    `Compactions: ${replay.compactCount}`,
    "",
  ];

  if (replay.errors.length > 0) {
    lines.push(`Errors (${replay.errors.length}):`);
    for (const err of replay.errors.slice(0, 5)) {
      lines.push(`  - ${err}`);
    }
    if (replay.errors.length > 5) {
      lines.push(`  ... and ${replay.errors.length - 5} more`);
    }
    lines.push("");
  }

  if (replay.turns.length > 0) {
    lines.push("Last turn tools:");
    const lastTurn = replay.turns[replay.turns.length - 1];
    for (const call of lastTurn.calls.slice(0, 5)) {
      lines.push(`  - ${call.tool}`);
    }
  }

  return lines.join("\n");
}

/**
 * Replay with compact information
 */
export interface CompactInfo {
  beforeTokens: number;
  afterTokens: number;
  timestamp: number;
}

/**
 * Get all compactions that occurred in a session
 */
export function getCompactions(session: SessionEvents): CompactInfo[] {
  const compactions: CompactInfo[] = [];

  for (const event of session.events) {
    if (event.type === "compact.occurred") {
      compactions.push({
        beforeTokens: (event as any).beforeTokens ?? 0,
        afterTokens: (event as any).afterTokens ?? 0,
        timestamp: event.timestamp,
      });
    }
  }

  return compactions;
}
