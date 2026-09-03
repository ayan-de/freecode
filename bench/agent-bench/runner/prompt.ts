// =============================================================================
// The task prompt. One string, identical for every agent.
//
// If this ever differs per agent, the benchmark stops comparing harnesses and
// starts comparing prompts we wrote for them (spec §10.3). It is a separate
// file so a change to it shows up in review as what it is: a change to the
// experiment.
// =============================================================================

import type { Instance } from "./types.js";

export function taskPrompt(inst: Instance): string {
  return [
    `You are working in a checkout of the ${inst.repo} repository.`,
    "",
    "Fix the issue reported below by editing the library source. When you are",
    "done, stop — do not commit, and do not open a pull request.",
    "",
    "Do not add or modify test files. The fix is graded by the project's own",
    "test suite, which is not present in this checkout.",
    "",
    "<issue>",
    inst.problemStatement.trim(),
    "</issue>",
  ].join("\n");
}
