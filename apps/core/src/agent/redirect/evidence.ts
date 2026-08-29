// =============================================================================
// Evidence packet — a bounded, pure fold of the rollout log.
// PRIMARY: RolloutEvent[] + loop state → EvidencePacket
// PURE: no IO. Given a log you can reconstruct the exact packet a recorded
//       redirection was formed on, which is what makes the advice auditable.
// Spec: docs/superpowers/specs/2026-08-26-trajectory-redirection.md, D3.
// =============================================================================

import { buildTrace } from "../../rollout/trace.js";
import type { RolloutEvent } from "../../rollout/types.js";
import type { RedirectReason } from "./policy.js";

/** The supervisor is being asked to re-plan, not to re-derive the session. */
export const EVIDENCE_CHAR_CAP = 2000;
const MAX_RECENT_CALLS = 12;
const MAX_ERRORS = 3;
const ERROR_CHARS = 200;
const GOAL_CHARS = 400;
const ARGS_CHARS = 100;
/** Bounds the recorded audit trail; the packet is a digest, not the log. */
const MAX_EVENT_IDS = 48;

/**
 * Tools whose success changes a file. Mirrors `behavior.isDestructive` for the
 * tools that take a path, inlined so this fold stays pure — reaching into the
 * tool registry would make the packet depend on process state and stop it
 * being reproducible from a log.
 */
const MUTATING_TOOLS = new Set(["write", "edit"]);

export interface EvidenceCall {
  tool: string;
  /** One-line digest of the arguments. */
  args: string;
  failed: boolean;
  /**
   * The call was refused before it ran (mode, rule, hook, or the user). Not
   * the same as `failed`: a failed call did work and it went wrong, and the
   * fix is usually different arguments. A denied call did nothing and the
   * arguments were never the problem — retrying them is the trap this flag
   * exists to let the supervisor see.
   */
  denied?: boolean;
}

export interface EvidencePacket {
  reason: RedirectReason;
  turnCount: number;
  /** The user's original request, truncated. The supervisor cannot redirect
   *  without knowing the goal; it is the only free text from the transcript. */
  goal: string;
  recentCalls: EvidenceCall[];
  /** The exact repeated signature, when the reason is repetition. */
  repeatedSignature?: string;
  changedFiles: string[];
  errors: string[];
  todos: { content: string; status: string }[];
  /** Rollout event ids folded into this packet — the audit trail (§6). */
  evidenceEventIds: string[];
}

export interface BuildEvidenceInput {
  reason: RedirectReason;
  sessionId: string;
  events: RolloutEvent[];
  turnCount: number;
  goal: string;
  todos: { content: string; status: string }[];
}

export function buildEvidence(input: BuildEvidenceInput): EvidencePacket {
  const trace = buildTrace(input.sessionId, input.events);

  // Executed and refused calls interleaved in time order. Kept as one list
  // because "you tried this six times" is the same observation whether the
  // tool ran or the mode refused it, and splitting them would hide a loop
  // that alternates between the two.
  const recentCalls: EvidenceCall[] = [
    ...trace.toolSpans.map((s) => ({
      at: s.startedAt,
      tool: s.tool,
      args: digestArgs(s.args),
      failed: s.failed === true,
    })),
    ...trace.deniedSpans.map((s) => ({
      at: s.at,
      tool: s.tool,
      args: digestArgs(s.args),
      failed: false,
      denied: true,
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_RECENT_CALLS)
    .map(({ at: _at, ...call }) => call);

  const changedFiles: string[] = [];
  for (const span of trace.toolSpans) {
    if (!MUTATING_TOOLS.has(span.tool) || span.failed === true) continue;
    const file = filePathOf(span.args);
    if (file && !changedFiles.includes(file)) changedFiles.push(file);
  }

  const errors: string[] = [];
  const evidenceEventIds: string[] = [];
  for (const event of input.events) {
    if (
      event.type === "function.call" ||
      event.type === "function.output" ||
      event.type === "function.denied"
    ) {
      evidenceEventIds.push(event.id);
    }
    if (event.type === "function.output" && event.failed) {
      const text = event.output.trim().slice(0, ERROR_CHARS);
      if (text && !errors.includes(text)) errors.push(text);
    }
    // The refusal message is the most actionable error in the log: it names
    // the gate, so the advice can be "stop trying" rather than "try again".
    if (event.type === "function.denied") {
      const text = event.reason.trim().slice(0, ERROR_CHARS);
      if (text && !errors.includes(text)) errors.push(text);
    }
    if (event.type === "model.error") {
      evidenceEventIds.push(event.id);
      const text = event.error.trim().slice(0, ERROR_CHARS);
      if (text && !errors.includes(text)) errors.push(text);
    }
  }

  return {
    reason: input.reason,
    turnCount: input.turnCount,
    goal: input.goal.trim().slice(0, GOAL_CHARS),
    recentCalls,
    ...(input.reason === "repeated_identical_tool"
      ? { repeatedSignature: repeatedSignature(recentCalls) }
      : {}),
    changedFiles,
    // Newest first: the last thing that failed is the most useful.
    errors: errors.slice(-MAX_ERRORS).reverse(),
    todos: input.todos,
    evidenceEventIds: evidenceEventIds.slice(-MAX_EVENT_IDS),
  };
}

/** The call signature that appears most often, when it appears more than once. */
function repeatedSignature(calls: EvidenceCall[]): string | undefined {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const key = `${c.tool}(${c.args})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 1;
  for (const [key, n] of counts) {
    if (n > bestCount) {
      best = key;
      bestCount = n;
    }
  }
  return best === undefined ? undefined : `${best} ×${bestCount}`;
}

function filePathOf(args?: Record<string, unknown>): string | undefined {
  const value = args?.filePath ?? args?.file_path ?? args?.path;
  return typeof value === "string" ? value : undefined;
}

/**
 * `grep(pattern="TODO", path="src")` — enough to see "you ran this six times",
 * short enough that twelve of them fit the budget.
 */
function digestArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const rendered =
      typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    parts.push(`${key}=${JSON.stringify(rendered.slice(0, 60))}`);
    if (parts.join(" ").length >= ARGS_CHARS) break;
  }
  return parts.join(" ").slice(0, ARGS_CHARS);
}
