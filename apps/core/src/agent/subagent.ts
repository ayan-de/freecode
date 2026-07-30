// =============================================================================
// Subagent - Delegated task execution
// PRIMARY: Spawn specialized agents for specific tasks (explore, review, test)
// =============================================================================

import { randomUUID } from "crypto";
import type { SubagentType, SubagentConfig } from "./types.js";
import { SUBAGENT_DEFINITIONS } from "./types.js";
import { createAgentLoop } from "./loop.js";
import { BusEvents } from "../bus/index.js";

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
): Promise<SubagentResult> {
  const id = randomUUID();

  // Emit subagent started event
  BusEvents.subagentStarted(id, config.type, "", config.taskPrompt);

  try {
    const loop = createAgentLoop(id, {
      maxIterations: config.maxIterations ?? 20,
    });

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
