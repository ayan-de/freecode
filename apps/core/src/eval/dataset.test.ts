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
