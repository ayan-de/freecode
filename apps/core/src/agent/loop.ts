// =============================================================================
// Agent Loop - Continuous Loop (Claude Code style)
// PRIMARY: Main execution engine for the agent
// INPUT: UserInput { prompt, sessionId, provider, projectPath }
// OUTPUT: LoopResult { success, message, turnCount, iterationCount, finalState }
// FLOW: Build Prompt → Send to AI → Normalize → Parse → Execute Tool → Loop
// =============================================================================

import type {
  SessionState,
  ToolCall,
  ToolResult,
  Message,
  LoopHeuristics,
  UserInput,
  LoopResult,
  AssistantContent,
} from "./types.js"
import { createInitialSessionState, DEFAULT_LOOP_HEURISTICS } from "./types.js"
import { createToolOrchestrator, listTools } from "../tools/index.js"
import { MemoryService, renderPromptMemoryContext } from "../memory/index.js"
import { getProvider } from "../providers/index.js"

const orchestrator = createToolOrchestrator()

// =============================================================================
// AgentLoop Class
// Main entry point for continuous agent execution
// =============================================================================

export class AgentLoop {
  // ---------------------------------------------------------------------------
  // Private State
  // ---------------------------------------------------------------------------
  private state: SessionState
  private history: Message[] = []
  private config: { maxIterations: number; heuristics: LoopHeuristics }
  private memory: MemoryService
  // Loop health tracking state
  private recentToolCalls: Array<{ tool: string; args: string }> = []
  private recentReasoning: string[] = []
  private lastFileStates: string[] = []
  private fileStateHash: string = ""

  constructor(sessionId: string, config?: { maxIterations?: number; heuristics?: Partial<LoopHeuristics> }) {
    this.state = createInitialSessionState(sessionId)
    this.config = {
      maxIterations: config?.maxIterations ?? 100,
      heuristics: { ...DEFAULT_LOOP_HEURISTICS, ...config?.heuristics },
    }
    this.memory = new MemoryService(sessionId)
  }

  // ===========================================================================
  // PUBLIC: run()
  // Main execution entry point - runs the continuous loop until completion
  // ===========================================================================
  async run(input: UserInput): Promise<LoopResult> {
    this.state = { ...this.state, status: "starting" }

    try {
      this.state = { ...this.state, status: "running" }

      // Step 1: Collect project context (file tree, etc.)
      const contextResult = await this.collectContext(input.projectPath)
      if (!contextResult.success || !contextResult.value) {
        return this.fail("Context collection failed", contextResult.error)
      }

      let prompt = input.prompt
      let previousToolResults: ToolResult[] | undefined

      // =======================================================================
      // CONTINUOUS LOOP - Core agent cycle
      // =======================================================================
      while (this.state.status === "running") {

        // Check: Have we hit max iterations?
        if (this.state.iterationCount >= this.config.maxIterations) {
          await this.stop("max_iterations_reached")
          return this.complete("Max iterations reached")
        }

        // Check: Loop health (detect stuck patterns)
        const healthAction = this.evaluateLoopHealth()
        if (healthAction.action === "stop") {
          await this.stop(healthAction.reason || "loop_health_stop")
          return this.complete(`Loop stopped: ${healthAction.reason}`)
        }
        if (healthAction.action === "warn") {
          console.warn(`[AgentLoop] Warning: ${healthAction.reason}`)
        }

        // Execute one turn: send prompt, get response, parse tools, execute
        const turnResult = await this.executeTurn(prompt, input.provider, contextResult.value, previousToolResults)
        if (!turnResult.success) {
          return this.fail("Turn execution failed", turnResult.error)
        }

        // No tool calls means we're done
        if (turnResult.toolResults.length === 0) {
          return this.complete("No more tool calls")
        }

        // Build continuation prompt for next iteration
        prompt = this.buildContinuationPrompt(turnResult.toolResults)
        previousToolResults = turnResult.toolResults
        this.state = {
          ...this.state,
          iterationCount: this.state.iterationCount + 1,
          turnCount: this.state.turnCount + 1,
        }
      }

      return this.complete("Loop stopped")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.fail("Loop error", message)
    }
  }

