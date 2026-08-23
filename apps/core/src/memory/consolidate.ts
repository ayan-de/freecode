// =============================================================================
// Consolidation (spec D9): one structured call over a deterministically
// assembled input, applied by us under hard caps.
//
// Deliberately NOT an agent with tools. claude-code's autoDream can afford a
// forked agent with grep and scoped write access because the fork rides the
// parent's prompt cache; we have no forked-agent primitive, and a fresh
// full-price loop turned loose over hundreds of rollout directories has no cost
// ceiling. We assemble the input, make one call, and apply the result.
//
// **There is no bare `delete` verb.** A memory can only be removed as the
// `supersedes` list of a merge — the model must name what replaces it. An
// unconstrained delete on a cheap model running unattended against the user's
// memory is the one failure a retry cannot undo. mem0 is evidence for this and
// not against: its v2 manager offered ADD/UPDATE/DELETE/NONE and its v3
// extraction prompt is ADD-only.
// =============================================================================

import { getProvider } from "../providers/index.js";
import type { ProviderId } from "../providers/index.js";
import { getMemoryStore } from "./mem-store.js";
import {
  AUTHORABLE_MEMORY_TYPES,
  type MemoryEntry,
  type MemoryType,
} from "./mem-types.js";
import { containsSecret } from "./graph/secret-filter.js";
import { BusEvents } from "../bus/index.js";
import { logger } from "../utils/logger.js";

export const MAX_MERGES = 5;
export const MAX_PROMOTES = 3;
export const MAX_EPISODES_PER_RUN = 1;
export const MAX_CANDIDATES = 20;

const TYPE_LIST = AUTHORABLE_MEMORY_TYPES.join("|");

const SYSTEM = `You maintain a developer's long-term memory store.

You are given the memory index, a git diff of everything written since the last
time you ran, and the bodies of the memories most likely to need attention.

Return ONLY a JSON object, no prose:
{
  "merges":  [{ "into": "<existing name>", "supersedes": ["<name>", ...],
                "description": "...", "content": "..." }],
  "episode": { "name": "kebab-case", "description": "one sentence",
               "happened_at": "YYYY-MM-DD", "content": "..." } | null,
  "promote": [{ "type": "${TYPE_LIST}", "name": "...",
                "description": "...", "content": "..." }]
}

merges fold near-duplicates into one memory. Every name in "supersedes" is
DELETED and replaced by "into", so only list names the merged memory fully
covers. There is no delete verb: if a memory is obsolete but nothing replaces
it, leave it alone.

episode records what happened in this period in one sentence — a decision, a
problem solved, a direction changed. Null is the common answer.

promote adds a durable fact that the period made clear and the store lacks.

Doing nothing is a valid and frequent answer: {"merges":[],"episode":null,"promote":[]}.
Never invent a name you were not shown. Never include credentials.`;

interface Merge {
  into: string;
  supersedes: string[];
  description: string;
  content: string;
}

interface Promotion {
  type: MemoryType;
  name: string;
  description: string;
  content: string;
}

interface Episode {
  name: string;
  description: string;
  happened_at?: string;
  content: string;
}

export interface ConsolidationPlan {
  merges: Merge[];
  episode: Episode | null;
  promote: Promotion[];
}

export interface ConsolidateInput {
  projectPath: string;
  provider: string;
  model?: string;
  /** Index + diff + candidate bodies, assembled by the caller. */
  prompt: string;
  /** Names the model was actually shown; nothing else may be superseded. */
  shownNames: Set<string>;
  /** Episodes over the retention cap, deleted after a successful call. */
  overflowEpisodes?: string[];
  sessionId?: string;
  /** Test seam. */
  complete?: (system: string, prompt: string) => Promise<string>;
}

export interface ConsolidationResult {
  merged: number;
  promoted: number;
  episodes: number;
  deleted: number;
  /** False when nothing was applied — the caller must not advance the baseline. */
  ok: boolean;
}

const EMPTY: ConsolidationResult = {
  merged: 0,
  promoted: 0,
  episodes: 0,
  deleted: 0,
  ok: false,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Strictly validate the model's reply. Anything malformed yields null. */
export function parsePlan(raw: string): ConsolidationPlan | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const braced = body.match(/\{[\s\S]*\}/);
  if (!braced) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(braced[0]);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const merges: Merge[] = [];
  if (Array.isArray(parsed.merges)) {
    for (const m of parsed.merges) {
      if (!isRecord(m)) continue;
      const into = str(m.into);
      const description = str(m.description);
      const content = str(m.content);
      const supersedes = Array.isArray(m.supersedes)
        ? m.supersedes.map(str).filter((s): s is string => s !== null)
        : [];
      if (!into || !description || !content || supersedes.length === 0) continue;
      // Superseding yourself is a no-op that would delete the survivor.
      merges.push({
        into,
        supersedes: supersedes.filter((s) => s !== into),
        description,
        content,
      });
    }
  }

  const promote: Promotion[] = [];
  if (Array.isArray(parsed.promote)) {
    for (const p of parsed.promote) {
      if (!isRecord(p)) continue;
      const type = str(p.type);
      const name = str(p.name);
      const description = str(p.description);
      const content = str(p.content);
      if (!type || !name || !description || !content) continue;
      if (!(AUTHORABLE_MEMORY_TYPES as readonly string[]).includes(type)) {
        continue;
      }
      promote.push({
        type: type as MemoryType,
        name,
        description,
        content,
      });
    }
  }

  let episode: Episode | null = null;
  if (isRecord(parsed.episode)) {
    const name = str(parsed.episode.name);
    const description = str(parsed.episode.description);
    const content = str(parsed.episode.content);
    const happened = str(parsed.episode.happened_at);
    if (name && description && content) {
      episode = {
        name,
        description,
        content,
        ...(happened && /^\d{4}-\d{2}-\d{2}$/.test(happened)
          ? { happened_at: happened }
          : {}),
      };
    }
  }

  return { merges, episode, promote };
}

