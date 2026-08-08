import test from "node:test";
import assert from "node:assert/strict";
import { PruneState } from "./prune-state.js";

const c = (id: string, size: number) => ({ id, size });

test("an unseen candidate is fresh", () => {
  const state = new PruneState();
  const { fresh, frozen, mustReapply } = state.partition([c("a", 10)]);
  assert.equal(fresh.length, 1);
  assert.equal(frozen.length, 0);
  assert.equal(mustReapply.length, 0);
});

test("a candidate sent whole becomes frozen, not fresh", () => {
  const state = new PruneState();
  state.recordSeen("a");
  const { fresh, frozen } = state.partition([c("a", 10)]);
  assert.equal(fresh.length, 0);
  assert.equal(frozen.length, 1);
});

test("a replaced candidate carries its exact replacement forward", () => {
  const state = new PruneState();
  state.recordReplaced("a", "[omitted]");
  const { mustReapply, fresh, frozen } = state.partition([c("a", 10)]);
  assert.equal(fresh.length, 0);
  assert.equal(frozen.length, 0);
  assert.equal(mustReapply[0].replacement, "[omitted]");
});

test("recordSeen cannot demote an already-replaced candidate", () => {
  // Otherwise a replaced result would go back out at full size on a later
  // turn — a prefix change in the opposite direction, but just as expensive.
  const state = new PruneState();
  state.recordReplaced("a", "[omitted]");
  state.recordSeen("a");
  const { mustReapply, frozen } = state.partition([c("a", 10)]);
  assert.equal(mustReapply.length, 1);
  assert.equal(frozen.length, 0);
});

test("selectFreshToReplace does nothing while under budget", () => {
  const selected = PruneState.selectFreshToReplace([c("a", 50)], 10, 100);
  assert.deepEqual(selected, []);
});

test("selectFreshToReplace takes the largest first and stops at budget", () => {
  const fresh = [c("small", 10), c("huge", 500), c("mid", 100)];
  const selected = PruneState.selectFreshToReplace(fresh, 0, 100);
  assert.deepEqual(
    selected.map((s) => s.id),
    ["huge", "mid"],
    "largest first, and it stops as soon as the total fits",
  );
});

test("frozen bytes alone over budget are accepted, not forced", () => {
  // Nothing fresh can be replaced to fix this, and breaking the prefix to try
  // would cost more than the overage. Compaction reclaims it instead.
  const selected = PruneState.selectFreshToReplace([], 5_000, 100);
  assert.deepEqual(selected, []);
});

test("reset clears every prior decision", () => {
  const state = new PruneState();
  state.recordReplaced("a", "[omitted]");
  state.recordSeen("b");
  state.reset();
  const { fresh } = state.partition([c("a", 10), c("b", 10)]);
  assert.equal(fresh.length, 2);
});
