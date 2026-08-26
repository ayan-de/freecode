// =============================================================================
// Runner — drives one case through the real agent loop and folds the result.
//
// Reuses `cli/commands/run.ts`'s boot path IN-PROCESS rather than shelling out
// to the binary, so a case can be stepped through in a debugger and the
// harness works from a source checkout without `pnpm build:bun`.
// =============================================================================

import { buildTrace, type Trace } from "../rollout/trace.js";
import { loadSessionEvents } from "../rollout/history.js";
import { createSandbox, insideSandbox, type Sandbox } from "./sandbox.js";
import type { JudgeConfig } from "./judge-config.js";
import type { EvalCase, RunRecord, TrialResult } from "./types.js";
import { scoreOutcome } from "./scorers/outcome.js";
import { scoreTrajectory } from "./scorers/trajectory.js";

export interface RunnerConfig {
  provider: string;
  model?: string;
  projectPath: string;
  /** Resolved judge, when one is configured and is not the model under test. */
  judge?: JudgeConfig;
}

/**
 * A trial that has not finished by now is not going to teach us anything, and
 * one dead case must not cost the other nineteen. Generous: the slowest honest
 * case observed is ~40s, and a case whose own `expectMaxTurns` is large can
 * legitimately take minutes.
 */
const TRIAL_TIMEOUT_MS = Number.isFinite(
  Number(process.env.FREECODE_EVAL_TRIAL_TIMEOUT_MS),
)
  ? Math.max(1_000, Number(process.env.FREECODE_EVAL_TRIAL_TIMEOUT_MS))
  : 300_000;

/** Boots providers + MCP once for the whole suite, not once per case. */
export async function initRunner(
  modelOverride?: string,
): Promise<RunnerConfig> {
  const { initProviders } = await import("../providers/index.js");
  const { initMcpServers } = await import("../mcp/index.js");
  const { readConfig } = await import("../providers/config.js");

  await initProviders();
  await initMcpServers();

  const config = readConfig();
  let provider = config.current?.provider;
  let model = config.current?.model;
  if (modelOverride) {
    const slash = modelOverride.indexOf("/");
    if (slash > 0) {
      provider = modelOverride.slice(0, slash);
      model = modelOverride.slice(slash + 1);
    } else {
      model = modelOverride;
    }
  }
  if (!provider) {
    throw new Error(
      "No provider configured. Set current.provider in ~/.freecode/config.json, " +
        "or pass --model <provider>/<model>.",
    );
  }
  return { provider, model, projectPath: process.cwd() };
}

/**
 * One trial. A case that pins `model` overrides the suite default — an
 * unpinned baseline silently reprices when a provider changes its default,
 * and a repriced baseline is worse than none because it looks like data.
 */
export async function runTrial(
  kase: EvalCase,
  config: RunnerConfig,
): Promise<TrialResult> {
  // A sandboxed case runs in a fresh tmpdir seeded from `files`, which becomes
  // its project root; an unsandboxed one runs in the real working directory
  // (and `dataset.ts` has already refused to let it mutate anything).
  const sandbox = kase.files ? createSandbox(kase.files) : undefined;
  try {
    return await runTrialIn(kase, config, sandbox);
  } finally {
    sandbox?.cleanup();
  }
}

