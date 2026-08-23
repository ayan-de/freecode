// =============================================================================
// Runner — drives one case through the real agent loop and folds the result.
//
// Reuses `cli/commands/run.ts`'s boot path IN-PROCESS rather than shelling out
// to the binary, so a case can be stepped through in a debugger and the
// harness works from a source checkout without `pnpm build:bun`.
// =============================================================================

import { buildTrace } from "../rollout/trace.js";
import { loadSessionEvents } from "../rollout/history.js";
import type { EvalCase, RunRecord, TrialResult } from "./types.js";
import { scoreTrajectory } from "./scorers/trajectory.js";

export interface RunnerConfig {
  provider: string;
  model?: string;
  projectPath: string;
}

/** Boots providers + MCP once for the whole suite, not once per case. */
export async function initRunner(modelOverride?: string): Promise<RunnerConfig> {
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
  const { getAppRuntime } = await import("../effect/runtime.js");
  const { createAgentLoopEffect } = await import("../agent/loop.js");
  const { getSessionManager } = await import("../session/index.js");
  const { bus } = await import("../bus/index.js");

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
  const sessionId = await manager.start(config.projectPath, provider);

  // The rollout log deliberately carries no message bodies (spec §5.2), so the
  // reply text is captured live here. Nothing scores it in Phase 1; the judge
  // (Phase 3) is its only consumer.
  let response = "";
  const unsubscribe = bus.subscribe("stream", (e) => {
    if (e.sessionId !== sessionId) return;
    if (e.event.type === "text_delta") response += e.event.delta;
  });

  const startedAt = Date.now();
  try {
    const loop = await getAppRuntime().runPromise(
      createAgentLoopEffect(sessionId),
    );
    await getAppRuntime().runPromise(
      loop.runEffect({
        prompt: kase.prompt,
        sessionId,
        provider,
        model,
        projectPath: config.projectPath,
        // Read-only by default, and `dataset.ts` rejects mutating modes: until
        // the Tier 1 sandbox lands (spec §6.1) a case runs in the real working
        // directory, and `forbidTools` only SCORES a mutation — it cannot
        // prevent one. Mode enforcement can.
        agentMode: kase.agentMode ?? "explore",
      }),
    );
  } catch (err) {
    // An infrastructure failure is a failed trial, not a crashed suite: one
    // dead case must not cost the other nineteen.
    unsubscribe();
    return {
      passed: false,
      reason: `run failed: ${(err as Error).message}`.slice(0, 200),
      durationMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
  unsubscribe();

  const recorded = loadSessionEvents(sessionId);
  if (!recorded) {
    return {
      passed: false,
      reason: "no rollout events recorded",
      durationMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const trace = buildTrace(sessionId, recorded.events);
  const run: RunRecord = { trace, prompt: kase.prompt, response };
  const score = scoreTrajectory(run, kase);

  return {
    passed: score.passed,
    reason: score.reason,
    durationMs: Date.now() - startedAt,
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
  };
}
