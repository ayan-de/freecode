// =============================================================================
// Subagent - Delegated task execution
// PRIMARY: Spawn specialized agents for specific tasks (explore, review, test)
// =============================================================================

import { randomUUID } from "crypto"
import type { SubagentType, SubagentConfig } from "./types.js"
import { SUBAGENT_DEFINITIONS } from "./types.js"
import { createAgentLoop } from "./loop.js"
import { BusEvents } from "../bus/index.js"

export interface SubagentResult {
  success: boolean
  type: SubagentType
  content?: string
  message?: string
  turnCount: number
  iterationCount: number
}

/**
 * Create a subagent prompt based on type and config
 */
function buildSubagentPrompt(config: SubagentConfig): string {
  const definition = SUBAGENT_DEFINITIONS[config.type]

  let prompt = `You are a ${config.type} subagent.\n\n`
  prompt += `Task: ${config.taskPrompt}\n\n`

  if (config.systemPrompt) {
    prompt += `Additional context:\n${config.systemPrompt}\n\n`
  }

  prompt += `This agent is ${definition.description}.`

  return prompt
}

/**
 * Execute a subagent task
 */
export async function executeSubagent(
  config: SubagentConfig,
  projectPath: string,
  provider: string,
  model?: string
): Promise<SubagentResult> {
  const id = randomUUID()

  // Emit subagent started event
  BusEvents.subagentStarted(id, config.type, "", config.taskPrompt)

  try {
    const loop = createAgentLoop(id, {
      maxIterations: config.maxIterations ?? 20,
    })

    const prompt = buildSubagentPrompt(config)
    const readOnly = config.readOnly ?? SUBAGENT_DEFINITIONS[config.type].defaultReadOnly

    const result = await loop.run({
      prompt,
      sessionId: id,
      projectPath,
      provider,
      model: config.model ?? model,
      agentMode: readOnly ? "explore" : "build",
    })

    // Emit subagent completed event
    BusEvents.subagentCompleted(id, config.type, "", result.success, result.message)

    return {
      success: result.success,
      type: config.type,
      content: result.content,
      message: result.message,
      turnCount: result.turnCount,
      iterationCount: result.iterationCount,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Emit subagent completed with error
    BusEvents.subagentCompleted(id, config.type, "", false, message)

    return {
      success: false,
      type: config.type,
      message,
      turnCount: 0,
      iterationCount: 0,
    }
  }
}

/**
 * Explorer subagent - explore codebase
 */
export async function exploreCodebase(
  projectPath: string,
  task: string,
  provider: string,
  model?: string
): Promise<SubagentResult> {
  return executeSubagent({
    type: "explorer",
    taskPrompt: task,
    readOnly: true,
  }, projectPath, provider, model)
}

/**
 * Reviewer subagent - review code
 */
export async function reviewCode(
  projectPath: string,
  task: string,
  provider: string,
  model?: string
): Promise<SubagentResult> {
  return executeSubagent({
    type: "reviewer",
    taskPrompt: task,
    readOnly: true,
  }, projectPath, provider, model)
}

/**
 * Tester subagent - write/run tests
 */
export async function runTests(
  projectPath: string,
  task: string,
  provider: string,
  model?: string
): Promise<SubagentResult> {
  return executeSubagent({
    type: "tester",
    taskPrompt: task,
    readOnly: false,
  }, projectPath, provider, model)
}

/**
 * Summarizer subagent - summarize content
 */
export async function summarizeContent(
  projectPath: string,
  task: string,
  provider: string,
  model?: string
): Promise<SubagentResult> {
  return executeSubagent({
    type: "summarizer",
    taskPrompt: task,
    readOnly: true,
  }, projectPath, provider, model)
}