// =============================================================================
// Autonomous Runs Child Entrypoint — boots the real backend, drives a real run
// PRIMARY: runAutonomousChild() is what the detached child process (spawned by
// `freecode autonomous start`, see cli/commands/autonomous.ts) actually runs.
// Boot sequence mirrors cli/commands/run.ts exactly (same providers/MCP/Effect
// runtime init, same createAgentLoopEffect construction) — the difference is
// what happens after boot: instead of one prompt, runAutonomous.ts drives the
// loop turn after turn against the gate until budget or the gate stops it.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md §4.4(a), §4.9
// =============================================================================

import type { TurnResult, TurnRunner } from "./runner.js";
import { runAutonomous } from "./runner.js";
import { loadRunManifest, saveRunManifest } from "./run-store.js";

export async function runAutonomousChild(
  runId: string,
  modelOverride?: string,
): Promise<void> {
  const manifest = loadRunManifest(runId);
  if (!manifest) {
    console.error(`[autonomous:${runId}] manifest not found, exiting`);
    process.exitCode = 1;
    return;
  }
  const worktreePath = manifest.worktreePath ?? process.cwd();

  const { initProviders } = await import("../providers/index.js");
  const { initMcpServers } = await import("../mcp/index.js");
  const { readConfig } = await import("../providers/config.js");
  const { getAppRuntime } = await import("../effect/runtime.js");
  const { createAgentLoopEffect } = await import("../agent/loop.js");
  const { getSessionManager } = await import("../session/index.js");

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
    console.error(
      `[autonomous:${runId}] no provider configured, cannot start`,
    );
    manifest.status = "failed";
    saveRunManifest(manifest);
    process.exitCode = 1;
    return;
  }

  const manager = await getSessionManager();
  const sessionId = await manager.start(worktreePath, provider);

  const loop = await getAppRuntime().runPromise(
    createAgentLoopEffect(sessionId, { maxIterations: 250 }),
  );

  const turnRunner: TurnRunner = {
    async runTurn(prompt: string): Promise<TurnResult> {
      try {
        const result = await getAppRuntime().runPromise(
          loop.runEffect({
            prompt,
            sessionId,
            provider: provider!,
            model,
            projectPath: worktreePath,
            agentMode: "build",
          }),
        );
        return { success: result.success, usage: result.usage };
      } catch (err) {
        console.error(`[autonomous:${runId}] turn failed:`, err);
        return { success: false };
      }
    },
  };

  const final = await runAutonomous({
    manifest,
    worktreePath,
    turnRunner,
    persist: saveRunManifest,
    checkCancelled: () => loadRunManifest(runId)?.cancelRequested === true,
  });

  const { writeReport } = await import("./report.js");
  writeReport(final);
}
