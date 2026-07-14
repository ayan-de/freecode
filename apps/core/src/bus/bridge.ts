// =============================================================================
// Bus → Frontend bridge (pure mapping)
// Decides how each internal bus event appears on the frontend wire.
// Returns undefined for internal-only events that must NOT reach frontends.
// =============================================================================

import type { BusEvent } from "./index.js";
import type { StreamEvent } from "@thisisayande/freecode-shared";

const INTERNAL_ONLY = new Set(["tools.changed", "mcp.tools.changed"]);

export function busEventToClientEvent(
  event: BusEvent,
): StreamEvent | undefined {
  if (INTERNAL_ONLY.has(event.type)) return undefined;

  if (event.type === "question.asked") {
    return {
      type: "question_asked",
      requestId: event.requestId,
      sessionId: event.sessionId,
      questions: event.questions,
    };
  }

  // Lifecycle/progress events (session.*, subagent.*, mcp.server.*, tool.*)
  // are forwarded verbatim; frontends render what they recognize and ignore
  // the rest. Cast: these carry richer payloads than the base StreamEvent
  // union, which frontends read structurally.
  return event as unknown as StreamEvent;
}
