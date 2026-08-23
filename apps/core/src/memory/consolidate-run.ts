// =============================================================================
// Consolidation orchestration (spec D7–D9, D13): gates → lock → assemble →
// one call → apply → advance the baseline.
//
// Split from consolidate.ts on purpose. That file is the *call* — prompt,
// validation, caps, writes — and is unit-testable without a filesystem, a lock,
// or a clock. This one is the schedule and the plumbing around it.
// =============================================================================

import * as path from "node:path";
import { getMemoryStore } from "./mem-store.js";
import type { MemoryEntry } from "./mem-types.js";
import { getMemoryGraphService } from "./graph/index.js";
import {
  shouldConsolidate,
  type SessionSummary,
} from "./consolidate-policy.js";
import {
  recordConsolidationOutcome,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
} from "./consolidation-lock.js";
import { commitBaseline, diffSinceBaseline } from "./git-baseline.js";
import {
  consolidateMemories,
  MAX_CANDIDATES,
  type ConsolidationResult,
} from "./consolidate.js";
import { logger } from "../utils/logger.js";

// Per-project episode retention (spec D6.2). Overflow is handed to the model to
// fold anything durable into a semantic memory, then deleted by us.
export const MAX_EPISODES = 50;

export interface RunConsolidationInput {
  projectPath: string;
  provider: string;
  model?: string;
  sessionId: string;
  sessions: SessionSummary[];
  rateLimited?: boolean;
  complete?: (system: string, prompt: string) => Promise<string>;
}

/**
 * Assemble the model's input (spec D9).
 *
 * Order matters, and it is the reason D12 had to land first: without usage
 * data every selector below is a similarity proxy, and similarity answers
 * "which of these look alike", not "which of these is dead".
 */
function assemble(
  projectPath: string,
  diff: { diff: string; files: string[] } | null,
  sessions: SessionSummary[],
): { prompt: string; shownNames: Set<string>; overflowEpisodes: string[] } {
  const store = getMemoryStore(projectPath);
  const service = getMemoryGraphService(projectPath);
  const all = store.list();

  const index = all
    .map((e) => `- [${e.type}] ${e.name}: ${e.description}`)
    .join("\n");

  // 1. Everything the diff touched — the most informative signal available.
  const touched = new Set<string>();
  for (const file of diff?.files ?? []) {
    const name = path.basename(file, ".md");
    if (name) touched.add(name);
  }

  // 2. Episodes over the retention cap, least-used first, age breaking ties.
  const episodes = all
    .filter((e) => e.type === "episode")
    .sort((a, b) => {
      const ua = service.usageFor(a).useCount;
      const ub = service.usageFor(b).useCount;
      return ua - ub || (a.happened_at ?? "").localeCompare(b.happened_at ?? "");
    });
  const overflowEpisodes = episodes
    .slice(0, Math.max(0, episodes.length - MAX_EPISODES))
    .map((e) => e.name);

  const pick = (e: MemoryEntry): number =>
    touched.has(e.name) ? 0 : overflowEpisodes.includes(e.name) ? 1 : 2;

  const candidates = all
    .slice()
    .sort((a, b) => {
      const byBucket = pick(a) - pick(b);
      if (byBucket !== 0) return byBucket;
      // Within the leftovers, prefer the ones actually being retrieved: a
      // memory nobody reads is a worse merge candidate than a live one.
      return service.usageFor(b).useCount - service.usageFor(a).useCount;
    })
    .slice(0, MAX_CANDIDATES);

  const bodies = candidates
    .map((e) => {
      const u = service.usageFor(e);
      const when = u.lastUsedAt
        ? new Date(u.lastUsedAt).toISOString().slice(0, 10)
        : "never";
      return [
        `## ${e.name} (${e.type})`,
        `used: ${u.useCount} times of ${u.injectedCount} shown, last ${when}`,
        e.description,
        "",
        e.content,
      ].join("\n");
    })
    .join("\n\n");

  const recent = sessions
    .slice()
    .sort((a, b) => b.lastTurnAt - a.lastTurnAt)
    .slice(0, 20)
    .map((s) => `- ${new Date(s.lastTurnAt).toISOString().slice(0, 10)} ${s.id}`)
    .join("\n");

  const prompt = [
    "# Memory index",
    index || "(empty)",
    "",
    "# Written since the last consolidation",
    diff?.diff || diff?.files.join("\n") || "(no diff available)",
    "",
    "# Candidate memories",
    bodies || "(none)",
    "",
    "# Sessions in this period",
    recent || "(none)",
  ].join("\n");

  return {
    prompt,
    shownNames: new Set(candidates.map((e) => e.name)),
    overflowEpisodes,
  };
}

/**
 * Run consolidation if it is due. Never throws.
 *
 * Returns null when a gate declined — the common case by far, since the
 * cadence is at most once per project per day.
 */
export async function runConsolidationIfDue(
  input: RunConsolidationInput,
): Promise<ConsolidationResult | null> {
  const store = getMemoryStore(input.projectPath);
  const memoryDir = store.getMemoryDir();
  const graphDir = path.join(memoryDir, ".graph");

  const decision = shouldConsolidate({
    projectRoot: input.projectPath,
    graphDir,
    sessions: input.sessions,
    currentSessionId: input.sessionId,
    rateLimited: input.rateLimited,
  });
  if (!decision.consolidate) {
    logger.debug(`[MemoryConsolidate] skipped: ${decision.reason}`);
    return null;
  }

  const priorMtime = tryAcquireConsolidationLock(graphDir);
  if (priorMtime === null) {
    logger.debug("[MemoryConsolidate] another process holds the lock");
    return null;
  }

  try {
    const diff = await diffSinceBaseline(memoryDir);
    const { prompt, shownNames, overflowEpisodes } = assemble(
      input.projectPath,
      diff,
      input.sessions,
    );

    const result = await consolidateMemories({
      projectPath: input.projectPath,
      provider: input.provider,
      model: input.model,
      prompt,
      shownNames,
      overflowEpisodes,
      sessionId: input.sessionId,
      complete: input.complete,
    });

    if (!result.ok) {
      rollbackConsolidationLock(graphDir, priorMtime);
      return result;
    }

    const changed = result.merged + result.promoted + result.episodes;
    recordConsolidationOutcome(
      graphDir,
      changed > 0 ? "succeeded" : "succeeded_no_output",
    );
    // Only a successful run moves the baseline. A failed one leaves it, so the
    // next diff spans both windows — a superset, so nothing is missed.
    await commitBaseline(
      memoryDir,
      `consolidate: ${result.merged} merged, ${result.promoted} promoted, ${result.episodes} episode(s)`,
    );
    return result;
  } catch (error) {
    logger.debug("[MemoryConsolidate] run failed", { error });
    rollbackConsolidationLock(graphDir, priorMtime);
    return null;
  }
}