async function oneShot(
  input: ConsolidateInput,
  system: string,
  prompt: string,
): Promise<string> {
  const provider = getProvider(input.provider as ProviderId);
  if (!provider) throw new Error("no provider");
  const result = await provider.execute({
    prompt,
    system,
    model: input.model,
    quietModelFallback: true,
    maxTokens: 2048,
  });
  return result.content ?? "";
}

/**
 * Run one consolidation pass. Never throws.
 *
 * Failure of any kind — malformed JSON, a dead provider, a name we did not
 * send — degrades to "consolidated nothing" with `ok: false`, so the caller
 * leaves the git baseline and the lock where they were and the next run's diff
 * covers both windows.
 */
export async function consolidateMemories(
  input: ConsolidateInput,
): Promise<ConsolidationResult> {
  try {
    const complete = input.complete ?? ((s, p) => oneShot(input, s, p));
    const plan = parsePlan(await complete(SYSTEM, input.prompt));
    if (!plan) {
      logger.debug("[MemoryConsolidate] unparseable plan");
      return EMPTY;
    }

    const store = getMemoryStore(input.projectPath);
    const saved: Array<{ type: string; name: string }> = [];
    let merged = 0;
    let deleted = 0;

    for (const m of plan.merges.slice(0, MAX_MERGES)) {
      // The model cannot delete something it was never shown.
      const targets = m.supersedes.filter((n) => input.shownNames.has(n));
      if (targets.length === 0) continue;

      const existing = findByName(store.list(), m.into);
      if (!existing) continue;
      if (containsSecret(`${m.description}\n${m.content}`)) {
        // Refuse the write AND the deletions: dropping the originals for a
        // replacement we would not store is the one way to lose data here.
        logger.debug("[MemoryConsolidate] merge refused: secret in content");
        continue;
      }

      store.save({
        ...existing,
        description: m.description,
        content: m.content,
        supersedes: targets,
        updatedAt: Date.now(),
      });
      merged++;
      saved.push({ type: existing.type, name: existing.name });

      for (const name of targets) {
        const victim = findByName(store.list(), name);
        if (victim && store.delete(victim.name, victim.type)) deleted++;
      }
    }

    let promoted = 0;
    for (const p of plan.promote.slice(0, MAX_PROMOTES)) {
      if (containsSecret(`${p.description}\n${p.content}`)) continue;
      const existing = store.load(p.name, p.type);
      const now = Date.now();
      store.save({
        name: p.name,
        description: p.description,
        type: p.type,
        content: p.content,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      promoted++;
      saved.push({ type: p.type, name: p.name });
    }

    let episodes = 0;
    if (plan.episode && MAX_EPISODES_PER_RUN > 0) {
      const e = plan.episode;
      if (!containsSecret(`${e.description}\n${e.content}`)) {
        const now = Date.now();
        store.save({
          name: e.name,
          description: e.description,
          type: "episode",
          content: e.content,
          createdAt: now,
          updatedAt: now,
          ...(e.happened_at ? { happened_at: e.happened_at } : {}),
        });
        episodes++;
        saved.push({ type: "episode", name: e.name });
      }
    }

    // Retention (D6.2). Only after a successful call: the model was given these
    // and asked to fold anything durable in them into a semantic memory first,
    // so deleting them on a failed run would discard that chance.
    for (const name of input.overflowEpisodes ?? []) {
      if (store.delete(name, "episode")) deleted++;
    }

    // Tell the user, on the wire that already exists. Emitted on the bus rather
    // than the turn stream: consolidation finishes after the turn's `done`, so
    // the stream is closed by then.
    if (saved.length > 0 && input.sessionId) {
      BusEvents.memorySaved(input.sessionId, saved);
    }

    return { merged, promoted, episodes, deleted, ok: true };
  } catch (error) {
    logger.debug("[MemoryConsolidate] failed", { error });
    return EMPTY;
  }
}

function findByName(
  entries: MemoryEntry[],
  name: string,
): MemoryEntry | undefined {
  return entries.find((e) => e.name === name);
}
