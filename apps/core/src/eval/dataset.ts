// =============================================================================
// Dataset loading + validation — one JSON object per line (spec §4).
//
// Validation is strict and happens BEFORE any token is spent: a malformed case
// that fails at scoring time reads as an agent failure, which is the most
// expensive kind of wrong answer this harness can give.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { assertSafeRelativePath, SandboxError } from "./sandbox.js";
import type { EvalCase } from "./types.js";

export class DatasetError extends Error {}

/** Modes that can write to disk. Allowed only for a sandboxed case (§6.1). */
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
  const expectFirstToolIn = validateFirstToolIn(o, where);
  const expectBashMatches = validateBashMatches(o.expectBashMatches, where);

  // A case that asserts nothing always passes, which is worse than useless:
  // it inflates the pass count and hides that the case was never finished.
  const asserts =
    o.expectTool !== undefined ||
    expectFirstToolIn !== undefined ||
    expectBashMatches !== undefined ||
    o.expectMaxTurns !== undefined ||
    o.verify !== undefined ||
    o.rubric !== undefined ||
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
  const files = validateFiles(o.files, where);
  const immutable = validateOutcome(o, files, where);
  const rubric = validateRubric(o.rubric, where);

  // A case with no `files` has no sandbox, so it runs against the real working
  // directory. There `forbidTools` is a SCORER, not a guard — by the time it
  // reports "called forbidden write" the file is already written. Agent mode is
  // the only thing that actually prevents the mutation, so mutating modes are
  // refused rather than trusted. A sandboxed case may mutate all it likes.
  //
  // `danger` stays refused either way: it bypasses the permission layer
  // entirely, and a sandboxed case does not need it — the runner answers the
  // prompts (`runner.ts`), so `build` already writes without stalling.
  if (o.agentMode !== undefined && MUTATING_MODES.has(o.agentMode as string)) {
    if (o.agentMode === "danger") {
      throw new DatasetError(
        `${where}: agentMode 'danger' bypasses the permission layer; ` +
          `a sandboxed case does not need it. Use build.`,
      );
    }
    if (!files) {
      throw new DatasetError(
        `${where}: agentMode '${o.agentMode}' can modify the working directory; ` +
          `a case with no 'files' has no sandbox. Use plan/review/explore.`,
      );
    }
  }

  return {
    id,
    prompt,
    model: typeof o.model === "string" ? o.model : undefined,
    agentMode: o.agentMode as EvalCase["agentMode"],
    expectTool: o.expectTool as EvalCase["expectTool"],
    expectFirstToolIn,
    expectInArgs: o.expectInArgs as EvalCase["expectInArgs"],
    expectBashMatches,
    expectMaxTurns: o.expectMaxTurns as number | undefined,
    forbidTools: Array.isArray(o.forbidTools)
      ? (o.forbidTools as string[])
      : undefined,
    files,
    verify: typeof o.verify === "string" ? o.verify : undefined,
    immutable,
    rubric,
  };
}

/**
 * `expectFirstToolIn` names the tools that may open the run. Spec
 * `2026-08-29-eval-case-registry.md` §3.
 *
 * `expectTool: null` asserts that nothing fired, so pairing the two states that
 * the run must both begin with a tool and contain none. Rejected at load rather
 * than scored as an unsatisfiable case.
 */
function validateFirstToolIn(
  o: Record<string, unknown>,
  where: string,
): string[] | undefined {
  const raw = o.expectFirstToolIn;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DatasetError(
      `${where}: 'expectFirstToolIn' must be a non-empty array of tool names`,
    );
  }
  for (const name of raw) {
    if (typeof name !== "string" || !name.trim()) {
      throw new DatasetError(
        `${where}: 'expectFirstToolIn' entries must be non-empty strings`,
      );
    }
  }
  if (o.expectTool === null) {
    throw new DatasetError(
      `${where}: 'expectFirstToolIn' contradicts 'expectTool: null' — ` +
        `one requires a first tool, the other requires none`,
    );
  }
  return raw as string[];
}

