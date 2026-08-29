import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { DatasetError, parseSuite } from "./dataset.js";
import { FAILURE_CATEGORIES } from "./types.js";
import type { EvalCase, FailureCategory } from "./types.js";

// Every case now needs a category and a justification. Neither says anything
// about what these tests actually check, so they are injected rather than
// repeated in twenty-odd fixtures.
const REQUIRED = `"failureCategory":"tool-routing","whyModelBacked":"w"`;

const ok = `{"id":"a","prompt":"p",${REQUIRED},${REQUIRED},"expectTool":"grep"}`;

test("parses one case per line, skipping blanks and comments", () => {
  const cases = parseSuite(
    `// header\n${ok}\n\n{"id":"b","prompt":"q",${REQUIRED},"expectTool":null}\n`,
  );
  assert.equal(cases.length, 2);
  assert.equal(cases[0].id, "a");
  assert.equal(cases[1].expectTool, null);
});

test("rejects a case that asserts nothing", () => {
  // Such a case always passes, which is worse than useless: it inflates the
  // pass count and hides that the case was never finished.
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p",${REQUIRED}}`),
    (e: Error) =>
      e instanceof DatasetError && /asserts nothing/.test(e.message),
  );
});

test("rejects expectInArgs without expectTool", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p",${REQUIRED},"expectInArgs":{"x":"y"}}`),
    (e: Error) =>
      e instanceof DatasetError && /requires 'expectTool'/.test(e.message),
  );
});

test("expectFirstToolIn and expectBashMatches each count as an assertion", () => {
  const cases = parseSuite(
    `{"id":"a","prompt":"p",${REQUIRED},"expectFirstToolIn":["grep","glob"]}\n` +
      `{"id":"b","prompt":"p",${REQUIRED},"expectBashMatches":"^git\\\\b"}`,
  );
  assert.deepEqual(cases[0].expectFirstToolIn, ["grep", "glob"]);
  assert.equal(cases[1].expectBashMatches, "^git\\b");
});

test("rejects an empty or non-string expectFirstToolIn", () => {
  for (const bad of ["[]", '"grep"', "[1]", '[""]']) {
    assert.throws(
      () => parseSuite(`{"id":"a","prompt":"p",${REQUIRED},"expectFirstToolIn":${bad}}`),
      (e: Error) =>
        e instanceof DatasetError && /expectFirstToolIn/.test(e.message),
      `should reject expectFirstToolIn: ${bad}`,
    );
  }
});

test("rejects expectFirstToolIn alongside expectTool null", () => {
  // One requires a first tool, the other requires none: unsatisfiable, so it is
  // a load error rather than a case that reports a false red every run.
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"expectTool":null,"expectFirstToolIn":["grep"]}`,
      ),
    (e: Error) => e instanceof DatasetError && /contradicts/.test(e.message),
  );
});

test("rejects an uncompilable expectBashMatches at load, not at score time", () => {
  // A bad pattern discovered mid-fold throws after a real turn has been paid
  // for, and reads as an agent failure.
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p",${REQUIRED},"expectBashMatches":"git ("}`),
    (e: Error) => e instanceof DatasetError && /not a valid regex/.test(e.message),
  );
});

test("rejects duplicate ids", () => {
  assert.throws(
    () => parseSuite(`${ok}\n${ok}`),
    (e: Error) =>
      e instanceof DatasetError && /duplicate case id/.test(e.message),
  );
});

test("rejects malformed JSON with the line number", () => {
  assert.throws(
    () => parseSuite(`${ok}\n{oops`, "suite.jsonl"),
    (e: Error) => e instanceof DatasetError && /suite\.jsonl:2/.test(e.message),
  );
});

test("rejects a non-integer expectMaxTurns", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"expectTool":"grep","expectMaxTurns":0}`,
      ),
    (e: Error) => e instanceof DatasetError && /integer >= 1/.test(e.message),
  );
});

test("rejects a mutating agent mode while there is no sandbox", () => {
  // forbidTools scores a mutation; it cannot prevent one. Mode does.
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"expectTool":"read","agentMode":"build"}`,
      ),
    (e: Error) => e instanceof DatasetError && /no sandbox/.test(e.message),
  );
});