  // ===========================================================================
  // PRIVATE: executeTurn()
  // One iteration: build prompt → send to provider → normalize → parse → execute
  // ===========================================================================
  private async executeTurn(
    prompt: string,
    provider: string,
    context: { name: string; projectPath: string; tree: string },
    previousToolResults?: ToolResult[]
  ): Promise<{ success: boolean; toolResults: ToolResult[]; responseText?: string; error?: string }> {
    try {
      // Build full prompt with project context and memory
      const memoryContext = renderPromptMemoryContext(this.memory.getPromptContext())
      const fullPrompt = `Project: ${context.name}
Path: ${context.projectPath}

File tree:
${context.tree}

${memoryContext ? `Session context:\n${memoryContext}\n\n` : ""}Task: ${prompt}`

      console.log("[AgentLoop] Sending prompt to provider...")
      const providerResult = await this.sendToProvider(fullPrompt, provider, previousToolResults)

      // Get tool calls from provider (native tool calling) or from text parsing
      let toolCalls: ToolCall[] = providerResult.toolCalls?.map(tc => ({
        id: tc.id,
        tool: tc.name,
        args: tc.args as Record<string, unknown>,
        execution: "sequential" as const,
      })) ?? []

      // If no native tool calls, try parsing [TOOL_CALLS] format from text
      if (toolCalls.length === 0) {
        toolCalls = this.parseResponse(this.normalizeResponse(providerResult.content))
      }

      // No tools? Return early
      if (toolCalls.length === 0) {
        this.memory.addMessage("user", prompt)
        this.memory.addMessage("assistant", providerResult.content)
        if (this.memory.shouldCompact(provider)) {
          const result = await this.memory.compact()
          if (!result.success) {
            console.warn(`[AgentLoop] Memory compaction skipped: ${result.reason ?? "unknown reason"}`)
          }
        }
        return { success: true, toolResults: [], responseText: providerResult.content }
      }

      // Execute each tool sequentially (as per spec: sequential tools run one at a time)
      const toolResults: ToolResult[] = []
      for (const toolCall of toolCalls) {
        const result = await this.executeTool(toolCall)
        toolResults.push(result)
        // Update loop health tracking after each tool execution
        this.updateLoopHealth(toolCall, result)
      }

      // Record messages and check for compaction after tool execution
      this.memory.addMessage("user", prompt)
      this.memory.addMessage("assistant", providerResult.content)

      if (this.memory.shouldCompact(provider)) {
        const result = await this.memory.compact()
        if (!result.success) {
          console.warn(`[AgentLoop] Memory compaction skipped: ${result.reason ?? "unknown reason"}`)
        }
      }

      return { success: true, toolResults, responseText: providerResult.content }
    } catch (error) {
      return { success: false, toolResults: [], error: String(error) }
    }
  }

  // ===========================================================================
  // PRIVATE: sendToProvider()
  // Send prompt to AI provider via provider adapter
  // ===========================================================================
  private async sendToProvider(
    prompt: string,
    provider: string,
    toolResults?: ToolResult[]
  ): Promise<{ content: string; toolCalls?: Array<{ name: string; args: Record<string, unknown>; id: string }> }> {
    const aiProvider = getProvider(provider as any)
    const tools = listTools().map(t => ({
      name: t.id,
      description: t.description,
      parameters: { type: "object", properties: {} as Record<string, unknown> }
    }))
    const result = await aiProvider.execute({
      prompt,
      system: undefined,
      tools,
      toolResults: toolResults?.map(tr => ({
        toolCallId: tr.toolCallId,
        result: tr.stdout || tr.error || "",
        name: tr.tool,
      })),
      model: undefined,
    })
    return { content: result.content, toolCalls: result.toolCalls }
  }

