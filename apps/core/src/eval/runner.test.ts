import test from "node:test";
import assert from "node:assert/strict";
import { applyEnv } from "./runner.js";

const KEY = "FREECODE_AUTO_COMPACT_TOKENS";

test("a case's env is applied for the trial and restored after it", () => {
  const original = process.env[KEY];
  try {
    process.env[KEY] = "999";
    const restore = applyEnv({ [KEY]: "25000" });
    assert.equal(process.env[KEY], "25000");
    restore();
    assert.equal(process.env[KEY], "999");
  } finally {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  }
});

test("a variable that was unset is DELETED again, not left empty", () => {
  // The compaction knobs treat "" as unset, but nothing guarantees the next
  // allowlisted key will — and a leaked variable silently reconfigures every
  // case that runs after this one.
  const original = process.env[KEY];
  try {
    delete process.env[KEY];
    const restore = applyEnv({ [KEY]: "25000" });
    restore();
    assert.equal(KEY in process.env, false);
  } finally {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  }
});

test("no env is a no-op, and its undo is safe to call", () => {
  const before = { ...process.env };
  applyEnv(undefined)();
  assert.deepEqual(Object.keys(process.env).sort(), Object.keys(before).sort());
});
