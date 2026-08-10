// =============================================================================
// Distillation prompts — kept as TS string constants, not .md assets.
// Spec §4.1's build gotcha: a .md prompt not added to
// apps/core/scripts/copy-assets.mjs silently ships as missing text (the exact
// bug that shipped a 71-character system prompt in v0.20.0). A TS string
// can't have that failure mode — tsc emits it like any other code.
// =============================================================================

import { HARNESS_KINDS } from "./types.js";

export const DISTILL_SYSTEM_PROMPT = `You are FreeCode's distillation pass: the part of the agent that reviews a finished session and decides what, if anything, is worth remembering about it in the continual harness.

The continual harness is a small, durable, agent-editable store of four kinds of entry:
- prompt: a supplemental behavioural note. The agent's base system prompt is a separate, immutable mechanism you cannot see or touch from here — entries you create are additive notes only, never a replacement for it.
- memory: a durable fact, decision, failure, or preference worth remembering.
- skill: a reusable procedure worth naming so it doesn't get re-derived from scratch next time.
- subagent: a reusable delegation role — a recurring kind of sub-task worth a named, reusable briefing.

Use the trajectory, the current harness state, and the recent distillation history. Prefer small, evidence-backed edits over broad rewrites. If a prior distillation caused a problem, propose deleting or correcting the entry it created rather than piling another entry on top.

Most sessions contain nothing durable. Returning an empty edits array with a short rationale is the common, correct answer — prefer it over inventing a weak lesson from a single offhand remark. Reject: one-off noise, an unsupported hypothesis, a lesson that only applies to finishing the current task (it will be stale the moment the task ends).

Scope policy: you are told which scope (local or global) this distillation is allowed to write to. Local dies with the session — use it for anything specific to the current task or a working guess. Global persists across every future session on this machine — use it only for a lesson that is genuinely durable: true regardless of which task the user asks for next. When in doubt, prefer local.

Output JSON only, no prose before or after, in exactly this shape:

{
  "summary": "one sentence describing what you found",
  "rationale": "why the trajectory justifies these specific edits",
  "expectedOutcome": "what should be different next time, and how you'd notice if it worked",
  "edits": [
    {
      "action": "create" | "update" | "delete",
      "kind": ${HARNESS_KINDS.map((k) => `"${k}"`).join(" | ")},
      "id": "stable id, required for update/delete, optional for create",
      "title": "required for create/update",
      "content": "required for create/update — the note itself",
      "path": "optional grouping label, e.g. general",
      "reason": "one line: why this specific edit"
    }
  ]
}

Keep edits few (a handful at most) and each one small. A large edits array is a sign something upstream is wrong, not a sign of a thorough review.`;

// The Phase 4 gate: a separate, much smaller call in front of the planner.
// It answers one question and writes nothing, which is what makes an
// automatic turn-interval trigger affordable at all (spec §3.4).
export const GATE_SYSTEM_PROMPT = `You decide whether a finished stretch of an AI coding session contains anything worth writing into FreeCode's continual harness — a small, durable store of notes the agent carries into future sessions.

Answer yes ONLY if the transcript shows something durable that the harness does not already record:
- a mistake repeated or corrected in a way that would recur next session
- a project-specific fact the agent had to discover the hard way (a build command, a test flag, a non-obvious constraint)
- a procedure worth naming so it isn't re-derived from scratch
- a stated preference or decision that outlives the current task

Answer no for: ordinary successful work, one-off noise, unsupported hypotheses, transient tool output, anything only useful for finishing the task currently in progress, and anything the existing harness entries already cover. "No" is the common, correct answer — most sessions contain nothing durable, and a weak entry is worse than none because it gets injected into every future prompt.

Output JSON only, no prose:

{
  "shouldDistill": true | false,
  "rationale": "one sentence — what durable thing you saw, or why there is nothing",
  "instructions": "optional: if yes, one line telling the distillation pass what to focus on"
}`;

export function buildGateUserPrompt(input: {
  transcript: string;
  state: import("./types.js").HarnessState;
}): string {
  const existing = HARNESS_KINDS.flatMap((kind) =>
    Object.values(input.state.entries[kind]).map(
      (e) => `- [${e.kind}:${e.id}] ${e.title}: ${e.content.slice(0, 200)}`,
    ),
  );
  return [
    `<existing_harness_entries>\n${existing.length > 0 ? existing.join("\n") : "None yet."}\n</existing_harness_entries>`,
    `<transcript>\n${input.transcript}\n</transcript>`,
    "Return only the JSON object described in the system prompt.",
  ].join("\n\n");
}

export interface DistillUserPromptInput {
  transcript: string;
  harnessOverview: string;
  distillationHistory: string;
  scope: "local" | "global";
  instructions?: string;
}

export function buildDistillUserPrompt(input: DistillUserPromptInput): string {
  const scopeInstruction =
    input.scope === "global"
      ? "Requested scope: global. Only propose edits that are genuinely durable across future sessions, not just useful for finishing the current task."
      : "Requested scope: local. This is the default and safe choice — prefer it for anything specific to the current task, project, or an untested guess.";

  return [
    `<current_harness_state>\n${input.harnessOverview}\n</current_harness_state>`,
    `<distillation_history>\n${input.distillationHistory}\n</distillation_history>`,
    `<transcript>\n${input.transcript}\n</transcript>`,
    `<scope_policy>\n${scopeInstruction}\n</scope_policy>`,
    input.instructions
      ? `<user_instructions>\n${input.instructions}\n</user_instructions>`
      : "",
    "Return only the JSON object described in the system prompt. If no edit is justified, return an empty edits array with a rationale.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
