import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { DatasetError, parseSuite } from "./dataset.js";

const ok = `{"id":"a","prompt":"p","expectTool":"grep"}`;

test("parses one case per line, skipping blanks and comments", () => {
  const cases = parseSuite(
    `// header\n${ok}\n\n{"id":"b","prompt":"q","expectTool":null}\n`,
  );
  assert.equal(cases.length, 2);
  assert.equal(cases[0].id, "a");
  assert.equal(cases[1].expectTool, null);
});

test("rejects a case that asserts nothing", () => {
  // Such a case always passes, which is worse than useless: it inflates the
  // pass count and hides that the case was never finished.
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p"}`),
    (e: Error) =>
      e instanceof DatasetError && /asserts nothing/.test(e.message),
  );
});

test("rejects expectInArgs without expectTool", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p","expectInArgs":{"x":"y"}}`),
    (e: Error) =>
      e instanceof DatasetError && /requires 'expectTool'/.test(e.message),
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
        `{"id":"a","prompt":"p","expectTool":"grep","expectMaxTurns":0}`,
      ),
    (e: Error) => e instanceof DatasetError && /integer >= 1/.test(e.message),
  );
});

test("rejects a mutating agent mode while there is no sandbox", () => {
  // forbidTools scores a mutation; it cannot prevent one. Mode does.
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p","expectTool":"read","agentMode":"build"}`,
      ),
    (e: Error) => e instanceof DatasetError && /no sandbox/.test(e.message),
  );
});

test("allows a mutating mode once the case is sandboxed", () => {
  const [kase] = parseSuite(
    `{"id":"a","prompt":"p","agentMode":"build","files":{"a.mjs":"x"},"verify":"node a.mjs"}`,
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
        `{"id":"a","prompt":"p","agentMode":"danger","files":{"a.mjs":"x"},"verify":"node a.mjs"}`,
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
        `{"id":"a","prompt":"p","files":{"calc.mjs":"x"},"verify":"node check.mjs"}`,
      ),
    (e: Error) => e instanceof DatasetError && /never creates/.test(e.message),
  );
});

test("verify tolerates flags and quotes around the script name", () => {
  const [kase] = parseSuite(
    `{"id":"a","prompt":"p","files":{"check.mjs":"x"},"verify":"node --no-warnings ./check.mjs"}`,
  );
  assert.equal(kase.verify, "node --no-warnings ./check.mjs");
});

test("rejects verify without files", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p","verify":"node check.mjs"}`),
    (e: Error) =>
      e instanceof DatasetError && /requires 'files'/.test(e.message),
  );
});

test("rejects an immutable path that is not one of files", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p","files":{"a.mjs":"x"},"verify":"node a.mjs","immutable":["check.mjs"]}`,
      ),
    (e: Error) =>
      e instanceof DatasetError && /not one of 'files'/.test(e.message),
  );
});

test("rejects a fixture path that escapes the sandbox", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p","files":{"../escape.mjs":"x"},"expectMaxTurns":3}`,
      ),
    (e: Error) =>
      e instanceof DatasetError && /escapes the sandbox/.test(e.message),
  );
});

test("verify alone is a real assertion", () => {
  // Otherwise every coding case would need a redundant expectMaxTurns to load.
  const [kase] = parseSuite(
    `{"id":"a","prompt":"p","files":{"a.mjs":"x"},"verify":"node a.mjs"}`,
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
    () => parseSuite(`{"id":"a","prompt":"p","rubric":"no-such-rubric"}`),
    (e: Error) => e instanceof DatasetError && /no such rubric/.test(e.message),
  );
});

test("rejects a rubric given as a path", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p","rubric":"../../etc/passwd"}`),
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