async function runTrialIn(
  kase: EvalCase,
  config: RunnerConfig,
  sandbox: Sandbox | undefined,
): Promise<TrialResult> {
  const { getAppRuntime } = await import("../effect/runtime.js");
  const { createAgentLoopEffect } = await import("../agent/loop.js");
  const { getSessionManager } = await import("../session/index.js");
  const { answerPermission, bus, rejectPermission, rejectQuestion } =
    await import("../bus/index.js");

  const projectPath = sandbox?.dir ?? config.projectPath;

  let provider = config.provider;
  let model = config.model;
  if (kase.model) {
    const slash = kase.model.indexOf("/");
    if (slash > 0) {
      provider = kase.model.slice(0, slash);
      model = kase.model.slice(slash + 1);
    } else {
      model = kase.model;
    }
  }

  const manager = await getSessionManager();
  // Fresh session per trial: each gets its own rollout aggregate, and
  // therefore its own Trace. Sharing one would fold two runs into one span set.
  const sessionId = await manager.start(projectPath, provider);

  // The rollout log deliberately carries no message bodies (spec §5.2), so the
  // reply text is captured live here. Nothing scores it in Phase 1; the judge
  // (Phase 3) is its only consumer.
  let response = "";
  const unsubscribe = bus.subscribe("stream", (e) => {
    if (e.sessionId !== sessionId) return;
    if (e.event.type === "text_delta") response += e.event.delta;
  });

  // Play the part a frontend plays: answer the question, by declining it.
  //
  // Without this a case that makes the model call `question` ends the whole
  // SUITE. `askQuestion()` unref()s its 30-minute timer (`bus/index.ts`) so a
  // pending question cannot hold the event loop open, and headless there is
  // nothing else holding it — so node drains and exits **0** mid-run, with no
  // report written and no verdict. Under `--gate` that reads as a green CI job.
  // Rejecting is the honest headless answer, and the tool already recovers from
  // it ("You can continue without this information").
  let questionsRejected = 0;
  const unsubscribeQuestions = bus.subscribe("question.asked", (e) => {
    if (e.sessionId !== undefined && e.sessionId !== sessionId) return;
    questionsRejected++;
    rejectQuestion(e.requestId);
  });
  // Play the frontend's part for permission prompts too, but ONLY inside a
  // sandbox. `build` mode's default for a mutating tool is "ask", and a
  // headless ask resolves to DENY (`permission/prompt.ts`) — so without this
  // every coding case would score a model that was never allowed to write, and
  // the suite would measure the permission layer instead of the agent.
  //
  // Scoped, not blanket: a path argument that resolves outside the sandbox is
  // refused. Tools with no path argument — `bash` above all — are granted,
  // because a coding case needs to run its own checks, and because §6.3 is
  // already explicit that a tmpdir does not contain an agent holding a shell.
  // Nothing subscribes when the case has no sandbox, so an unsandboxed case
  // keeps Phase 1's behaviour exactly: headless ask, deny.
  const unsubscribePermissions = sandbox
    ? bus.subscribe("permission.asked", (e) => {
        if (e.sessionId !== undefined && e.sessionId !== sessionId) return;
        const target = (e.args.filePath ?? e.args.path ?? e.args.cwd) as
          | string
          | undefined;
        if (typeof target === "string" && !insideSandbox(sandbox.dir, target)) {
          rejectPermission(e.requestId);
          return;
        }
        answerPermission(e.requestId, { decision: "allow-once" });
      })
    : () => {};
  const cleanup = () => {
    unsubscribe();
    unsubscribeQuestions();
    unsubscribePermissions();
  };

  const startedAt = Date.now();
  try {
    const loop = await getAppRuntime().runPromise(
      createAgentLoopEffect(sessionId),
    );
    await Promise.race([
      getAppRuntime().runPromise(
        loop.runEffect({
          prompt: kase.prompt,
          sessionId,
          provider,
          model,
          projectPath,
          // A sandboxed case defaults to `build` (spec §6) — it has a tmpdir to
          // write in. An unsandboxed one defaults to read-only and `dataset.ts`
          // rejects any mutating override, because there `forbidTools` only
          // SCORES a mutation; it cannot prevent one. Mode enforcement can.
          agentMode: kase.agentMode ?? (sandbox ? "build" : "explore"),
        }),
      ),
      // The backstop for anything that blocks without a timeout of its own.
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`trial exceeded ${TRIAL_TIMEOUT_MS}ms`)),
          TRIAL_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
  } catch (err) {
    // An infrastructure failure is a failed trial, not a crashed suite: one
    // dead case must not cost the other nineteen.
    cleanup();
    return {
      passed: false,
      reason: `run failed: ${(err as Error).message}`.slice(0, 200),
      durationMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      repeatedCalls: 0,
      redirects: 0,
      redirectsSkipped: 0,
      questionsRejected,
      sessionId,
    };
  }
  cleanup();

  const recorded = loadSessionEvents(sessionId);
  if (!recorded) {
    return {
      passed: false,
      reason: "no rollout events recorded",
      durationMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      repeatedCalls: 0,
      redirects: 0,
      redirectsSkipped: 0,
      questionsRejected,
      sessionId,
    };
  }

  const trace = buildTrace(sessionId, recorded.events);
  const run: RunRecord = {
    trace,
    prompt: kase.prompt,
    response,
    sandboxDir: sandbox?.dir,
  };
  // Trajectory first: it is the cheaper verdict, and a run that hung or called
  // a forbidden tool should report THAT rather than whatever `verify` makes of
  // the wreckage.
  const trajectory = scoreTrajectory(run, kase);
  const score = trajectory.passed ? scoreOutcome(run, kase) : trajectory;

  // The judge runs LAST and only on a case that asked for one. It is the most
  // expensive and least trustworthy scorer here, so a case that already failed
  // objectively does not pay for an opinion about its prose.
  let judged: { score: number | null; reason: string } | undefined;
  if (kase.rubric) {
    if (!score.passed) {
      judged = { score: null, reason: "not judged: failed deterministically" };
    } else if (!config.judge) {
      judged = { score: null, reason: "not judged: no judge configured" };
    } else {
      const { scoreJudged } = await import("./scorers/judge.js");
      judged = await scoreJudged({ run, kase, judge: config.judge });
    }
  }

  const { JUDGE_CASE_FLOOR } = await import("./gate.js");
  const { totalUsd } = await import("../providers/pricing.js");

  // A judged case that scored below the floor is a failure; one the judge
  // could not answer for keeps the deterministic verdict, because an outage
  // must never fail a run (spec §7 constraint 3).
  const judgedOk =
    typeof judged?.score === "number" ? judged.score >= JUDGE_CASE_FLOOR : true;

  return {
    passed: score.passed && judgedOk,
    // An objective failure always reports itself: "not judged: failed
    // deterministically" tells you nothing about WHAT failed.
    reason: !score.passed
      ? score.reason
      : typeof judged?.score === "number"
        ? `${judged.score}/5 — ${judged.reason}`
        : (judged?.reason ?? score.reason),
    ...(kase.rubric ? { score: judged?.score ?? null } : {}),
    durationMs: Date.now() - startedAt,
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
    costUsd: totalUsd(trace.modelSpans)?.usd,
    turns: trace.modelSpans.length,
    repeatedCalls: countRepeatedCalls(trace),
    redirects: trace.redirects,
    redirectsSkipped: trace.redirectsSkipped,
    questionsRejected,
    sessionId,
  };
}

/**
 * How many tool calls repeated a signature already seen in this trial. Counts
 * the *redundant* ones, so six identical greps score 5 and a clean run scores 0
 * — the number that has to fall if redirection is working.
 *
 * A call whose opening `function.call` was lost has no args (`trace.ts`), so it
 * keys on the tool name alone rather than silently matching every other
 * argument-less call of the same tool.
 */
function countRepeatedCalls(trace: Trace): number {
  const seen = new Set<string>();
  let repeats = 0;
  for (const [index, span] of trace.toolSpans.entries()) {
    const key = span.args
      ? `${span.tool}:${JSON.stringify(span.args)}`
      : `${span.tool}:#${index}`;
    if (seen.has(key)) repeats++;
    else seen.add(key);
  }
  return repeats;
}