test("allows a mutating mode once the case is sandboxed", () => {
  const [kase] = parseSuite(
    `{"id":"a","prompt":"p",${REQUIRED},"agentMode":"build","files":{"a.mjs":"x"},"verify":"node a.mjs"}`,
  );
  assert.equal(kase.agentMode, "build");
  assert.deepEqual(kase.files, { "a.mjs": "x" });
});

test("rejects danger even in a sandbox", () => {
  // It bypasses the permission layer, and a sandboxed case does not need it:
  // the runner answers build mode's prompts.
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"agentMode":"danger","files":{"a.mjs":"x"},"verify":"node a.mjs"}`,
      ),
    (e: Error) =>
      e instanceof DatasetError && /bypasses the permission/.test(e.message),
  );
});

test("rejects a verify that runs a file the fixture never creates", () => {
  // Such a case fails for the wrong reason and reads as an agent failure.
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"files":{"calc.mjs":"x"},"verify":"node check.mjs"}`,
      ),
    (e: Error) => e instanceof DatasetError && /never creates/.test(e.message),
  );
});

test("verify tolerates flags and quotes around the script name", () => {
  const [kase] = parseSuite(
    `{"id":"a","prompt":"p",${REQUIRED},"files":{"check.mjs":"x"},"verify":"node --no-warnings ./check.mjs"}`,
  );
  assert.equal(kase.verify, "node --no-warnings ./check.mjs");
});

test("rejects verify without files", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p",${REQUIRED},"verify":"node check.mjs"}`),
    (e: Error) =>
      e instanceof DatasetError && /requires 'files'/.test(e.message),
  );
});

test("rejects an immutable path that is not one of files", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"files":{"a.mjs":"x"},"verify":"node a.mjs","immutable":["check.mjs"]}`,
      ),
    (e: Error) =>
      e instanceof DatasetError && /not one of 'files'/.test(e.message),
  );
});

test("rejects a fixture path that escapes the sandbox", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"files":{"../escape.mjs":"x"},"expectMaxTurns":3}`,
      ),
    (e: Error) =>
      e instanceof DatasetError && /escapes the sandbox/.test(e.message),
  );
});

test("verify alone is a real assertion", () => {
  // Otherwise every coding case would need a redundant expectMaxTurns to load.
  const [kase] = parseSuite(
    `{"id":"a","prompt":"p",${REQUIRED},"files":{"a.mjs":"x"},"verify":"node a.mjs"}`,
  );
  assert.equal(kase.verify, "node a.mjs");
});

test("the shipped trajectory suite is valid", () => {
  // The dataset is data, so nothing else type-checks it. A typo there would
  // otherwise surface as a failed agent run rather than a broken case.
  const file = path.resolve(
    import.meta.dirname,
    "../../../../evals/trajectory.jsonl",
  );
  const cases = parseSuite(fs.readFileSync(file, "utf-8"), file);
  assert.ok(cases.length >= 20, `expected >= 20 cases, got ${cases.length}`);
});

test("the shipped judged suite is valid and every rubric it names exists", () => {
  // A rubric missing at run time reports as a judge outage — indistinguishable
  // from a provider being down, and therefore silently non-blocking.
  const evals = path.resolve(import.meta.dirname, "../../../../evals");
  const prev = process.env.FREECODE_EVALS_DIR;
  process.env.FREECODE_EVALS_DIR = evals;
  try {
    const file = path.join(evals, "judged.jsonl");
    const cases = parseSuite(fs.readFileSync(file, "utf-8"), file);
    assert.ok(cases.length >= 4, `expected >= 4 cases, got ${cases.length}`);
    for (const kase of cases) {
      assert.ok(kase.rubric, `${kase.id}: judged cases need a rubric`);
      assert.ok(
        fs.existsSync(path.join(evals, "rubrics", `${kase.rubric}.md`)),
        `${kase.id}: rubric ${kase.rubric}.md is missing`,
      );
    }
  } finally {
    if (prev === undefined) delete process.env.FREECODE_EVALS_DIR;
    else process.env.FREECODE_EVALS_DIR = prev;
  }
});

test("rejects a rubric that does not exist", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p",${REQUIRED},"rubric":"no-such-rubric"}`),
    (e: Error) => e instanceof DatasetError && /no such rubric/.test(e.message),
  );
});

