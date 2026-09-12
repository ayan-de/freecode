// =============================================================================
// The task prompt. One string, identical for every agent — same rule as
// bench/agent-bench/runner/prompt.ts, for the same reason: a per-agent prompt
// compares prompts we wrote, not harnesses.
//
// It says nothing an agent could not read in the task's own spec.md. The one
// addition is the stopping rule, because the benchmark has no time limit and
// an agent has to be told that stopping is its own call.
// =============================================================================

export function taskPrompt(task: string): string {
  return [
    `You are in the working directory of the "${task}" optimisation task.`,
    "",
    "Read spec.md. You are given a working, tested implementation in",
    "submission/. Make it faster. It must stay correct on every input — the",
    "verifier checks exhaustively, and a submission that fails verification",
    "has no score at all.",
    "",
    "Run ./grade to build, verify, measure and score the current submission.",
    "It takes seconds. The score is log2(given_cost / your_cost): doublings of",
    "improvement under the published cost model. Every grade is recorded.",
    "",
    "Rules: edit only files under submission/. Do not touch verify/, grade, or",
    "anything outside submission/. The function must be self-contained C — no",
    "external processes or libraries.",
    "",
    "Keep improving for as long as you can find improvements. Verify with",
    "./grade after every change. When you are confident the submission is",
    "correct and you have no further ideas, stop.",
  ].join("\n");
}
