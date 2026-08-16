// =============================================================================
// Bus → Frontend bridge (pure mapping)
// Decides how each internal bus event appears on the frontend wire.
// Returns undefined for internal-only events that must NOT reach frontends.
// =============================================================================

import type { BusEvent } from "./index.js";
import type { StreamEvent } from "@thisisayande/freecode-shared";

const INTERNAL_ONLY = new Set([
  "tools.changed",
  "mcp.tools.changed",
  // Redundant with the stream tool_start/tool_complete events (the loop's
  // authoritative tool lifecycle); dropped so tools are never double-emitted.
  "tool.called",
  "tool.completed",
]);

export function busEventToClientEvent(
  event: BusEvent,
): StreamEvent | undefined {
  if (INTERNAL_ONLY.has(event.type)) return undefined;

  // The bus is only a carrier for stream events — unwrap to the wire language.
  // sessionId lives on the StreamRelayEvent wrapper, not on every StreamEvent
  // variant; re-attach it here so multi-session consumers (e.g. frontends
  // multiplexing several sessions over one process's stdout) can correlate
  // each line without every event author remembering to stamp it themselves.
  if (event.type === "stream") {
    return { ...event.event, sessionId: event.sessionId } as StreamEvent;
  }

  if (event.type === "question.asked") {
    return {
      type: "question_asked",
      requestId: event.requestId,
      sessionId: event.sessionId,
      questions: event.questions,
    };
  }

  if (event.type === "permission.asked") {
    return {
      type: "permission_asked",
      requestId: event.requestId,
      sessionId: event.sessionId,
      toolName: event.toolName,
      args: event.args,
      description: event.description,
      suggestedRule: event.suggestedRule,
      reason: event.reason,
    };
  }

  if (event.type === "memory.saved") {
    return {
      type: "memory_saved",
      sessionId: event.sessionId,
      memories: event.memories,
    };
  }

  // Lifecycle/progress events (session.*, subagent.*, mcp.server.*, tool.*)
  // are forwarded verbatim; frontends render what they recognize and ignore
  // the rest. Cast: these carry richer payloads than the base StreamEvent
  // union, which frontends read structurally.
  return event as unknown as StreamEvent;
}
