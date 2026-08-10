// =============================================================================
// Distillation Planner — the LLM call that proposes edits. No mutation.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md, §3.4
// Mirrors memory/extract.ts's shape deliberately: getProvider().execute(),
// a `complete` test seam so unit tests never need a real provider, never
// throws out of the top-level call (a failed distillation must be invisible
// to the user's task, same as a failed memory extraction).
// Ported from prime-agent's planRefinement/extractJsonObject/isIncompleteJson
// (refinement.ts:570-631,863-934), which exists because "the model returned
// bad JSON" and "the model ran out of output budget" need different fixes and
// JSON.parse can't tell you which — FreeCode's ExecuteResult.stopReason gives
// us that distinction for free (max_tokens), which prime-agent's SDK layer
// did not expose the same way, so the truncation check here is a fallback
// rather than the primary signal.
// =============================================================================

import { getProvider } from "../providers/index.js";
import type { ProviderId } from "../providers/index.js";
import { logger } from "../utils/logger.js";
import { HARNESS_KINDS } from "./types.js";
import type { DistillProposal, HarnessScope, HarnessState } from "./types.js";
import { DISTILL_SYSTEM_PROMPT, buildDistillUserPrompt } from "./prompts.js";

// Enough transcript to judge what's durable without paying for a whole
// session — matches memory/extract.ts's MAX_TRANSCRIPT_CHARS order of
// magnitude; a distillation reasons about the same kind of evidence.
const MAX_TRANSCRIPT_CHARS = 16_000;
// A handful of small edits (title + content each) fits comfortably; a fixed
// cap rather than a per-model lookup (Math.min(model.maxTokens, N)) — v1
// scope, revisit if real proposals are getting cut off.
const DISTILL_MAX_OUTPUT_TOKENS = 4_096;
// Hard ceiling independent of what the model proposes — a 40-edit proposal
// is not "small and evidence-backed," something upstream is wrong, and
// applying 40 edits from one unreviewed LLM call is not a risk worth taking
// even if every individual edit happens to validate.
export const MAX_EDITS_PER_PROPOSAL = 8;

const TRUNCATED_ERROR =
  "the model stopped before completing its JSON object (output budget exhausted); retry with a smaller request";

export interface PlanDistillationInput {
  transcript: string;
  state: HarnessState;
  scope: HarnessScope;
  provider: string;
  model?: string;
  instructions?: string;
  /** Test seam; defaults to a real provider.execute() call. */
  complete?: (
    system: string,
    prompt: string,
  ) => Promise<{ text: string; truncated: boolean }>;
}

function isIncompleteJson(candidate: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of candidate) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
  }
  return inString || depth > 0;
}

function parseJsonCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch (error) {
    if (isIncompleteJson(candidate)) throw new Error(TRUNCATED_ERROR);
    throw new Error(
      `the model did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Models wrap JSON in prose or a fence however much you ask them not to.
// Tries, in order: a bare object, a fenced block, brace-slicing from prose.
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return parseJsonCandidate(trimmed);
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return parseJsonCandidate(fenced[1].trim());

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return parseJsonCandidate(trimmed.slice(start));
    }
  }
  if (isIncompleteJson(trimmed)) throw new Error(TRUNCATED_ERROR);
  throw new Error("the model did not return a JSON object");
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseDistillProposal(text: string): DistillProposal {
  const value = extractJsonObject(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("distillation response must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  const rawEdits = Array.isArray(record.edits) ? record.edits : [];

  const edits = rawEdits
    .filter(
      (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
    )
    .filter(
      (e) =>
        typeof e.kind === "string" &&
        (HARNESS_KINDS as readonly string[]).includes(e.kind),
    )
    .slice(0, MAX_EDITS_PER_PROPOSAL)
    .map((e) => ({
      action: e.action as "create" | "update" | "delete",
      kind: e.kind as (typeof HARNESS_KINDS)[number],
      id: typeof e.id === "string" ? e.id : undefined,
      title: typeof e.title === "string" ? e.title : undefined,
      content: typeof e.content === "string" ? e.content : undefined,
      path: typeof e.path === "string" ? e.path : undefined,
      reference: objectRecord(e.reference),
      arguments: objectRecord(e.arguments),
      metadata: objectRecord(e.metadata),
      reason: typeof e.reason === "string" ? e.reason : undefined,
    }));

  return {
    summary:
      typeof record.summary === "string"
        ? record.summary
        : "Distilled the session",
    rationale: typeof record.rationale === "string" ? record.rationale : "",
    expectedOutcome:
      typeof record.expectedOutcome === "string" ? record.expectedOutcome : "",
    edits,
  };
}

function overviewForPlanner(state: HarnessState): string {
  const lines: string[] = [];
  for (const kind of HARNESS_KINDS) {
    const entries = Object.values(state.entries[kind]);
    lines.push(`${kind}: ${entries.length}`);
    for (const entry of entries.slice(0, 20)) {
      lines.push(
        `- [${entry.scope}:${entry.id}] ${entry.title} (v${entry.version}): ${entry.content.slice(0, 400)}`,
      );
    }
    if (entries.length > 20)
      lines.push(`- +${entries.length - 20} more ${kind} entries`);
  }
  return lines.join("\n");
}

function historyForPlanner(state: HarnessState): string {
  if (state.distillations.length === 0) return "No prior distillations.";
  return state.distillations
    .slice(-10)
    .map((e) => {
      const changes = e.appliedEdits
        .filter((edit) => edit.applied)
        .map((edit) => `${edit.action} ${edit.kind}:${edit.id}`);
      const rollback = e.rollbackOf ? ` (rollback of ${e.rollbackOf})` : "";
      return `[${e.id}]${rollback} ${e.summary} -> ${changes.length > 0 ? changes.join(", ") : "no applied edits"}`;
    })
    .join("\n");
}

async function realComplete(
  provider: string,
  model: string | undefined,
  system: string,
  prompt: string,
): Promise<{ text: string; truncated: boolean }> {
  const p = getProvider(provider as ProviderId);
  if (!p) return { text: "", truncated: false };
  const result = await p.execute({
    prompt,
    system,
    model,
    maxTokens: DISTILL_MAX_OUTPUT_TOKENS,
  });
  return {
    text: result.content ?? "",
    truncated: result.stopReason === "max_tokens",
  };
}

/**
 * Review a transcript and the current harness state, and propose edits.
 * Never mutates state. Never throws — a failed distillation must be
 * invisible to the user's task; callers get an empty-edits proposal instead.
 */
export async function planDistillation(
  input: PlanDistillationInput,
): Promise<DistillProposal> {
  try {
    const transcript = input.transcript.trim();
    if (transcript.length === 0) {
      return {
        summary: "Nothing to distill — empty transcript",
        rationale: "",
        expectedOutcome: "",
        edits: [],
      };
    }

    const userPrompt = buildDistillUserPrompt({
      transcript: transcript.slice(-MAX_TRANSCRIPT_CHARS),
      harnessOverview: overviewForPlanner(input.state),
      distillationHistory: historyForPlanner(input.state),
      scope: input.scope,
      instructions: input.instructions,
    });

    const complete =
      input.complete ??
      ((system, prompt) =>
        realComplete(input.provider, input.model, system, prompt));
    const { text, truncated } = await complete(
      DISTILL_SYSTEM_PROMPT,
      userPrompt,
    );

    if (truncated) {
      throw new Error(TRUNCATED_ERROR);
    }
    return parseDistillProposal(text);
  } catch (error) {
    // Same contract as extractMemories: never throw into the caller — the
    // caller sees "nothing to apply" rather than a turn-ending error. The
    // specific diagnosis (truncated vs malformed vs provider error) is worth
    // keeping for debugging even though the caller only sees the safe
    // fallback, so it goes to the log rather than being discarded outright.
    logger.debug("[Distill] planning failed", { error });
    return {
      summary: "Distillation failed",
      rationale: "",
      expectedOutcome: "",
      edits: [],
    };
  }
}
