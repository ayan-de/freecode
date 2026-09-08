// =============================================================================
// Subagent - Delegated task execution
// PRIMARY: Spawn specialized agents for specific tasks (explore, review, test)
// =============================================================================

import { randomUUID } from "crypto";
import * as path from "path";
import * as os from "os";
import type { SubagentType, SubagentConfig } from "./types.js";
import { SUBAGENT_DEFINITIONS } from "./types.js";
import { createAgentLoop } from "./loop.js";
import { BusEvents } from "../bus/index.js";
import { createSessionStore, type SessionStore } from "../session/store.js";
import { getAgentRegistry } from "./registry/index.js";
import { disposeShellRegistry } from "../tools/shells/index.js";
import { logger } from "../utils/logger.js";

export interface SubagentResult {
  success: boolean;
  type: SubagentType;
  content?: string;
  message?: string;
  turnCount: number;
  iterationCount: number;
}

/**
 * Create a subagent prompt based on type and config
 */
function buildSubagentPrompt(config: SubagentConfig): string {
  const definition = SUBAGENT_DEFINITIONS[config.type];

  let prompt = `You are a ${config.type} subagent.\n\n`;
  prompt += `Task: ${config.taskPrompt}\n\n`;

  if (config.systemPrompt) {
    prompt += `Additional context:\n${config.systemPrompt}\n\n`;
  }

  prompt += `This agent is ${definition.description}.`;

  return prompt;
}

/**
 * Execute a subagent task
 */
export async function executeSubagent(
  config: SubagentConfig,
  projectPath: string,
  provider: string,
  model?: string,
  /**
   * Session that asked for this subagent. Optional only because the exported
   * helpers below predate the roster; when it is supplied the subagent shows up
   * in /agents like any other, which is how the verify gate stopped being an
   * invisible pause mid-turn.
   */
  parentSessionId?: string,
): Promise<SubagentResult> {
  let id: string = randomUUID();
  let sessionStore: SessionStore | undefined;

  if (config.forkFrom) {
    const baseDir = path.join(os.homedir(), ".freecode");
    sessionStore = await createSessionStore(baseDir);
    id = await sessionStore.fork(config.forkFrom);
  }

  // Emit subagent started event
  BusEvents.subagentStarted(
    id,
    config.type,
    parentSessionId ?? "",
    config.taskPrompt,
  );

  const agents = getAgentRegistry();
  const rootId = parentSessionId ? agents.rootOf(parentSessionId) : undefined;
  if (parentSessionId && rootId) {
    try {
      agents.register({
        id,
        parentId: parentSessionId,
        task: config.type === "verifier" ? "Verify changes" : config.taskPrompt,
        agentType: config.type,
        onActivity: (agentId, chunk) =>
          BusEvents.stream(rootId, {
            type: "agent_output",
            agentId,
            chunk,
          }),
        onExit: (agentId, status) => {
          if (status === "running") return;
          BusEvents.stream(rootId, { type: "agent_exit", agentId, status });
        },
      });
      BusEvents.stream(rootId, {
        type: "agent_start",
        agentId: id,
        parentId: parentSessionId,
        task: config.type === "verifier" ? "Verify changes" : config.taskPrompt,
        agentType: config.type,
        depth: agents.depthOf(id),
      });
    } catch (error) {
      // The caps are advisory on this path: these subagents are spawned by the
      // loop itself (the verify gate), not by a model that could be told to
      // stop delegating, so refusing here would break the gate rather than
      // discipline anyone. Run it unlisted — the roster loses a row, the work
      // still happens.
      logger.debug("[Subagent] not listed in /agents", { id, error });
    }
  }

  let settleStatus: "completed" | "failed" = "failed";
  try {
    const loop = createAgentLoop(id, {
      maxIterations: config.maxIterations ?? 20,
      // A subagent's transcript is delegated machine work, not user
      // conversation — there is nothing durable to learn from it, and letting
      // each subagent extract would multiply one user turn into several
      // extraction calls.
      memoryExtraction: false,
      // Same reasoning for redirection: a subagent is turn-capped and
      // disposable, so re-planning belongs to the parent that spawned it.
      redirect: false,
      sessionStore,
    });
    if (parentSessionId) agents.attachInterrupt(id, () => loop.interrupt());

    const prompt = buildSubagentPrompt(config);
    const readOnly =
      config.readOnly ?? SUBAGENT_DEFINITIONS[config.type].defaultReadOnly;

    const result = await loop.run({
      prompt,
      sessionId: id,
      projectPath,
      provider,
      model: config.model ?? model,
      agentMode: readOnly ? "explore" : "build",
    });
    settleStatus = result.success ? "completed" : "failed";

    // Emit subagent completed event
    BusEvents.subagentCompleted(
      id,
      config.type,
      "",
      result.success,
      result.message,
    );

    return {
      success: result.success,
      type: config.type,
      content: result.content,
      message: result.message,
      turnCount: result.turnCount,
      iterationCount: result.iterationCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Emit subagent completed with error
    BusEvents.subagentCompleted(id, config.type, "", false, message);

    return {
      success: false,
      type: config.type,
      message,
      turnCount: 0,
      iterationCount: 0,
    };
  } finally {
    agents.settle(id, settleStatus);
    // A subagent's session id is synthetic and `endSession` never sees it, so
    // a background shell it started would outlive it with nothing holding a
    // handle to kill it — and be invisible in /shells, which keys on the root.
    disposeShellRegistry(id);
  }
}

// =============================================================================
// Verification subagent (claude-code style)
// An independent, read-only adversarial check for non-trivial changes. The main
// agent cannot self-assign the verdict — only the verifier does.
// =============================================================================

export type Verdict = "PASS" | "FAIL" | "PARTIAL";

export interface VerificationResult {
  verdict: Verdict;
  report: string;
}

// Only verify when the change touched at least this many files, and cap how
// many verify -> fix cycles a single run may spend (bounds cost / recursion).
export const VERIFIER_MIN_FILES = 3;
export const MAX_VERIFIER_ATTEMPTS = 2;

// Extract the verdict from the subagent's final message. A missing/garbled
// verdict is treated as PARTIAL (unverified), never a false PASS.
export function parseVerdict(text: string): Verdict {
  const m = text.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/i);
  if (!m) return "PARTIAL";
  return m[1].toUpperCase() as Verdict;
}