  // ===========================================================================
  // PRIVATE: normalizeResponse()
  // Transform raw provider text to canonical AssistantContent[]
  // Handles [TOOL_CALLS]...[/TOOL_CALLS] format from mock provider
  // ===========================================================================
  private normalizeResponse(raw: string): { content: AssistantContent[]; stopReason: string } {
    const content: AssistantContent[] = []
    const toolCallRegex = /\[TOOL_CALLS\]([\s\S]*?)\[\/TOOL_CALLS\]/g
    let match
    let lastIndex = 0
    let hasTools = false

    // Parse text content and tool calls from raw response
    while ((match = toolCallRegex.exec(raw)) !== null) {
      // Text before tool block
      if (match.index > lastIndex) {
        const text = raw.slice(lastIndex, match.index).trim()
        if (text) {
          content.push({ type: "text", text })
        }
      }

      // Parse tool block content
      const toolsStr = match[1]
      const toolLines = toolsStr.split("\n").filter(line => line.trim())

      for (const line of toolLines) {
        const toolMatch = line.match(/^(\w+):(.+)$/)
        if (toolMatch) {
          const [, toolName, args] = toolMatch
          content.push({
            type: "tool_use",
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: toolName,
            input: this.parseArgs(args.trim()),
          })
          hasTools = true
        }
      }

      lastIndex = toolCallRegex.lastIndex
    }

    // Text after last tool block
    if (lastIndex < raw.length) {
      const remaining = raw.slice(lastIndex).trim()
      if (remaining) {
        content.push({ type: "text", text: remaining })
      }
    }

    return {
      content,
      stopReason: hasTools ? "tool_use" : "completed",
    }
  }

  // ===========================================================================
  // PRIVATE: parseResponse()
  // Extract ToolCall[] from normalized response content
  // ===========================================================================
  private parseResponse(normalized: { content: AssistantContent[]; stopReason: string }): ToolCall[] {
    const toolCalls: ToolCall[] = []

    for (const item of normalized.content) {
      if (item.type === "tool_use") {
        toolCalls.push({
          id: item.id,
          tool: item.name,
          args: item.input as unknown,
          execution: "sequential", // Default - parallel-safe tools batched separately
        })
      }
    }

    return toolCalls
  }