test("rejects a rubric given as a path", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p",${REQUIRED},"rubric":"../../etc/passwd"}`),
    (e: Error) => e instanceof DatasetError && /not a path/.test(e.message),
  );
});

test("the shipped coding suite is valid, sandboxed, and guards its checkers", () => {
  const file = path.resolve(
    import.meta.dirname,
    "../../../../evals/coding.jsonl",
  );
  const cases = parseSuite(fs.readFileSync(file, "utf-8"), file);
  assert.ok(cases.length >= 5, `expected >= 5 cases, got ${cases.length}`);
  for (const kase of cases) {
    assert.ok(kase.files, `${kase.id}: coding cases must be sandboxed`);
    assert.ok(kase.verify, `${kase.id}: coding cases must verify`);
    // A coding case whose checker is not immutable can go green by editing it.
    assert.ok(
      kase.immutable?.length,
      `${kase.id}: coding cases must mark their checker immutable`,
    );
  }
});

test("every expectInArgs key names a parameter its tool actually declares", async () => {
  // The bug this exists to prevent: three shipped cases asserted `file_path`
  // while `read` declares `filePath`, so they could never match and had failed
  // every run since they were written. Nothing complained — a key that names
  // nothing simply never matches, and the suite reported the AGENT as worse
  // than it was. A scorer that lies in this direction is as bad as one that
  // lies in the other; it just gets ignored instead of trusted.
  //
  // A test rather than a `dataset.ts` check on purpose: this needs the tool
  // registry, `dataset.ts` is pure fs + JSON today, and the failure is worth
  // catching at commit time rather than after a run that costs money.
  const { tools } = await import("../tools/index.js");
  const dir = path.resolve(import.meta.dirname, "../../../../evals");
  // `parseSuite` resolves a case's rubric against `evalsDir()`, which is
  // cwd-relative — and the cwd here is apps/core, not the repo root.
  const previous = process.env.FREECODE_EVALS_DIR;
  process.env.FREECODE_EVALS_DIR = dir;

  try {
    for (const file of fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))) {
      for (const kase of parseSuite(
        fs.readFileSync(path.join(dir, file), "utf-8"),
        file,
      )) {
        if (!kase.expectInArgs || !kase.expectTool) continue;
        // Only built-ins: an MCP tool is registered at runtime and has no schema
        // to check against here.
        const tool = (
          tools as Record<
            string,
            {
              schemas: { parameters: { properties?: Record<string, unknown> } };
            }
          >
        )[kase.expectTool];
        if (!tool) continue;
        const declared = Object.keys(tool.schemas.parameters.properties ?? {});
        for (const key of Object.keys(kase.expectInArgs)) {
          assert.ok(
            declared.includes(key),
            `${file}: case '${kase.id}' expects arg '${key}' on tool '${kase.expectTool}', ` +
              `which declares only: ${declared.join(", ")}`,
          );
        }
      }
    }
  } finally {
    if (previous === undefined) delete process.env.FREECODE_EVALS_DIR;
    else process.env.FREECODE_EVALS_DIR = previous;
  }
});

// ---------------------------------------------------------------------------
// Registry assertions — spec `2026-08-29-eval-case-registry.md` §7.
//
// These cost nothing and run on every commit. fx does the same thing: its
// `agent-quality-matrix.test.ts` tests the REGISTRY, not the agent, and is the
// cheapest test in that repo.
// ---------------------------------------------------------------------------

/** Loads every shipped suite with `evalsDir()` pointed at the repo's `evals/`. */
function allShippedCases(): Array<{ file: string; cases: EvalCase[] }> {
  const dir = path.resolve(import.meta.dirname, "../../../../evals");
  const previous = process.env.FREECODE_EVALS_DIR;
  process.env.FREECODE_EVALS_DIR = dir;
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((file) => ({
        file,
        cases: parseSuite(fs.readFileSync(path.join(dir, file), "utf-8"), file),
      }));
  } finally {
    if (previous === undefined) delete process.env.FREECODE_EVALS_DIR;
    else process.env.FREECODE_EVALS_DIR = previous;
  }
}