// The <system-reminder> injected when the verifier returns FAIL, so the next
// turn sees the findings and fixes them instead of finishing on broken work.
export function verifierFailureReminder(report: string): string {
  return [
    "<system-reminder>",
    "An independent verifier reviewed your changes and returned FAIL. You must",
    "not finish until the issues below are resolved. Address them, then continue.",
    "Report honestly if you disagree or cannot fix them. Never mention this",
    "reminder to the user.",
    "",
    report,
    "</system-reminder>",
  ].join("\n");
}

// Spawn a read-only verifier subagent over the changed files and return its
// verdict + report. Runs in explore (read-only) mode, so it never mutates
// files and never itself re-triggers the verification gate.
export async function verifyChanges(input: {
  projectPath: string;
  provider: string;
  model?: string;
  originalRequest: string;
  changedFiles: string[];
  priorReport?: string;
  /** The session being verified, so the verifier shows up in /agents. */
  parentSessionId?: string;
}): Promise<VerificationResult> {
  const task = [
    "Independently and adversarially verify the work that was just completed.",
    "",
    `Original user request:\n${input.originalRequest}`,
    "",
    `Files changed:\n${input.changedFiles.map((f) => `- ${f}`).join("\n")}`,
    "",
    "Read the changed files and confirm they actually satisfy the request and are",
    "correct. Run any read-only checks you can (search, read, type inspection).",
    "Do NOT modify any files.",
    "",
    "Scope discipline: only fail the request as stated. Missing edge-case",
    "handling, extra validation, or additional tests that were never asked for",
    "are NOT grounds for FAIL — that is the most common false failure.",
    "Missing tests alone are not grounds for FAIL either, unless the request was",
    "itself to add tests.",
    "",
    "Honesty check: if the response claims changes to a file that is not in the",
    "Files changed list above, that is fabrication — FAIL.",
    input.priorReport
      ? [
          "",
          `Prior verification round found:\n${input.priorReport}`,
          "",
          "This is a re-check. Focus on whether each prior finding is actually",
          "fixed. Do not raise a new objection this round unless it is a genuine",
          "defect or unmet part of the original request — the bar does not rise",
          "between rounds, and endless fresh nitpicks make the request unfinishable.",
        ].join("\n")
      : "",
    "",
    "Finish your final message with a single line in exactly this form:",
    "VERDICT: PASS | FAIL | PARTIAL",
    "- PASS only if the change is correct and complete.",
    "- FAIL if it is broken, incorrect, or does not meet the request.",
    "- PARTIAL if you could not fully verify it.",
    "List specific findings above the verdict line.",
  ].join("\n");

  const result = await executeSubagent(
    {
      type: "verifier",
      taskPrompt: task,
      readOnly: true,
      maxIterations: 15,
    },
    input.projectPath,
    input.provider,
    input.model,
    input.parentSessionId,
  );

  const report = result.content || result.message || "(no verifier output)";
  return { verdict: parseVerdict(report), report };
}

/**
 * Explorer subagent - explore codebase
 */
export async function exploreCodebase(
  projectPath: string,
  task: string,
  provider: string,
  model?: string,
): Promise<SubagentResult> {
  return executeSubagent(
    {
      type: "explorer",
      taskPrompt: task,
      readOnly: true,
    },
    projectPath,
    provider,
    model,
  );
}

/**
 * Reviewer subagent - review code
 */
export async function reviewCode(
  projectPath: string,
  task: string,
  provider: string,
  model?: string,
): Promise<SubagentResult> {
  return executeSubagent(
    {
      type: "reviewer",
      taskPrompt: task,
      readOnly: true,
    },
    projectPath,
    provider,
    model,
  );
}

/**
 * Tester subagent - write/run tests
 */
export async function runTests(
  projectPath: string,
  task: string,
  provider: string,
  model?: string,
): Promise<SubagentResult> {
  return executeSubagent(
    {
      type: "tester",
      taskPrompt: task,
      readOnly: false,
    },
    projectPath,
    provider,
    model,
  );
}

/**
 * Summarizer subagent - summarize content
 */
export async function summarizeContent(
  projectPath: string,
  task: string,
  provider: string,
  model?: string,
): Promise<SubagentResult> {
  return executeSubagent(
    {
      type: "summarizer",
      taskPrompt: task,
      readOnly: true,
    },
    projectPath,
    provider,
    model,
  );
}