/**
 * Compiled at LOAD time. A bad pattern discovered at score time throws inside
 * the fold, after a real agent turn has been paid for, and reads as an agent
 * failure — the most expensive kind of wrong answer this harness can give.
 */
function validateBashMatches(
  raw: unknown,
  where: string,
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new DatasetError(`${where}: 'expectBashMatches' must be a non-empty string`);
  }
  try {
    new RegExp(raw);
  } catch (err) {
    throw new DatasetError(
      `${where}: 'expectBashMatches' is not a valid regex — ${(err as Error).message}`,
    );
  }
  return raw;
}

/**
 * A rubric must name a file that exists, checked at LOAD time. A missing
 * rubric discovered mid-run costs a real agent turn and then reports as a
 * judge outage — indistinguishable from a provider being down, and therefore
 * silently non-blocking. Wrong twice over.
 */
function validateRubric(raw: unknown, where: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new DatasetError(`${where}: 'rubric' must be a non-empty string`);
  }
  if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
    throw new DatasetError(
      `${where}: 'rubric' is a name under evals/rubrics/, not a path`,
    );
  }
  const file = path.join(evalsDir(), "rubrics", `${raw}.md`);
  if (!fs.existsSync(file)) {
    throw new DatasetError(`${where}: no such rubric: ${file}`);
  }
  return raw;
}

function validateFiles(
  raw: unknown,
  where: string,
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DatasetError(`${where}: 'files' must be an object`);
  }
  const files = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files)) {
    if (typeof content !== "string") {
      throw new DatasetError(`${where}: files['${rel}'] must be a string`);
    }
    try {
      assertSafeRelativePath(rel, where);
    } catch (err) {
      if (err instanceof SandboxError) throw new DatasetError(err.message);
      throw err;
    }
    out[rel] = content;
  }
  if (Object.keys(out).length === 0) {
    throw new DatasetError(`${where}: 'files' is empty`);
  }
  return out;
}

/**
 * Every file the case references must appear in `files`, INCLUDING the checker
 * (spec §4): a `verify` that runs a script the fixture never created fails for
 * the wrong reason and reads as an agent failure.
 */
function validateOutcome(
  o: Record<string, unknown>,
  files: Record<string, string> | undefined,
  where: string,
): string[] | undefined {
  const verify = o.verify;
  if (verify !== undefined) {
    if (typeof verify !== "string" || !verify.trim()) {
      throw new DatasetError(`${where}: 'verify' must be a non-empty string`);
    }
    if (!files) {
      throw new DatasetError(`${where}: 'verify' requires 'files' (no sandbox)`);
    }
    for (const ref of referencedFiles(verify)) {
      if (!(ref in files)) {
        throw new DatasetError(
          `${where}: verify runs '${ref}', which 'files' never creates`,
        );
      }
    }
  }

  const immutable = o.immutable;
  if (immutable === undefined) return undefined;
  if (!Array.isArray(immutable) || immutable.some((x) => typeof x !== "string")) {
    throw new DatasetError(`${where}: 'immutable' must be an array of strings`);
  }
  for (const rel of immutable as string[]) {
    if (!files || !(rel in files)) {
      throw new DatasetError(
        `${where}: immutable '${rel}' is not one of 'files'`,
      );
    }
  }
  return immutable as string[];
}

/**
 * Script paths a `verify` command names. Deliberately narrow — a token that
 * ends in a script extension and is not a flag. Broadening this to "anything
 * path-shaped" would reject `node --test`, and a load-time check with false
 * positives is one that gets deleted.
 */
const SCRIPT_TOKEN = /\.(mjs|cjs|js|json)$/;

export function referencedFiles(verify: string): string[] {
  const out: string[] = [];
  for (const raw of verify.split(/\s+/)) {
    const token = raw.replace(/^["']|["']$/g, "");
    if (!token || token.startsWith("-")) continue;
    if (!SCRIPT_TOKEN.test(token)) continue;
    out.push(token.replace(/^\.\//, ""));
  }
  return out;
}
