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
  HookContext,
} from "./types.js"
import { createInitialSessionState, DEFAULT_LOOP_HEURISTICS } from "./types.js"
import { createToolOrchestrator, listTools } from "../tools/index.js"
import { MemoryService, renderPromptMemoryContext } from "../memory/index.js"
import { getProvider } from "../providers/index.js"
import { createHookRuntime, type HookRuntime } from "../hooks/runtime.js"
import type { HookResult } from "../agent/types.js"
import { bus, BusEvents } from "../bus/index.js"
import { createRecorder, type RolloutRecorder } from "../rollout/recorder.js"

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
  private hooks: HookRuntime
  private recorder: RolloutRecorder
  // Loop health tracking state
  private recentToolCalls: Array<{ tool: string; args: string }> = []
  private recentReasoning: string[] = []
  private lastFileStates: string[] = []
  private fileStateHash: string = ""

  constructor(sessionId: string, config?: { maxIterations?: number; heuristics?: Partial<LoopHeuristics>; hooks?: HookRuntime; recorder?: RolloutRecorder }) {
    this.state = createInitialSessionState(sessionId)
    this.config = {
      maxIterations: config?.maxIterations ?? 100,
      heuristics: { ...DEFAULT_LOOP_HEURISTICS, ...config?.heuristics },
    }
    this.memory = new MemoryService(sessionId)
    this.hooks = config?.hooks ?? createHookRuntime()
    this.recorder = config?.recorder ?? createRecorder(sessionId)
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

      // Step 2: Run SessionStart hook
      await this.hooks.runSessionStart({ status: this.state.status, sessionId: this.state.sessionId })

      // Step 3: Emit session.created event
      BusEvents.sessionCreated(this.state.sessionId, input.projectPath)

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
          return this.complete("Done", turnResult.responseText)
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
  // Implements TWO-PHASE CONTEXT COLLECTION:
  //   Phase 1: Ask model which files it needs
  //   Phase 2: Read those files + execute actual task
  // ===========================================================================
  private async executeTurn(
    prompt: string,
    provider: string,
    context: { name: string; projectPath: string; tree: string },
    previousToolResults?: ToolResult[]
  ): Promise<{ success: boolean; toolResults: ToolResult[]; responseText?: string; error?: string }> {
    try {
      // TWO-PHASE CONTEXT COLLECTION
      // Phase 1: Ask model which files it needs to complete the task
      const neededFiles = await this.askWhichFiles(prompt, context)
      if (!neededFiles.success) {
        return { success: false, toolResults: [], error: neededFiles.error }
      }

      // Phase 2: Read the files the model requested, then execute task
      const fileContents = await this.readFiles(neededFiles.files || [], context.projectPath)
      const fileContext = fileContents.length > 0
        ? `\n\nRequested file contents:\n${fileContents.map(f => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`
        : ""

      // Build full prompt with project context, file contents, and memory
      const memoryContext = renderPromptMemoryContext(this.memory.getPromptContext())
      const fullPrompt = `Project: ${context.name}
Path: ${context.projectPath}

File tree:
${context.tree}
${fileContext}

${memoryContext ? `Session context:\n${memoryContext}\n\n` : ""}Task: ${prompt}`

      // UserPromptSubmit Hook — can modify prompt before sending to model
      const modifiedPrompt = await this.hooks.runUserPromptSubmit(fullPrompt)

      console.log("[AgentLoop] Sending prompt to provider...")
      const providerResult = await this.sendToProvider(modifiedPrompt, provider, previousToolResults)

      // Record turn.started event
      this.recorder.recordTurnStarted(`turn-${this.state.turnCount}`)

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
          // PreCompact Hook — can inspect/modify context before compaction
          const preHookCtx: HookContext = { sessionId: this.state.sessionId, turnCount: this.state.turnCount }
          const preResult = await this.hooks.runPreCompact(preHookCtx)
          if (preResult.action === "block") {
            console.warn(`[AgentLoop] Compaction blocked by hook: ${preResult.reason ?? "no reason"}`)
          } else {
            const result = await this.memory.compact()
            // PostCompact Hook — verify/log compaction result
            await this.hooks.runPostCompact(preHookCtx)
            if (!result.success) {
              console.warn(`[AgentLoop] Memory compaction skipped: ${result.reason ?? "unknown reason"}`)
            }
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
        // PreCompact Hook — can inspect/modify context before compaction
        const preHookCtx: HookContext = { sessionId: this.state.sessionId, turnCount: this.state.turnCount }
        const preResult = await this.hooks.runPreCompact(preHookCtx)
        if (preResult.action === "block") {
          console.warn(`[AgentLoop] Compaction blocked by hook: ${preResult.reason ?? "no reason"}`)
        } else {
          const result = await this.memory.compact()
          // PostCompact Hook — verify/log compaction result
          await this.hooks.runPostCompact(preHookCtx)
          if (!result.success) {
            console.warn(`[AgentLoop] Memory compaction skipped: ${result.reason ?? "unknown reason"}`)
          }
        }
      }

      return { success: true, toolResults, responseText: providerResult.content }
    } catch (error) {
      return { success: false, toolResults: [], error: String(error) }
    }
  }

  // ===========================================================================
  // PRIVATE: askWhichFiles()
  // PHASE 1 of two-phase context collection
  // Send prompt + file tree to model, ask which files it needs to read
  // ===========================================================================
  private async askWhichFiles(
    prompt: string,
    context: { name: string; projectPath: string; tree: string }
  ): Promise<{ success: boolean; files?: string[]; error?: string }> {
    try {
      // Build a prompt asking the model which files it needs
      const filePrompt = `Project: ${context.name}
Path: ${context.projectPath}

File tree:
${context.tree}

Task: ${prompt}

Based on this task, which files do you need to read to understand the codebase and complete this task? Respond with a list of file paths, one per line. Only list files that are relevant to the task. If no files are needed, respond with "NONE".`

      console.log("[AgentLoop] Phase 1: Asking model which files it needs...")
      const aiProvider = getProvider("chatgpt" as any)
      const result = await aiProvider.execute({
        prompt: filePrompt,
        system: undefined,
        tools: [],
        toolResults: undefined,
        model: undefined,
      })

      // Parse the response to extract file paths
      const content = result.content.trim()
      const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0)

      // Filter to valid file paths (non-empty, not "NONE")
      if (lines.length === 0 || (lines.length === 1 && lines[0].toUpperCase() === "NONE")) {
        console.log("[AgentLoop] Phase 1: Model requested no files")
        return { success: true, files: [] }
      }

      // Filter out non-path lines (comments, descriptions)
      const filePaths = lines.filter(line => {
        // Skip lines that look like descriptions or comments
        if (line.startsWith("//") || line.startsWith("#") || line.startsWith("--")) return false
        // Skip lines with too many words (not just a path)
        if (line.split(/\s+/).length > 3) return false
        // Accept lines that look like paths (contain / or .)
        return line.includes("/") || line.includes(".")
      })

      console.log(`[AgentLoop] Phase 1: Model requested ${filePaths.length} files: ${filePaths.join(", ")}`)
      return { success: true, files: filePaths }
    } catch (error) {
      console.warn(`[AgentLoop] Phase 1 failed: ${error}, continuing without file context`)
      return { success: true, files: [] } // Continue without file context on error
    }
  }

  // ===========================================================================
  // PRIVATE: readFiles()
  // PHASE 2 of two-phase context collection
  // Read the requested files and return their contents
  // ===========================================================================
  private async readFiles(
    filePaths: string[],
    projectPath: string
  ): Promise<Array<{ path: string; content: string }>> {
    if (filePaths.length === 0) return []

    const results: Array<{ path: string; content: string }> = []
    const fs = await import("fs")
    const path = await import("path")

    for (const filePath of filePaths) {
      try {
        // Resolve relative paths against projectPath
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(projectPath, filePath)

        if (!fs.existsSync(resolvedPath)) {
          console.log(`[AgentLoop] Phase 2: File not found, skipping: ${resolvedPath}`)
          continue
        }

        const stat = fs.statSync(resolvedPath)
        if (stat.isDirectory()) {
          console.log(`[AgentLoop] Phase 2: Skipping directory: ${resolvedPath}`)
          continue
        }

        // Read file with line numbers for context
        const content = fs.readFileSync(resolvedPath, "utf-8")
        const lines = content.split("\n")
        const numberedLines = lines.map((line, i) => `${i + 1}: ${line}`).join("\n")

        results.push({
          path: resolvedPath,
          content: `File: ${resolvedPath}\nTotal lines: ${lines.length}\n\n${numberedLines}`,
        })
        console.log(`[AgentLoop] Phase 2: Read ${resolvedPath} (${lines.length} lines)`)
      } catch (error) {
        console.warn(`[AgentLoop] Phase 2: Failed to read ${filePath}: ${error}`)
        // Skip files that can't be read
      }
    }

    return results
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
  // Integrates PreToolUse and PostToolUse hooks for interception
  // Emits tool.called and tool.completed Bus events
  // Records function.call and function.output to rollout
  // ===========================================================================
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now()

    // Build hook context
    const hookContext: HookContext = {
      sessionId: this.state.sessionId,
      turnCount: this.state.turnCount,
      toolName: toolCall.tool,
    }

    // PreToolUse Hook — can block or modify tool call
    const preResult = await this.hooks.runPreToolUse(toolCall, hookContext)
    if (preResult.action === "block") {
      console.warn(`[AgentLoop] Tool blocked by hook: ${toolCall.tool} — ${preResult.reason ?? "no reason"}`)
      const blockedResult = {
        id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        title: `Tool ${toolCall.tool}`,
        error: `Blocked by hook: ${preResult.reason ?? "no reason"}`,
      }
      // Record function.call blocked event
      this.recorder.recordHookBlocked(hookContext.toolName ?? toolCall.tool, preResult.reason ?? "no reason")
      // Emit tool.completed for blocked tool
      BusEvents.toolCompleted(this.state.sessionId, toolCall.tool, toolCall.id, false)
      return blockedResult
    }

    // Inject context if hook requested injection
    if (preResult.action === "inject" && preResult.injectContext) {
      toolCall = {
        ...toolCall,
        args: { ...(toolCall.args as Record<string, unknown>), ...preResult.injectContext },
      }
    }

    // PermissionRequest Hook — can block dangerous operations requiring user approval
    const permResult = await this.hooks.runPermissionRequest(toolCall, hookContext)
    if (permResult.action === "block") {
      console.warn(`[AgentLoop] Tool requires permission: ${toolCall.tool} — ${permResult.reason ?? "approval needed"}`)
      const blockedResult = {
        id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        title: `Tool ${toolCall.tool}`,
        error: `Permission denied: ${permResult.reason ?? "requires approval"}`,
      }
      BusEvents.toolCompleted(this.state.sessionId, toolCall.tool, toolCall.id, false)
      return blockedResult
    }

    // Emit tool.called event before execution
    BusEvents.toolCalled(this.state.sessionId, toolCall.tool, toolCall.id, toolCall.args as Record<string, unknown>)

    // Record function.call event
    this.recorder.recordFunctionCall(toolCall.tool, toolCall.args as Record<string, unknown>, `turn-${this.state.turnCount}`)

    console.log(`[AgentLoop] Executing tool: ${toolCall.tool}`)
    const context = { cwd: process.cwd() }
    const result = await orchestrator.execute(toolCall, context)

    // PostToolUse Hook — can modify result
    const postResult = await this.hooks.runPostToolUse(toolCall, result, hookContext)

    // Record function.output event
    this.recorder.recordFunctionOutput(toolCall.tool, postResult.stdout || postResult.error || "", Date.now() - startTime)

    // Emit tool.completed event with duration
    const duration_ms = Date.now() - startTime
    const success = !postResult.error
    BusEvents.toolCompleted(this.state.sessionId, toolCall.tool, toolCall.id, success, duration_ms)

    return postResult
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
    // Run Stop hook on termination
    await this.hooks.runStop(reason)
    // Emit session.updated event
    BusEvents.sessionUpdated(this.state.sessionId)
  }

  private fail(message: string, error?: string): LoopResult {
    // Emit session.error event
    BusEvents.sessionError(this.state.sessionId, error || message)
    return {
      success: false,
      message: error || message,
      turnCount: this.state.turnCount,
      iterationCount: this.state.iterationCount,
      finalState: { ...this.state, status: "error" },
    }
  }

  private complete(message: string, content?: string): LoopResult {
    // Emit session.updated event
    BusEvents.sessionUpdated(this.state.sessionId)
    return {
      success: true,
      message,
      content,
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
  config?: { maxIterations?: number; heuristics?: Partial<LoopHeuristics>; hooks?: HookRuntime; recorder?: RolloutRecorder }
): AgentLoop => {
  return new AgentLoop(sessionId, config)
}