  // ===========================================================================
  // PRIVATE: executeTool()
  // Execute a single tool via orchestrator, return ToolResult
  // ===========================================================================
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    console.log(`[AgentLoop] Executing tool: ${toolCall.tool}`)
    const context = { cwd: process.cwd() }
    return orchestrator.execute(toolCall, context)
  }

  // ===========================================================================
  // PRIVATE: collectContext()
  // Gather project context (name, path, file tree)
  // TODO: Replace with proper ContextCollector integration
  // ===========================================================================
  private async collectContext(projectPath: string): Promise<{ success: boolean; value?: { name: string; projectPath: string; tree: string }; error?: string }> {
    try {
      const fs = await import("fs")
      const path = await import("path")

      const name = path.basename(projectPath)
      let tree = ""

      if (fs.existsSync(projectPath)) {
        const entries = fs.readdirSync(projectPath, { withFileTypes: true })
        tree = entries.map(e => `  ${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n")
      }

      return { success: true, value: { name, projectPath, tree } }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  // ===========================================================================
  // PRIVATE: updateLoopHealth()
  // Track tool calls and state changes to detect stuck patterns
  // ===========================================================================
  private updateLoopHealth(toolCall: ToolCall, result: ToolResult): void {
    const argsHash = JSON.stringify(toolCall.args)
    const toolSignature = `${toolCall.tool}:${argsHash}`

    // A. Track repeated identical tool calls
    this.recentToolCalls.push({ tool: toolCall.tool, args: argsHash })
    if (this.recentToolCalls.length > 10) {
      this.recentToolCalls.shift()
    }

    // Count how many times the same tool+args has been called recently
    const identicalCount = this.recentToolCalls.filter(
      tc => tc.tool === toolCall.tool && tc.args === argsHash
    ).length
    this.state.loopHealth = {
      ...this.state.loopHealth,
      repeatedTools: identicalCount - 1, // -1 because current call is in the array
    }

    // B. Track stagnant turns (no file changes)
    const madeFileChange = result.stdout && (
      result.stdout.includes("Written") ||
      result.stdout.includes("Created") ||
      result.stdout.includes("Modified") ||
      result.stdout.includes("Deleted")
    )
    if (!madeFileChange) {
      this.state.loopHealth = {
        ...this.state.loopHealth,
        stagnantTurns: this.state.loopHealth.stagnantTurns + 1,
      }
    } else {
      this.state.loopHealth = {
        ...this.state.loopHealth,
        stagnantTurns: 0,
      }
    }

    // C. Track oscillation (edit same file repeatedly)
    if (toolCall.tool === "edit" && toolCall.args && typeof toolCall.args === "object") {
      const args = toolCall.args as Record<string, unknown>
      const filePath = args.path as string
      if (filePath) {
        this.lastFileStates.push(filePath)
        if (this.lastFileStates.length > 10) {
          this.lastFileStates.shift()
        }
        // Detect edit/revert/edit pattern on same file
        const sameFileEdits = this.lastFileStates.filter(f => f === filePath).length
        if (sameFileEdits >= 3) {
          this.state.loopHealth = {
            ...this.state.loopHealth,
            oscillationScore: this.state.loopHealth.oscillationScore + 1,
          }
        }
      }
    }
  }

  // ===========================================================================
  // PRIVATE: evaluateLoopHealth()
  // Multi-heuristic check for stuck patterns
  // Detects: repeated tools, stagnant turns, oscillation, max iterations
  // ===========================================================================
  private evaluateLoopHealth(): { action: "continue" | "warn" | "stop"; reason?: string } {
    const health = this.state.loopHealth
    const heuristics = this.config.heuristics

    // A. Repeated identical tool call - likely infinite loop
    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold) {
      return { action: "stop", reason: "repeated_identical_tool" }
    }

    // B. No state change for N turns - likely stuck
    if (health.stagnantTurns >= heuristics.stagnantTurnsThreshold) {
      return { action: "warn", reason: "no_progress" }
    }

    // C. Oscillation detected - edit/revert/edit pattern
    if (health.oscillationScore >= heuristics.oscillationScoreThreshold) {
      return { action: "stop", reason: "oscillation_detected" }
    }

    // D. Hard cap on iterations
    if (this.state.iterationCount >= heuristics.totalIterationLimit) {
      return { action: "stop", reason: "max_iterations_reached" }
    }

    return { action: "continue" }
  }

  // ===========================================================================
  // PRIVATE: buildContinuationPrompt()
  // Format tool results into prompt for next iteration
  // ===========================================================================
  private buildContinuationPrompt(results: ToolResult[]): string {
    const lines = results.map(r => `Tool ${r.tool}: ${r.error || r.stdout}`)
    return `Previous tool results:\n${lines.join("\n")}\n\nContinue task:`
  }

  // ===========================================================================
  // PRIVATE: parseArgs()
  // Parse tool argument string to object
  // ===========================================================================
  private parseArgs(argsStr: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(argsStr)
      return typeof parsed === "object" && parsed !== null ? parsed : { args: argsStr }
    } catch {
      return { args: argsStr }
    }
  }

  // ===========================================================================
  // PRIVATE: stop() / fail() / complete()
  // State transition helpers
  // ===========================================================================
  private async stop(reason: string): Promise<void> {
    this.state = { ...this.state, status: "stopped" }
  }

  private fail(message: string, error?: string): LoopResult {
    return {
      success: false,
      message: error || message,
      turnCount: this.state.turnCount,
      iterationCount: this.state.iterationCount,
      finalState: { ...this.state, status: "error" },
    }
  }

  private complete(message: string): LoopResult {
    return {
      success: true,
      message,
      turnCount: this.state.turnCount,
      iterationCount: this.state.iterationCount,
      finalState: this.state,
    }
  }

  // ===========================================================================
  // PUBLIC: getState() / interrupt()
  // Accessors for external monitoring/control
  // ===========================================================================
  getState(): SessionState {
    return this.state
  }

  interrupt(): void {
    this.state = { ...this.state, status: "stopped" }
  }
}

// =============================================================================
// Factory Function
// =============================================================================
export const createAgentLoop = (
  sessionId: string,
  config?: { maxIterations?: number; heuristics?: Partial<LoopHeuristics> }
): AgentLoop => {
  return new AgentLoop(sessionId, config)
}