test("rejects a case with no failureCategory, or one outside the closed set", () => {
  for (const bad of ["", '"prompt-stuff"', "null", "3"]) {
    const field = bad === "" ? "" : `,"failureCategory":${bad}`;
    assert.throws(
      () =>
        parseSuite(
          `{"id":"a","prompt":"p","whyModelBacked":"w","expectTool":"grep"${field}}`,
        ),
      (e: Error) =>
        e instanceof DatasetError && /failureCategory/.test(e.message),
      `should reject failureCategory: ${bad || "<missing>"}`,
    );
  }
});

test("rejects a case that does not say why it needs a real model", () => {
  // The rule that a non-model test belongs in a *.test.ts was prose in
  // CLAUDE.md with nothing enforcing it.
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p","failureCategory":"tool-routing","whyModelBacked":"  ","expectTool":"grep"}`,
      ),
    (e: Error) => e instanceof DatasetError && /whyModelBacked/.test(e.message),
  );
});

test("rejects a knownGap whose notes and target are the same string", () => {
  // With one field doing both jobs the aspiration gets written into the status
  // and the gap vanishes from the record without anyone fixing it.
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"expectTool":"grep",` +
          `"knownGap":{"status":"known-gap","notes":"same","target":"same"}}`,
      ),
    (e: Error) => e instanceof DatasetError && /the same string/.test(e.message),
  );
});

test("accepts a knownGap that separates observation from aspiration", () => {
  const [kase] = parseSuite(
    `{"id":"a","prompt":"p",${REQUIRED},"expectTool":"grep",` +
      `"knownGap":{"status":"partial","notes":"opens with websearch","target":"opens with grep"}}`,
  );
  assert.equal(kase.knownGap?.status, "partial");
});

test("rejects an unknown knownGap status", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p",${REQUIRED},"expectTool":"grep",` +
          `"knownGap":{"status":"broken","notes":"a","target":"b"}}`,
      ),
    (e: Error) => e instanceof DatasetError && /knownGap.status/.test(e.message),
  );
});

test("every shipped case explains why it needs a real model", () => {
  for (const { file, cases } of allShippedCases()) {
    for (const kase of cases) {
      assert.ok(
        kase.whyModelBacked.trim().length > 20,
        `${file}: case '${kase.id}' has a whyModelBacked too short to mean anything`,
      );
    }
  }
});

test("case ids are unique ACROSS suites, not just within one", () => {
  // `parseSuite` only sees one file, so harvesting into the wrong suite can
  // produce a collision no loader catches — and `eval_runs.jsonl` keys the
  // baseline's green set by id alone.
  const seen = new Map<string, string>();
  for (const { file, cases } of allShippedCases()) {
    for (const kase of cases) {
      const first = seen.get(kase.id);
      assert.ok(
        first === undefined,
        `case id '${kase.id}' appears in both ${first} and ${file}`,
      );
      seen.set(kase.id, file);
    }
  }
});

// Every category with no case today. Kept as a golden list rather than an
// `assert(covered)`: the empty ones ARE the finding — we have code for recovery,
// compaction boundaries, resume and memory recall and no eval touching any of
// it — and failing the build over that would just get the categories deleted,
// which destroys the very signal the closed set exists to give. As a golden
// list, adding the first case in a category fails this test and you delete the
// line; removing the last case fails it and you notice.
// The four left are not "unwritten" — they are UNREACHABLE for a harness that
// drives exactly one `loop.runEffect({ prompt })` per trial (`runner.ts`) and
// seeds nothing but a tmpdir of files. Each needs a harness change first, named
// in the spec's §9 Phase 4 row:
//   compaction-boundary  needs a turn long enough to compact — not deterministic
//   memory-recall        needs a seeded memory dir; `files` cannot escape the sandbox
//   resume               needs a prior session to resume from
//   mcp-failure          needs a fixture MCP server; `initMcpServers()` reads real config
const CATEGORIES_WITHOUT_CASES: FailureCategory[] = [
  "compaction-boundary",
  "memory-recall",
  "resume",
  "mcp-failure",
];

test("coverage by failure category is what we think it is", () => {
  const covered = new Set(
    allShippedCases().flatMap(({ cases }) => cases.map((c) => c.failureCategory)),
  );
  const empty = FAILURE_CATEGORIES.filter((c) => !covered.has(c));
  assert.deepEqual(
    [...empty],
    CATEGORIES_WITHOUT_CASES,
    "coverage changed — update CATEGORIES_WITHOUT_CASES to match, and say so in review",
  );
});
