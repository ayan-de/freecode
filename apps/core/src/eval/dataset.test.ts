import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { DatasetError, parseSuite } from "./dataset.js";

const ok = `{"id":"a","prompt":"p","expectTool":"grep"}`;

test("parses one case per line, skipping blanks and comments", () => {
  const cases = parseSuite(`// header\n${ok}\n\n{"id":"b","prompt":"q","expectTool":null}\n`);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].id, "a");
  assert.equal(cases[1].expectTool, null);
});

test("rejects a case that asserts nothing", () => {
  // Such a case always passes, which is worse than useless: it inflates the
  // pass count and hides that the case was never finished.
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p"}`),
    (e: Error) => e instanceof DatasetError && /asserts nothing/.test(e.message),
  );
});

test("rejects expectInArgs without expectTool", () => {
  assert.throws(
    () => parseSuite(`{"id":"a","prompt":"p","expectInArgs":{"x":"y"}}`),
    (e: Error) => e instanceof DatasetError && /requires 'expectTool'/.test(e.message),
  );
});

test("rejects duplicate ids", () => {
  assert.throws(
    () => parseSuite(`${ok}\n${ok}`),
    (e: Error) => e instanceof DatasetError && /duplicate case id/.test(e.message),
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
    () => parseSuite(`{"id":"a","prompt":"p","expectTool":"grep","expectMaxTurns":0}`),
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
    (e: Error) => e instanceof DatasetError && /bypasses the permission/.test(e.message),
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
    (e: Error) => e instanceof DatasetError && /requires 'files'/.test(e.message),
  );
});

test("rejects an immutable path that is not one of files", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p","files":{"a.mjs":"x"},"verify":"node a.mjs","immutable":["check.mjs"]}`,
      ),
    (e: Error) => e instanceof DatasetError && /not one of 'files'/.test(e.message),
  );
});

test("rejects a fixture path that escapes the sandbox", () => {
  assert.throws(
    () =>
      parseSuite(
        `{"id":"a","prompt":"p","files":{"../escape.mjs":"x"},"expectMaxTurns":3}`,
      ),
    (e: Error) => e instanceof DatasetError && /escapes the sandbox/.test(e.message),
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
