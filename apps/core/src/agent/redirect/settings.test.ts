import test from "node:test";
import assert from "node:assert/strict";
import { effectiveRedirectCap } from "./settings.js";
import { REDIRECT_MAX_PER_RUN } from "./policy.js";
import { DEFAULT_RUN_LIMITS } from "../../autonomous/types.js";

const settings = { enabled: true, maxPerRun: REDIRECT_MAX_PER_RUN };

test("an interactive run uses the settings cap", () => {
  assert.equal(effectiveRedirectCap(settings), REDIRECT_MAX_PER_RUN);
  assert.equal(effectiveRedirectCap(settings, undefined), REDIRECT_MAX_PER_RUN);
});

test("a run budget lowers the cap", () => {
  assert.equal(effectiveRedirectCap({ ...settings, maxPerRun: 5 }, 1), 1);
});

test("a run budget cannot RAISE the cap above the user's setting", () => {
  // The budget says how much a run may spend, not how much the user wanted to
  // allow. Starting a run must not quietly buy more recovery than configured.
  assert.equal(effectiveRedirectCap({ ...settings, maxPerRun: 1 }, 99), 1);
});

test("a zero budget disables redirection for that run", () => {
  assert.equal(effectiveRedirectCap(settings, 0), 0);
});

test("a negative budget clamps to zero rather than going strange", () => {
  assert.equal(effectiveRedirectCap(settings, -3), 0);
});

test("the default run budget matches the interactive default", () => {
  // Not a coincidence worth breaking silently: an unattended run gets the same
  // allowance as an attended one unless its budget says otherwise.
  assert.equal(DEFAULT_RUN_LIMITS.maxRedirects, REDIRECT_MAX_PER_RUN);
});

test("a budget never switches redirection on", () => {
  // `enabled` is untouched by the cap resolution — a user who turned the
  // feature off must not have it turned back on by starting a run.
  const off = { enabled: false, maxPerRun: 2 };
  assert.equal(effectiveRedirectCap(off, 2), 2, "the cap resolves...");
  assert.equal(off.enabled, false, "...but says nothing about whether it runs");
});
