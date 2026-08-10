// =============================================================================
// Harness bridge — memory/skill entries write through the REAL stores
// PRIMARY: bridgeHarnessState, called after a distillation is applied.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md §4.4(b)
//
// Option (b), not (a): a distilled `memory` becomes a file in the project's
// memory store (so the existing graph/cascade indexes and retrieves it — the
// harness has no embeddings of its own and never will), and a distilled
// `skill` becomes a real `<name>/SKILL.md` the skills loader discovers (so the
// model can actually invoke it, instead of reading a note *about* a procedure
// it then re-derives). The harness store keeps the id, version and provenance;
// the bridged copy is the one the rest of the system reads.
//
// Bridged entries are marked `metadata.bridged` and then skipped by prompt
// injection (inject.ts) — otherwise a bridged memory rides in the request
// twice, once in the harness block and once in the memory block.
//
// Two deliberate limitations, both documented rather than designed around:
//  - **Global-scope memories are not bridged.** `mem-store` is per-project
//    (getMemoryBaseDir keys on the project path); there is no global memory
//    store to bridge into, and writing a global harness memory into whichever
//    project happened to be open would silently demote it to that project.
//    They stay harness-only and keep being injected, exactly as in Phase 3.
//    Skills have no such problem — `~/.freecode/skills` is a real global
//    location the loader already searches — so global skills DO bridge.
//  - **Migration rides the sweep, not a separate pass.** Every call re-bridges
//    any entry still lacking the mark, so entries written in Phases 2-4 migrate
//    the next time that scope distills. A harness that never distills again
//    never migrates; it also never changes, so nothing drifts.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getMemoryStore, type MemoryStore } from "../memory/mem-store.js";
import { logger } from "../utils/logger.js";
import { HARNESS_KINDS, type HarnessEntry, type HarnessState } from "./types.js";
import type { DistillResult } from "./types.js";

// Distilled memories land in `project` type: they are things learned about
// this codebase, which is what that type is for. Not user/feedback — the
// distillation prompt reasons about the session, not about the person.
const MEMORY_TYPE = "project" as const;
const BRIDGE_TAG = "distilled";

export interface BridgeContext {
  projectPath: string;
  /** Test seam. Defaults to the real per-project store. */
  memStore?: MemoryStore;
  /** Test seam. Defaults to `<projectPath>/.freecode/skills`. */
  repoSkillsDir?: string;
  /** Test seam. Defaults to `~/.freecode/skills`. */
  userSkillsDir?: string;
}

function repoSkills(ctx: BridgeContext): string {
  return ctx.repoSkillsDir ?? path.join(ctx.projectPath, ".freecode", "skills");
}

function userSkills(ctx: BridgeContext): string {
  return ctx.userSkillsDir ?? path.join(os.homedir(), ".freecode", "skills");
}

function skillDir(entry: { scope: string }, ctx: BridgeContext): string {
  return entry.scope === "global" ? userSkills(ctx) : repoSkills(ctx);
}

/** Filesystem-safe id, same rule mem-store applies to memory file names. */
function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function writeSkill(entry: HarnessEntry, ctx: BridgeContext): void {
  const dir = path.join(skillDir(entry, ctx), safeName(entry.id));
  fs.mkdirSync(dir, { recursive: true });
  const frontmatter = [
    "---",
    `name: ${safeName(entry.id)}`,
    `description: ${entry.title.replace(/\n/g, " ")}`,
    "---",
  ].join("\n");
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `${frontmatter}\n\n${entry.content}\n`,
    "utf-8",
  );
}

function removeSkill(
  id: string,
  scope: string,
  ctx: BridgeContext,
): void {
  const dir = path.join(skillDir({ scope }, ctx), safeName(id));
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Which entries this bridge is responsible for. See the global-memory note above. */
export function isBridgeable(entry: {
  kind: string;
  scope: string;
}): boolean {
  if (entry.kind === "skill") return true;
  return entry.kind === "memory" && entry.scope !== "global";
}

/**
 * Push applied deletes through to the real stores, then sweep every unbridged
 * memory/skill entry in `state` into them, marking each as it goes.
 *
 * Mutates `state` (the marks) — the caller saves it. Never throws: a bridge
 * failure must not lose a distillation that already applied cleanly, so a
 * failed write leaves the entry unmarked and it retries on the next sweep.
 */
export function bridgeHarnessState(
  state: HarnessState,
  result: DistillResult | undefined,
  ctx: BridgeContext,
): void {
  const store = ctx.memStore ?? getMemoryStore(ctx.projectPath);

  // Deletes first, and from the result rather than the state: a deleted entry
  // is already gone from `state`, so the sweep below can't see it.
  for (const edit of result?.appliedEdits ?? []) {
    if (!edit.applied || edit.action !== "delete" || !edit.before) continue;
    if (!isBridgeable(edit.before)) continue;
    if (edit.before.metadata?.bridged !== true) continue;
    try {
      if (edit.kind === "memory") store.delete(edit.id, MEMORY_TYPE);
      else removeSkill(edit.id, edit.before.scope, ctx);
    } catch (error) {
      logger.debug("[Distill] bridge delete failed", { id: edit.id, error });
    }
  }

  for (const kind of HARNESS_KINDS) {
    for (const entry of Object.values(state.entries[kind])) {
      if (!isBridgeable(entry) || entry.metadata.bridged === true) continue;
      try {
        if (kind === "memory") {
          const now = Date.now();
          store.save({
            name: safeName(entry.id),
            description: entry.title,
            type: MEMORY_TYPE,
            content: entry.content,
            createdAt: now,
            updatedAt: now,
            tags: [BRIDGE_TAG],
          });
        } else {
          writeSkill(entry, ctx);
        }
        // Marked only after the write succeeded, so a failure retries rather
        // than leaving an entry that claims to be bridged but isn't.
        entry.metadata.bridged = true;
      } catch (error) {
        logger.debug("[Distill] bridge write failed", { id: entry.id, error });
      }
    }
  }
}
