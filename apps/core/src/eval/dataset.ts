// =============================================================================
// Dataset loading + validation — one JSON object per line (spec §4).
//
// Validation is strict and happens BEFORE any token is spent: a malformed case
// that fails at scoring time reads as an agent failure, which is the most
// expensive kind of wrong answer this harness can give.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { EvalCase } from "./types.js";

export class DatasetError extends Error {}

/** Modes that can write to disk. Refused while there is no sandbox (§6.1). */
const MUTATING_MODES = new Set(["build", "danger"]);

/** Repo-relative `evals/` dir, overridable for tests and for installed use. */
export function evalsDir(): string {
  return process.env.FREECODE_EVALS_DIR ?? path.resolve("evals");
}

export function suitePath(suite: string): string {
  return path.join(evalsDir(), `${suite}.jsonl`);
}

export function loadSuite(suite: string): EvalCase[] {
  const file = suitePath(suite);
  if (!fs.existsSync(file)) {
    throw new DatasetError(`no such suite: ${file}`);
  }
  return parseSuite(fs.readFileSync(file, "utf-8"), file);
}

export function parseSuite(text: string, source = "<inline>"): EvalCase[] {
  const cases: EvalCase[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//")) continue;
    const where = `${source}:${i + 1}`;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      throw new DatasetError(`${where}: invalid JSON — ${(err as Error).message}`);
    }
    const kase = validate(raw, where);
    if (seen.has(kase.id)) {
      throw new DatasetError(`${where}: duplicate case id '${kase.id}'`);
    }
    seen.add(kase.id);
    cases.push(kase);
  }

  if (cases.length === 0) throw new DatasetError(`${source}: no cases`);
  return cases;
}

function validate(raw: unknown, where: string): EvalCase {
  if (typeof raw !== "object" || raw === null) {
    throw new DatasetError(`${where}: not an object`);
  }
  const o = raw as Record<string, unknown>;

  const id = o.id;
  if (typeof id !== "string" || !id.trim()) {
    throw new DatasetError(`${where}: 'id' is required`);
  }
  const prompt = o.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new DatasetError(`${where}: 'prompt' is required`);
  }

  // `expectInArgs` without `expectTool` can never be satisfied — there is no
  // tool whose arguments it could name. Reject at load, not at score time.
  if (o.expectInArgs !== undefined && o.expectTool == null) {
    throw new DatasetError(`${where}: 'expectInArgs' requires 'expectTool'`);
  }
  // A case that asserts nothing always passes, which is worse than useless:
  // it inflates the pass count and hides that the case was never finished.
  const asserts =
    o.expectTool !== undefined ||
    o.expectMaxTurns !== undefined ||
    (Array.isArray(o.forbidTools) && o.forbidTools.length > 0);
  if (!asserts) {
    throw new DatasetError(`${where}: case '${id}' asserts nothing`);
  }
  if (o.expectMaxTurns !== undefined) {
    const n = o.expectMaxTurns;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
      throw new DatasetError(`${where}: 'expectMaxTurns' must be an integer >= 1`);
    }
  }
  // Until the Tier 1 sandbox lands (spec §6.1) a case runs against the real
  // working directory. `forbidTools` is a SCORER, not a guard — by the time it
  // reports "called forbidden write" the file is already written. Agent mode is
  // the only thing that actually prevents the mutation, so mutating modes are
  // refused rather than trusted.
  if (o.agentMode !== undefined && MUTATING_MODES.has(o.agentMode as string)) {
    throw new DatasetError(
      `${where}: agentMode '${o.agentMode}' can modify the working directory; ` +
        `Phase 1 has no sandbox. Use plan/review/explore.`,
    );
  }

  return {
    id,
    prompt,
    model: typeof o.model === "string" ? o.model : undefined,
    agentMode: o.agentMode as EvalCase["agentMode"],
    expectTool: o.expectTool as EvalCase["expectTool"],
    expectInArgs: o.expectInArgs as EvalCase["expectInArgs"],
    expectMaxTurns: o.expectMaxTurns as number | undefined,
    forbidTools: Array.isArray(o.forbidTools)
      ? (o.forbidTools as string[])
      : undefined,
  };
}
