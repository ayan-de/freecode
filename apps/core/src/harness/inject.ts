// =============================================================================
// Continual Harness Injection — render capped HarnessState into a prompt block
// PRIMARY: formatHarnessStateForPrompt, injected as a session block (cache:
// false) in agent/loop.ts, same pattern as renderRetrievedMemories.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md, §4.5
// Caps exist because harness state is unbounded and this rides on EVERY
// request once harness.enabled: without a cap it grows into the prompt
// forever. Defaults mirror prime-agent's (refinement.ts:26-28): 6 entries per
// kind, 180 chars each, 5 recent refinements — tune later with real data, not
// guessed twice.
// =============================================================================

import { HARNESS_KINDS, type HarnessState } from "./types.js";
import { loadHarnessSettings } from "./settings.js";
import { getGlobalHarnessDir, loadHarnessState } from "./store.js";

export interface HarnessInjectOptions {
  maxEntriesPerKind?: number;
  maxContentLength?: number;
  maxRefinements?: number;
}

const DEFAULT_MAX_ENTRIES_PER_KIND = 6;
const DEFAULT_MAX_CONTENT_LENGTH = 180;
const DEFAULT_MAX_REFINEMENTS = 5;

function compact(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

// Returns "" when the harness has nothing to say — no entries yet is the
// common case while harness.enabled is opt-in with no writer (Phase 2 adds
// one), and an always-present "empty" block wastes tokens on every request
// for that case. Same convention as renderRetrievedMemories.
export function formatHarnessStateForPrompt(
  state: HarnessState,
  options: HarnessInjectOptions = {},
): string {
  const maxEntriesPerKind =
    options.maxEntriesPerKind ?? DEFAULT_MAX_ENTRIES_PER_KIND;
  const maxContentLength =
    options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  const maxRefinements = options.maxRefinements ?? DEFAULT_MAX_REFINEMENTS;

  const totalEntries = HARNESS_KINDS.reduce(
    (sum, kind) => sum + Object.keys(state.entries[kind]).length,
    0,
  );
  if (totalEntries === 0) return "";

  const lines: string[] = [
    "# Continual harness",
    "",
    "Durable notes you (the agent) have recorded about this project or user, separate",
    "from memory. These are compact summaries — routing hints, not full descriptions.",
    "",
  ];

  for (const kind of HARNESS_KINDS) {
    const entries = Object.values(state.entries[kind]).sort((a, b) =>
      [a.path, a.title, a.id]
        .join("\0")
        .localeCompare([b.path, b.title, b.id].join("\0")),
    );
    if (entries.length === 0) continue;

    lines.push(`## ${kind}`);
    for (const entry of entries.slice(0, maxEntriesPerKind)) {
      lines.push(
        `- [${entry.scope}:${entry.id}] ${entry.title}: ${compact(entry.content, maxContentLength)}`,
      );
    }
    const overflow =
      entries.length - Math.min(entries.length, maxEntriesPerKind);
    if (overflow > 0) lines.push(`- +${overflow} more ${kind} entries`);
    lines.push("");
  }

  if (state.refinements.length > 0) {
    lines.push("## Recent changes to this harness");
    for (const event of state.refinements.slice(-maxRefinements)) {
      lines.push(`- [${event.id}] ${compact(event.trigger, maxContentLength)}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * The single call site for the agent loop: check settings, load, format.
 * Off by default (harness.enabled), in which case this returns "" without
 * touching disk — same shape as renderTodoPromptBlock (tools/todo.ts), one
 * function call and no branching left in the loop. Global scope only for
 * now; see store.ts's module comment for why local isn't wired here yet.
 *
 * `globalDir` defaults to the real `~/.freecode/harness` but is overridable —
 * same pattern as context/instructions.ts's `globalDir` param — because
 * CONFIG_DIR is a module-level constant resolved once at import time, so a
 * test cannot redirect it by mutating process.env.HOME after the fact.
 */
export function loadHarnessPromptBlock(
  projectRoot: string,
  globalDir: string = getGlobalHarnessDir(),
): string {
  if (!loadHarnessSettings(projectRoot).enabled) return "";
  return formatHarnessStateForPrompt(loadHarnessState(globalDir, "global"));
}
