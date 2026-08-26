// =============================================================================
// Trajectory redirection — turn a loop-health warning into evidence-backed
// advice for the next turn, instead of a debug log nobody reads.
// Spec: docs/superpowers/specs/2026-08-26-trajectory-redirection.md
// =============================================================================

export {
  createRedirectState,
  decideRedirect,
  isRedirectReason,
  noteDisabled,
  noteRedirect,
  REDIRECT_DEBOUNCE_TURNS,
  REDIRECT_MAX_PER_RUN,
  type RedirectDecision,
  type RedirectReason,
  type RedirectSkipReason,
  type RedirectState,
} from "./policy.js";

export {
  buildEvidence,
  EVIDENCE_CHAR_CAP,
  type EvidencePacket,
} from "./evidence.js";

export {
  redirectReminder,
  renderEvidence,
  SUPERVISOR_SYSTEM,
} from "./prompt.js";

export {
  capDirections,
  parseDirections,
  requestRedirect,
  SUPERVISOR_TIMEOUT_MS,
  type SupervisorOutcome,
} from "./supervisor.js";

export { loadRedirectSettings, type RedirectSettings } from "./settings.js";
