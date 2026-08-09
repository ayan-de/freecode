// =============================================================================
// Memory extraction - mine a finished turn for durable facts.
// Runs at natural completion, fire-and-forget, and never throws into the loop
// (spec 2026-08-09-memory-write-path.md, D5).
// =============================================================================

import { getProvider } from "../providers/index.js";
import type { ProviderId } from "../providers/index.js";
import { getMemoryStore } from "./mem-store.js";
import { MEMORY_TYPES, type MemoryType } from "./mem-types.js";
import { containsSecret } from "./graph/secret-filter.js";
import { logger } from "../utils/logger.js";

// A runaway extractor fills the store with noise faster than anything cleans it
// up, and there is no consolidation pass yet. Bound it hard.
export const MAX_SAVES_PER_RUN = 3;

// Enough transcript to judge durability without paying for a whole session.
const MAX_TRANSCRIPT_CHARS = 12_000;

const SYSTEM = `You extract durable memories from a coding session.

Return ONLY a JSON array, no prose. Each element:
{"type": "user|feedback|project|reference", "name": "kebab-case-slug", "description": "one specific line", "content": "the memory"}

Save only what will still be true next week:
- user: who they are, how they like to work
- feedback: guidance they gave you; add **Why:** and **How to apply:** lines
- project: decisions, constraints, deadlines not derivable from the code
- reference: pointers to external systems

Never save: anything derivable from the code, git history, or project docs; how a
bug was fixed; task details that stop mattering when this task ends; credentials.

Most turns contain nothing worth saving. Returning [] is the common, correct
answer — prefer it over a weak memory. Never return more than ${MAX_SAVES_PER_RUN}.`;

export interface ExtractInput {
  transcript: string;
  projectPath: string;
  provider: string;
  model?: string;
  /** Test seam; defaults to a one-shot provider call. */
  complete?: (system: string, prompt: string) => Promise<string>;
}

interface Proposal {
  type: MemoryType;
  name: string;
  description: string;
  content: string;
}

// Models wrap JSON in prose or a fence however much you ask them not to.
function parseProposals(raw: string): Proposal[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Proposal[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type.toLowerCase() : "";
    if (!(MEMORY_TYPES as readonly string[]).includes(type)) continue;
    if (
      typeof p.name !== "string" ||
      typeof p.description !== "string" ||
      typeof p.content !== "string"
    ) {
      continue;
    }
    const name = p.name.trim();
    const description = p.description.trim();
    const content = p.content.trim();
    if (!name || !description || !content) continue;
    out.push({ type: type as MemoryType, name, description, content });
  }
  return out;
}

async function oneShot(
  input: ExtractInput,
  system: string,
  prompt: string,
): Promise<string> {
  const provider = getProvider(input.provider as ProviderId);
  if (!provider) return "";
  const result = await provider.execute({
    prompt,
    system,
    model: input.model,
    maxTokens: 1024,
  });
  return result.content ?? "";
}

/**
 * Extract and save durable memories from a finished turn.
 * Returns how many were saved. Never throws — a memory failure must be
 * invisible to the user's task.
 */
export async function extractMemories(input: ExtractInput): Promise<number> {
  try {
    const transcript = input.transcript.trim();
    if (transcript.length === 0) return 0;

    const complete = input.complete ?? ((s, p) => oneShot(input, s, p));
    const raw = await complete(
      SYSTEM,
      `Session transcript:\n\n${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`,
    );

    const proposals = parseProposals(raw);
    if (proposals.length === 0) return 0;

    const store = getMemoryStore(input.projectPath);
    let saved = 0;
    for (const p of proposals) {
      if (saved >= MAX_SAVES_PER_RUN) break;
      // Same rule as the tool (D4): credentials are never written to disk.
      if (containsSecret(`${p.description}\n${p.content}`)) continue;

      const existing = store.load(p.name, p.type);
      // Nothing changed — skip rather than churn the file's mtime and force a
      // pointless re-embed through onMemoryChange.
      if (
        existing &&
        existing.content === p.content &&
        existing.description === p.description
      ) {
        continue;
      }

      const now = Date.now();
      store.save({
        name: p.name,
        description: p.description,
        type: p.type,
        content: p.content,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      saved++;
    }
    return saved;
  } catch (error) {
    logger.debug("[MemoryExtract] extraction failed", { error });
    return 0;
  }
}
