// =============================================================================
// Turn-state reporting for the Android shell (spec §5.3).
//
//   submit ──▶ working ⇄ blocked ──▶ idle
//              (streaming) (awaiting  (done | error)
//                           approval)
//
// The native foreground service runs across `working` AND `blocked`,
// stopping only at `idle`. Getting `blocked` right is the whole point:
// when the agent parks on a permission prompt nothing streams, so any
// "is a turn active" signal derived from output activity goes quiet at
// exactly the moment a human is needed. A frozen WebView there doesn't
// merely delay the answer — the prompt times out after 5 minutes and
// `askPermission`'s callers treat that as **deny**.
//
// This module is a no-op outside the Android WebView, so the browser
// path pays nothing for it.
// =============================================================================

export type TurnState = "working" | "blocked" | "idle";

interface NativeBridge {
  setTurnState?(state: string, context: string): void;
}

function bridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { FreecodeBridge?: NativeBridge })
    .FreecodeBridge ?? null;
}

/**
 * Request ids of prompts this device has seen and not yet seen resolved.
 * Tracked as a set rather than a counter because a single turn can open
 * more than one prompt, and resolving one must not unblock the others.
 */
const openPrompts = new Set<string>();

let current: TurnState = "idle";
let currentContext = "";

/**
 * Push state to the native side. Only fires on an actual change — the
 * sustaining events (`text_delta`, `tool_output`, …) arrive hundreds of
 * times a turn and each call is a synchronous JNI hop.
 */
function push(next: TurnState, context: string): void {
  if (next === current && context === currentContext) return;
  current = next;
  currentContext = context;
  try {
    bridge()?.setTurnState?.(next, context);
  } catch (err) {
    // A broken bridge must never break the transcript.
    console.warn("[turn-state] bridge rejected", next, err);
  }
}

/** The turn is live and producing output. Called on submit and on any
 * streaming event. */
export function markWorking(): void {
  // A sustaining event while a prompt is still open does not clear the
  // block — the agent can stream a little after asking.
  if (openPrompts.size > 0) return;
  push("working", "");
}

/**
 * A prompt is waiting on a human. `label` names the tool (or question)
 * so the notification can say what is being asked, rather than a
 * generic "the agent".
 */
export function markBlocked(requestId: string, label: string): void {
  openPrompts.add(requestId);
  push("blocked", label);
}

/**
 * A prompt was resolved — by this device, another device, or a timeout.
 * With prompts still open we stay blocked; otherwise the agent resumes,
 * so we return to `working`, not `idle`.
 *
 * Note this departs from the letter of §5.3, which lists a resolution
 * broadcast as a route to `idle`. Stopping the service here would be a
 * trap on Android 12+: a backgrounded app cannot legally start a
 * foreground service again, so the *next* `permission_asked` of the
 * same turn could not re-escalate. `done`/`error` remain the only ways
 * to idle.
 */
export function markResolved(requestId: string): void {
  openPrompts.delete(requestId);
  if (openPrompts.size > 0) return;
  push("working", "");
}

/** Terminal event — the turn is over and the service may stop. */
export function markIdle(): void {
  openPrompts.clear();
  push("idle", "");
}

/**
 * Map a wire event onto the state machine. Returns nothing; call it for
 * every event before the rendering logic runs.
 */
export function observeStreamEvent(event: { type?: string; requestId?: string; toolName?: string }): void {
  switch (event.type) {
    case "question_asked":
      markBlocked(event.requestId ?? "question", "a question");
      break;
    case "permission_asked":
      markBlocked(event.requestId ?? "permission", event.toolName ?? "a tool");
      break;
    case "question.answered":
    case "question.rejected":
    case "permission.answered":
    case "permission.rejected":
      markResolved(event.requestId ?? "");
      break;
    case "done":
    case "error":
      markIdle();
      break;
    default:
      // text / text_delta / thinking / thinking_delta / tool_start /
      // tool_output / tool_complete all sustain `working`.
      markWorking();
  }
}
