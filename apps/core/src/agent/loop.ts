// =============================================================================
// Agent Loop - Continuous Loop (Claude Code style)
// PRIMARY: Main execution engine for the agent
// INPUT: UserInput { prompt, sessionId, provider, projectPath }
// OUTPUT: LoopResult { success, message, turnCount, iterationCount, finalState }
// FLOW: Build Prompt → Send to AI → Normalize → Parse → Execute Tool → Loop
//
// ARCHITECTURE: Single LLM call per turn (like Claude Code/OpenCode)
//   - Pre-build git context once per turn
//   - Include file tree and memory in prompt
//   - Model decides which tools to use via function calling
// =============================================================================

import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import type {
  SessionState,
  ToolCall,
  ToolResult,
  Message,
  MessagePart,
  LoopHeuristics,
  UserInput,
  LoopResult,
  AssistantContent,
  HookContext,
  AgentMode,
} from "./types.js";
import type { SystemBlock } from "../providers/types.js";
import type { PermissionRequestResult } from "../hooks/PermissionRequest.js";
import { createInitialSessionState, DEFAULT_LOOP_HEURISTICS } from "./types.js";
import type { StreamEvent } from "@thisisayande/freecode-shared";
import { Effect } from "effect";
import { createToolOrchestrator, getTool } from "../tools/index.js";
import type { ToolOrchestrator } from "../tools/orchestrator.js";
import { getToolDefs } from "../tools/defs-cache.js";
import { planToolBatches } from "../tools/batching.js";
import {
  getProjectContext,
  invalidateProjectContext,
} from "../context/tree-cache.js";
import { MemoryService, renderPromptMemoryContext } from "../memory/index.js";
import { getProvider } from "../providers/index.js";
import { createHookRuntime, type HookRuntime } from "../hooks/runtime.js";
import type { HookResult } from "../agent/types.js";
import { bus, BusEvents } from "../bus/index.js";
import { createRecorder, type RolloutRecorder } from "../rollout/recorder.js";
import { type SessionStore, type SerializedMessage } from "../session/store.js";
import { getInterruptHandler } from "../session/interrupt.js";
import { PromptCompiler } from "../context/compiler.js";
import {
  HookRuntimeTag,
  ToolOrchestratorTag,
  SessionStoreTag,
  MemoryFactoryTag,
  RecorderFactoryTag,
  RecoveryManagerTag,
} from "../effect/context.js";
import {
  createRecoveryManagerFromConfig,
  type RecoveryManager,
} from "./recovery/manager.js";

// =============================================================================
// AgentLoop Config
// All collaborators are injectable (Effect DI provides them via
// createAgentLoopEffect); constructor fallbacks keep direct construction
// working for tests and legacy call sites.
// =============================================================================

export interface AgentLoopConfig {
  maxIterations?: number;
  heuristics?: Partial<LoopHeuristics>;
  hooks?: HookRuntime;
  recorder?: RolloutRecorder;
  sessionStore?: SessionStore;
  memory?: MemoryService;
  orchestrator?: ToolOrchestrator;
  recovery?: RecoveryManager;
}

// =============================================================================
// AgentLoop Class
// Main entry point for continuous agent execution
// =============================================================================

export class AgentLoop {
  // ---------------------------------------------------------------------------
  // Private State
  // ---------------------------------------------------------------------------
  private state: SessionState;
  private history: Message[] = [];
  private config: { maxIterations: number; heuristics: LoopHeuristics };
  private memory: MemoryService;
  private hooks: HookRuntime;
  private recorder: RolloutRecorder;
  private orchestrator: ToolOrchestrator;
  private recovery: RecoveryManager;
  private sessionStore: SessionStore | undefined;
  private onToolEvent: ((event: StreamEvent) => void) | undefined;
  private lastThinking: string | undefined;
  private compiler: PromptCompiler;
  // Cancellation: aborted on interrupt(); threaded into provider requests and
  // tool contexts so in-flight work stops, not just the next loop check.
  private abort = new AbortController();
  // Loop health tracking state
  private recentToolCalls: Array<{ tool: string; args: string }> = [];
  private recentReasoning: string[] = [];
  private lastFileStates: string[] = [];
  private fileStateHash: string = "";

  constructor(sessionId: string, config?: AgentLoopConfig) {
    this.state = createInitialSessionState(sessionId, ""); // projectPath set in run()
    this.config = {
      maxIterations: config?.maxIterations ?? 100,
      heuristics: { ...DEFAULT_LOOP_HEURISTICS, ...config?.heuristics },
    };
    this.memory = config?.memory ?? new MemoryService(sessionId);
    this.hooks = config?.hooks ?? createHookRuntime();
    this.recorder = config?.recorder ?? createRecorder(sessionId);
    this.orchestrator = config?.orchestrator ?? createToolOrchestrator();
    this.recovery = config?.recovery ?? createRecoveryManagerFromConfig();
    this.compiler = new PromptCompiler("", "");
    this.sessionStore = config?.sessionStore;
  }

  private async loadHistory(): Promise<void> {
    if (!this.sessionStore) {
      this.history = [];
      return;
    }

    await this.ensureProjectPath();
    try {
      const serialized = await this.sessionStore.getMessages(
        this.state.sessionId,
        this.state.projectPath,
      );
      this.history = serialized.map((msg): Message => {
        return {
          id: msg.id,
          role: msg.role,
          timestamp: msg.timestamp,
          parts: msg.parts.map((part): MessagePart => {
            if (part.type === "text") {
              return { type: "text", content: part.content || "" };
            } else if (part.type === "code") {
              return {
                type: "code",
                language: part.language || "",
                content: part.content || "",
              };
            } else {
              const toolCall: ToolCall = {
                id: `tool-${msg.id}`,
                tool: part.tool?.name || "",
                args: part.tool?.args || {},
                execution: "sequential",
              };
              return {
                type: "tool",
                tool: toolCall,
                result: part.result,
              };
            }
          }),
        };
      });
    } catch (error) {
      console.error(
        "[AgentLoop] Failed to load history from sessionStore:",
        error,
      );
      this.history = [];
    }
  }

  private maybeTimeBasedMicrocompact(
    messages: Message[],
    gapThresholdMinutes = 5,
  ): Message[] {
    if (messages.length === 0) return messages;

    const lastMessage = messages[messages.length - 1];
    const gapMinutes = (Date.now() - lastMessage.timestamp) / 60_000;
    if (gapMinutes < gapThresholdMinutes) return messages;

    console.log(
      `[AgentLoop] Idle gap of ${gapMinutes.toFixed(1)}m detected. Performing time-based compaction of old tool results to reduce token count on cold start.`,
    );

    return messages.map((msg) => {
      if (msg.role !== "assistant") return msg;

      return {
        ...msg,
        parts: msg.parts.map((part) => {
          if (part.type === "tool" && part.result && part.result.length > 200) {
            return {
              ...part,
              result: "[Old tool result content cleared]",
            };
          }
          return part;
        }),
      };
    });
  }

  // ===========================================================================
  // PUBLIC: run()
  // Main execution entry point - runs the continuous loop until completion
  // ===========================================================================
  async run(input: UserInput): Promise<LoopResult> {
    this.state = {
      ...this.state,
      status: "starting",
      projectPath: input.projectPath,
      agentMode: input.agentMode ?? "build",
    };
    // Fresh cancellation scope per run
    this.abort = new AbortController();

    try {
      this.state = { ...this.state, status: "running" };
      this.onToolEvent = input.onToolEvent;

      // Initialize compiler with project info and mode
      this.compiler = new PromptCompiler(
        input.projectPath,
        "",
        this.state.agentMode,
      );

      // Step 1: Collect project context (file tree, etc.)
      const contextResult = await this.collectContext(input.projectPath);
      if (!contextResult.success || !contextResult.value) {
        return this.fail("Context collection failed", contextResult.error);
      }

      // Update compiler with project name from context
      this.compiler = new PromptCompiler(
        input.projectPath,
        contextResult.value.name,
        this.state.agentMode,
      );

      // Step 2: Run SessionStart hook
      await this.hooks.runSessionStart({
        sessionId: this.state.sessionId,
        turnCount: this.state.turnCount,
      });

      // Step 3: Emit session.created event
      BusEvents.sessionCreated(this.state.sessionId, input.projectPath);

      // Load session history from persistent storage
      await this.loadHistory();

      // Prune/compact history using idle-time gap detection
      this.history = this.maybeTimeBasedMicrocompact(this.history);

      // Construct and push the new user message to history and store
      const initialUserMessage: Message = {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", content: input.prompt }],
        timestamp: Date.now(),
      };
      this.history.push(initialUserMessage);
      await this.appendUserMessage(input.prompt);
      this.memory.addMessage("user", input.prompt);

      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // =======================================================================
      // CONTINUOUS LOOP - Core agent cycle
      // =======================================================================
      while (this.state.status === "running") {
        // Check: Have we hit max iterations?
        if (this.state.iterationCount >= this.config.maxIterations) {
          await this.stop("max_iterations_reached");
          return this.complete("Max iterations reached");
        }

        // Check: Loop health (detect stuck patterns)
        const healthAction = this.evaluateLoopHealth();
        if (healthAction.action === "stop") {
          await this.stop(healthAction.reason || "loop_health_stop");
          return this.complete(`Loop stopped: ${healthAction.reason}`);
        }
        if (healthAction.action === "warn") {
          console.warn(`[AgentLoop] Warning: ${healthAction.reason}`);
        }

        // Execute one turn: send prompt, get response, parse tools, execute
        const turnResult = await this.executeTurn(
          input.provider,
          input.model,
          contextResult.value,
        );
        if (!turnResult.success) {
          // Interrupted mid-turn (Ctrl+C / session.stop): the provider or tool
          // call was aborted — that is a clean stop, not a failure.
          if (this.abort.signal.aborted) {
            return this.complete("Interrupted");
          }
          return this.fail("Turn execution failed", turnResult.error);
        }

        // Accumulate usage across turns
        if (turnResult.usage) {
          totalInputTokens += turnResult.usage.inputTokens ?? 0;
          totalOutputTokens += turnResult.usage.outputTokens ?? 0;
        }

        // No tool calls means we're done
        if (turnResult.toolResults.length === 0) {
          return this.complete(
            "Done",
            turnResult.responseText,
            turnResult.thinking,
            { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          );
        }

        this.state = {
          ...this.state,
          iterationCount: this.state.iterationCount + 1,
          turnCount: this.state.turnCount + 1,
        };
      }

      return this.complete("Loop stopped");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.fail("Loop error", message);
    }
  }

  // ===========================================================================
  // PRIVATE: executeTurn()
  // One iteration: build prompt → send to provider → normalize → parse → execute
  // Single LLM call per turn (Claude Code/OpenCode style)
  // ===========================================================================
  private async executeTurn(
    provider: string,
    model: string | undefined,
    context: {
      name: string;
      projectPath: string;
      tree: string;
      gitHead: string;
    },
  ): Promise<{
    success: boolean;
    toolResults: ToolResult[];
    responseText?: string;
    thinking?: string;
    error?: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    try {
      // Get tools for prompt compilation (cached; invalidated on tool/MCP change)
      const tools = getToolDefs();

      // Build system prompt blocks using compiler
      const memoryContext = renderPromptMemoryContext(
        this.memory.getPromptContext(),
      );
      const systemBlocks = this.compiler.compileSystemBlocks(
        tools,
        context.tree,
        context.gitHead,
        "", // ignorePatterns - empty for now
        provider,
        model,
        memoryContext || undefined,
      );

      // UserPromptSubmit Hook — can modify prompt before sending to model
      const joinedSystem = systemBlocks.map((b) => b.text).join("\n\n");
      const hookResult = await this.hooks.runUserPromptSubmit(joinedSystem, {
        sessionId: this.state.sessionId,
        turnCount: this.state.turnCount,
      });
      let finalSystemBlocks = systemBlocks;
      if (
        hookResult.modifiedPrompt &&
        hookResult.modifiedPrompt !== joinedSystem
      ) {
        finalSystemBlocks = [{ text: hookResult.modifiedPrompt, cache: true }];
      }

      console.log("[AgentLoop] Sending messages to provider...");
      const providerResult = await this.sendToProvider(
        this.history,
        finalSystemBlocks,
        provider,
        model,
      );

      // Emit thinking content if present (for UI to display as streaming reasoning)
      if (providerResult.thinking) {
        this.lastThinking = providerResult.thinking;
        this.onToolEvent?.({
          type: "thinking",
          content: providerResult.thinking,
        });
      }

      // Emit text content if present (for UI to display)
      if (providerResult.content) {
        this.onToolEvent?.({
          type: "text",
          content: providerResult.content,
        });
      }

      // Record turn.started event
      this.recorder.recordTurnStarted(`turn-${this.state.turnCount}`);

      // Get tool calls from provider (native tool calling) or from text parsing
      let toolCalls: ToolCall[] =
        providerResult.toolCalls?.map((tc) => ({
          id: tc.id,
          tool: tc.name,
          args: tc.args as Record<string, unknown>,
          execution: "sequential" as const,
        })) ?? [];

      // If no native tool calls, try parsing [TOOL_CALLS] format from text
      if (toolCalls.length === 0) {
        toolCalls = this.parseResponse(
          this.normalizeResponse(providerResult.content),
        );
      }

      // Construct assistant message and push to history
      const assistantMessage: Message = {
        id: randomUUID(),
        role: "assistant",
        parts: [
          ...(providerResult.content
            ? [{ type: "text" as const, content: providerResult.content }]
            : []),
          ...toolCalls.map((tc) => ({
            type: "tool" as const,
            tool: tc,
          })),
        ],
        timestamp: Date.now(),
      };
      this.history.push(assistantMessage);

      // No tools? Return early
      if (toolCalls.length === 0) {
        this.memory.addMessage("assistant", providerResult.content);
        await this.appendAssistantMessage(providerResult.content);
        if (this.memory.shouldCompact(provider)) {
          // PreCompact Hook — can inspect/modify context before compaction
          const preResult = await this.hooks.runPreCompact({
            sessionId: this.state.sessionId,
            turnCount: this.state.turnCount,
          });
          if (!preResult.allowed) {
            console.warn(
              `[AgentLoop] Compaction blocked by hook: ${preResult.blockReason ?? "no reason"}`,
            );
          } else {
            const result = await this.memory.compact();
            if (result.success && result.summary) {
              this.recorder.recordCompactOccurred(
                result.tokenCountBefore,
                result.tokenCountAfter,
              );
              // Sync native history with preserved messages
              const preserveCount = result.preservedMessageIds.length;
              this.history = this.history.slice(-preserveCount);
            }
            // PostCompact Hook — verify/log compaction result
            await this.hooks.runPostCompact(
              {
                sessionId: this.state.sessionId,
                turnCount: this.state.turnCount,
              },
              result.success,
            );
            if (!result.success) {
              console.warn(
                `[AgentLoop] Memory compaction skipped: ${result.reason ?? "unknown reason"}`,
              );
            }
          }
        }
        return {
          success: true,
          toolResults: [],
          responseText: providerResult.content,
          thinking: providerResult.thinking,
          usage: providerResult.usage,
        };
      }

      // If there are tool calls, append assistant text (if present) to session store
      if (providerResult.content) {
        await this.appendAssistantMessage(providerResult.content);
      }

      // Execute tools with parallel-safe batching. Concurrency-safe tools
      // (isConcurrencySafe=true) run in a single Promise.all batch; anything
      // else runs solo. Post-work (loop-health, assistantMessage patch,
      // session-store append) is always in original order for determinism.
      const toolResults: ToolResult[] = new Array(toolCalls.length);
      const batches = planToolBatches(toolCalls);
      for (const { start, end, parallel } of batches) {
        const batch = toolCalls.slice(start, end);
        const batchResults = parallel
          ? await Promise.all(batch.map((tc) => this.executeTool(tc)))
          : [await this.executeTool(batch[0])];

        for (let k = 0; k < batch.length; k++) {
          const tc = batch[k];
          const result = batchResults[k];
          toolResults[start + k] = result;
          this.updateLoopHealth(tc, result);
          const part = assistantMessage.parts.find(
            (p) => p.type === "tool" && p.tool.id === tc.id,
          );
          if (part && part.type === "tool") {
            part.result = result.stdout || result.error || "";
          }
          await this.appendToolMessage(tc, result);
        }
      }

      // Add assistant response to MemoryService for token tracking
      this.memory.addMessage(
        "assistant",
        providerResult.content || `[Executed ${toolCalls.length} tools]`,
      );

      if (this.memory.shouldCompact(provider)) {
        // PreCompact Hook — can inspect/modify context before compaction
        const preResult = await this.hooks.runPreCompact({
          sessionId: this.state.sessionId,
          turnCount: this.state.turnCount,
        });
        if (!preResult.allowed) {
          console.warn(
            `[AgentLoop] Compaction blocked by hook: ${preResult.blockReason ?? "no reason"}`,
          );
        } else {
          const result = await this.memory.compact();
          if (result.success && result.summary) {
            this.recorder.recordCompactOccurred(
              result.tokenCountBefore,
              result.tokenCountAfter,
            );
            // Sync native history with preserved messages
            const preserveCount = result.preservedMessageIds.length;
            this.history = this.history.slice(-preserveCount);
          }
          // PostCompact Hook — verify/log compaction result
          await this.hooks.runPostCompact(
            {
              sessionId: this.state.sessionId,
              turnCount: this.state.turnCount,
            },
            result.success,
          );
          if (!result.success) {
            console.warn(
              `[AgentLoop] Memory compaction skipped: ${result.reason ?? "unknown reason"}`,
            );
          }
        }
      }

      return {
        success: true,
        toolResults,
        responseText: providerResult.content,
        usage: providerResult.usage,
      };
    } catch (error) {
      return { success: false, toolResults: [], error: String(error) };
    }
  }

  // ===========================================================================
  // PRIVATE: sendToProvider()
  // Send prompt to AI provider via provider adapter, wrapped in recovery:
  // transient errors (429/5xx/network timeout) retry with backoff, hard
  // failures fall through to the config-driven fallback provider chain.
  // ===========================================================================
  private async sendToProvider(
    messages: Message[],
    system: SystemBlock[],
    provider: string,
    model: string | undefined,
  ): Promise<{
    content: string;
    thinking?: string;
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>;
    usage?: { inputTokens: number; outputTokens: number };
    streamed?: boolean;
  }> {
    return this.recovery.callProvider(
      provider,
      // Fallback providers get their own default model — the configured model
      // id is specific to the primary provider.
      (p) =>
        this.callProviderOnce(
          p,
          messages,
          system,
          p === provider ? model : undefined,
        ),
      { sessionId: this.state.sessionId, signal: this.abort.signal },
    );
  }

  // One un-recovered provider attempt (streaming preferred, execute fallback).
  private async callProviderOnce(
    provider: string,
    messages: Message[],
    system: SystemBlock[],
    model: string | undefined,
  ): Promise<{
    content: string;
    thinking?: string;
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>;
    usage?: { inputTokens: number; outputTokens: number };
    streamed?: boolean;
  }> {
    const aiProvider = getProvider(provider as any);
    const tools = getToolDefs();

    // Prefer streaming when the provider supports it AND we have a listener.
    // If either is missing, fall back to the one-shot execute() path so callers
    // and downstream code paths are unchanged.
    if (aiProvider.stream && this.onToolEvent) {
      let content = "";
      let thinking = "";
      let toolCalls:
        | Array<{ name: string; args: Record<string, unknown>; id: string }>
        | undefined;
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const chunk of aiProvider.stream({
        messages,
        system,
        tools,
        model,
        abortSignal: this.abort.signal,
      })) {
        if (this.abort.signal.aborted) break;
        switch (chunk.type) {
          case "text_delta":
            content += chunk.delta;
            this.onToolEvent({ type: "text_delta", delta: chunk.delta });
            break;
          case "thinking_delta":
            thinking += chunk.delta;
            this.onToolEvent({ type: "thinking_delta", delta: chunk.delta });
            break;
          case "tool_call":
            (toolCalls ??= []).push({
              id: chunk.id,
              name: chunk.name,
              args: chunk.args,
            });
            break;
          case "usage":
            usage = {
              inputTokens: chunk.usage.inputTokens,
              outputTokens: chunk.usage.outputTokens,
            };
            break;
          case "error":
            throw new Error(chunk.error);
          case "done":
            break;
        }
      }

      return {
        content,
        thinking: thinking ? thinking : undefined,
        toolCalls,
        usage,
        streamed: true,
      };
    }

    const result = await aiProvider.execute({
      messages,
      system,
      tools,
      model,
      abortSignal: this.abort.signal,
    });
    return {
      content: result.content,
      thinking: result.thinking,
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  }

  // ===========================================================================
  // PRIVATE: normalizeResponse()
  // Transform raw provider text to canonical AssistantContent[]
  // Handles [TOOL_CALLS]...[/TOOL_CALLS] format from mock provider
  // ===========================================================================
  private normalizeResponse(raw: string): {
    content: AssistantContent[];
    stopReason: string;
  } {
    const content: AssistantContent[] = [];
    const toolCallRegex = /\[TOOL_CALLS\]([\s\S]*?)\[\/TOOL_CALLS\]/g;
    let match;
    let lastIndex = 0;
    let hasTools = false;

    // Parse text content and tool calls from raw response
    while ((match = toolCallRegex.exec(raw)) !== null) {
      // Text before tool block
      if (match.index > lastIndex) {
        const text = raw.slice(lastIndex, match.index).trim();
        if (text) {
          content.push({ type: "text", text });
        }
      }

      // Parse tool block content
      const toolsStr = match[1];
      const toolLines = toolsStr.split("\n").filter((line) => line.trim());

      for (const line of toolLines) {
        const toolMatch = line.match(/^(\w+):(.+)$/);
        if (toolMatch) {
          const [, toolName, args] = toolMatch;
          content.push({
            type: "tool_use",
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: toolName,
            input: this.parseArgs(args.trim()),
          });
          hasTools = true;
        }
      }

      lastIndex = toolCallRegex.lastIndex;
    }

    // Text after last tool block
    if (lastIndex < raw.length) {
      const remaining = raw.slice(lastIndex).trim();
      if (remaining) {
        content.push({ type: "text", text: remaining });
      }
    }

    return {
      content,
      stopReason: hasTools ? "tool_use" : "completed",
    };
  }

  // ===========================================================================
  // PRIVATE: parseResponse()
  // Extract ToolCall[] from normalized response content
  // ===========================================================================
  private parseResponse(normalized: {
    content: AssistantContent[];
    stopReason: string;
  }): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const item of normalized.content) {
      if (item.type === "tool_use") {
        toolCalls.push({
          id: item.id,
          tool: item.name,
          args: item.input as unknown,
          execution: "sequential", // Default - parallel-safe tools batched separately
        });
      }
    }

    return toolCalls;
  }

  // ===========================================================================
  // PRIVATE: executeTool()
  // Execute a single tool via orchestrator, return ToolResult
  // Integrates PreToolUse and PostToolUse hooks for interception
  // Emits tool.called and tool.completed Bus events
  // Records function.call and function.output to rollout
  // ===========================================================================
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    // Build hook context
    const hookContext: HookContext = {
      sessionId: this.state.sessionId,
      turnCount: this.state.turnCount,
      toolName: toolCall.tool,
    };

    // Plan mode: block write tools
    if (this.state.agentMode === "plan") {
      const writeTools = ["write", "edit", "delete", "bash", "agent"];
      if (writeTools.includes(toolCall.tool)) {
        const blockedResult = {
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolCallId: toolCall.id,
          tool: toolCall.tool,
          title: `Tool ${toolCall.tool}`,
          error: `Tool "${toolCall.tool}" is not allowed in plan mode (read-only)`,
        };
        BusEvents.toolCompleted(
          this.state.sessionId,
          toolCall.tool,
          toolCall.id,
          false,
        );
        return blockedResult;
      }
    }

    // PreToolUse Hook — can block or modify tool call
    const preResult = await this.hooks.runPreToolUse(toolCall, hookContext);
    if (!preResult.allowed) {
      console.warn(
        `[AgentLoop] Tool blocked by hook: ${toolCall.tool} — ${preResult.blockReason ?? "no reason"}`,
      );
      const blockedResult = {
        id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        title: `Tool ${toolCall.tool}`,
        error: `Blocked by hook: ${preResult.blockReason ?? "no reason"}`,
      };
      // Record function.call blocked event
      this.recorder.recordHookBlocked(
        hookContext.toolName ?? toolCall.tool,
        preResult.blockReason ?? "no reason",
      );
      // Emit tool.completed for blocked tool
      BusEvents.toolCompleted(
        this.state.sessionId,
        toolCall.tool,
        toolCall.id,
        false,
      );
      return blockedResult;
    }

    // Apply input modifications from hook if any
    if (preResult.modifiedInput) {
      toolCall = {
        ...toolCall,
        args: {
          ...(toolCall.args as Record<string, unknown>),
          ...preResult.modifiedInput,
        },
      };
    }

    // PermissionRequest Hook — can block dangerous operations requiring user approval
    // Bypass permission check entirely in danger mode
    let permResult: PermissionRequestResult = {
      decision: "allow",
      modifiedInput: undefined,
    };
    if (this.state.agentMode !== "danger") {
      permResult = await this.hooks.runPermissionRequest(toolCall, hookContext);
      if (permResult.decision === "deny") {
        console.warn(
          `[AgentLoop] Tool requires permission: ${toolCall.tool} — ${permResult.reason ?? "approval needed"}`,
        );
        const blockedResult = {
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolCallId: toolCall.id,
          tool: toolCall.tool,
          title: `Tool ${toolCall.tool}`,
          error: `Permission denied: ${permResult.reason ?? "requires approval"}`,
        };
        BusEvents.toolCompleted(
          this.state.sessionId,
          toolCall.tool,
          toolCall.id,
          false,
        );
        return blockedResult;
      }
    }

    // Apply input modifications from permission hook if any
    if (permResult.modifiedInput) {
      toolCall = {
        ...toolCall,
        args: {
          ...(toolCall.args as Record<string, unknown>),
          ...permResult.modifiedInput,
        },
      };
    }

    // Emit tool_start event for streaming
    this.onToolEvent?.({
      type: "tool_start",
      toolCallId: toolCall.id,
      toolName: toolCall.tool,
      args: toolCall.args as Record<string, unknown>,
    });

    // Emit tool.called event before execution
    BusEvents.toolCalled(
      this.state.sessionId,
      toolCall.tool,
      toolCall.id,
      toolCall.args as Record<string, unknown>,
    );

    // Record function.call event
    this.recorder.recordFunctionCall(
      toolCall.tool,
      toolCall.args as Record<string, unknown>,
      `turn-${this.state.turnCount}`,
    );

    console.log(`[AgentLoop] Executing tool: ${toolCall.tool}`);
    const context = {
      cwd: process.cwd(),
      sessionId: this.state.sessionId,
      abort: this.abort.signal,
    };

    // Mutating tools invalidate the cached project file tree — even on
    // failure, since a crashed bash/edit may have already changed files.
    const isMutating = getTool(toolCall.tool)?.behavior?.isDestructive === true;

    let result: ToolResult;
    try {
      result = await this.orchestrator.execute(toolCall, context);
      if (isMutating) invalidateProjectContext(this.state.projectPath);
    } catch (error) {
      if (isMutating) invalidateProjectContext(this.state.projectPath);
      // PostToolUseFailure Hook — handle tool execution error
      const failureResult = await this.hooks.runPostToolUseFailure(
        toolCall,
        String(error),
        hookContext,
      );
      const errorResult: ToolResult = {
        id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        title: `Tool ${toolCall.tool}`,
        error: String(error),
        duration_ms: Date.now() - startTime,
      };
      BusEvents.toolCompleted(
        this.state.sessionId,
        toolCall.tool,
        toolCall.id,
        false,
        Date.now() - startTime,
      );
      return errorResult;
    }

    // Emit tool_output with last 5 lines of stdout
    // Truncate each line to 200 chars to prevent terminal overflow
    const MAX_LINE_LEN = 200;
    const outputLines = (result.stdout || "")
      .split("\n")
      .filter((l) => l.trim())
      .slice(-5)
      .map((line) =>
        line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "..." : line,
      );
    this.onToolEvent?.({
      type: "tool_output",
      toolCallId: toolCall.id,
      content: outputLines.join("\n"),
    });

    // PostToolUse Hook — can modify result
    const postResult = await this.hooks.runPostToolUse(
      toolCall,
      result,
      hookContext,
    );

    // Record function.output event
    this.recorder.recordFunctionOutput(
      toolCall.tool,
      result.stdout || result.error || "",
      Date.now() - startTime,
    );

    // Emit tool.completed event with duration
    const duration_ms = Date.now() - startTime;
    const success = !result.error;
    BusEvents.toolCompleted(
      this.state.sessionId,
      toolCall.tool,
      toolCall.id,
      success,
      duration_ms,
    );

    // Emit tool_complete event for streaming
    this.onToolEvent?.({
      type: "tool_complete",
      toolCallId: toolCall.id,
      toolName: toolCall.tool,
      result: result.stdout || result.error || "",
      success,
      duration_ms,
    });

    return result;
  }

  // ===========================================================================
  // PRIVATE: collectContext()
  // Gather project context (name, path, file tree, git head) — served from
  // the per-project cache (context/tree-cache.ts); the loop invalidates it
  // after any mutating tool completes.
  // ===========================================================================
  private async collectContext(
    projectPath: string,
  ): Promise<{
    success: boolean;
    value?: {
      name: string;
      projectPath: string;
      tree: string;
      gitHead: string;
    };
    error?: string;
  }> {
    try {
      return { success: true, value: getProjectContext(projectPath) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // PRIVATE: updateLoopHealth()
  // Track tool calls and state changes to detect stuck patterns
  // ===========================================================================
  private updateLoopHealth(toolCall: ToolCall, result: ToolResult): void {
    const argsHash = JSON.stringify(toolCall.args);
    const toolSignature = `${toolCall.tool}:${argsHash}`;

    // A. Track repeated identical tool calls
    this.recentToolCalls.push({ tool: toolCall.tool, args: argsHash });
    if (this.recentToolCalls.length > 10) {
      this.recentToolCalls.shift();
    }

    // Count how many times the same tool+args has been called recently
    const identicalCount = this.recentToolCalls.filter(
      (tc) => tc.tool === toolCall.tool && tc.args === argsHash,
    ).length;
    this.state.loopHealth = {
      ...this.state.loopHealth,
      repeatedTools: identicalCount - 1, // -1 because current call is in the array
    };

    // B. Track stagnant turns (no file changes)
    const madeFileChange =
      result.stdout &&
      (result.stdout.includes("Written") ||
        result.stdout.includes("Created") ||
        result.stdout.includes("Modified") ||
        result.stdout.includes("Deleted"));
    if (!madeFileChange) {
      this.state.loopHealth = {
        ...this.state.loopHealth,
        stagnantTurns: this.state.loopHealth.stagnantTurns + 1,
      };
    } else {
      this.state.loopHealth = {
        ...this.state.loopHealth,
        stagnantTurns: 0,
      };
    }

    // C. Track oscillation (edit same file repeatedly)
    if (
      toolCall.tool === "edit" &&
      toolCall.args &&
      typeof toolCall.args === "object"
    ) {
      const args = toolCall.args as Record<string, unknown>;
      const filePath = args.path as string;
      if (filePath) {
        this.lastFileStates.push(filePath);
        if (this.lastFileStates.length > 10) {
          this.lastFileStates.shift();
        }
        // Detect edit/revert/edit pattern on same file
        const sameFileEdits = this.lastFileStates.filter(
          (f) => f === filePath,
        ).length;
        if (sameFileEdits >= 3) {
          this.state.loopHealth = {
            ...this.state.loopHealth,
            oscillationScore: this.state.loopHealth.oscillationScore + 1,
          };
        }
      }
    }
  }

  // ===========================================================================
  // PRIVATE: evaluateLoopHealth()
  // Multi-heuristic check for stuck patterns
  // Detects: repeated tools, stagnant turns, oscillation, max iterations
  // ===========================================================================
  private evaluateLoopHealth(): {
    action: "continue" | "warn" | "stop";
    reason?: string;
  } {
    const health = this.state.loopHealth;
    const heuristics = this.config.heuristics;

    // A. Repeated identical tool call - likely infinite loop
    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold) {
      return { action: "stop", reason: "repeated_identical_tool" };
    }

    // B. No state change for N turns - likely stuck
    if (health.stagnantTurns >= heuristics.stagnantTurnsThreshold) {
      return { action: "warn", reason: "no_progress" };
    }

    // C. Oscillation detected - edit/revert/edit pattern
    if (health.oscillationScore >= heuristics.oscillationScoreThreshold) {
      return { action: "stop", reason: "oscillation_detected" };
    }

    // D. Hard cap on iterations
    if (this.state.iterationCount >= heuristics.totalIterationLimit) {
      return { action: "stop", reason: "max_iterations_reached" };
    }

    return { action: "continue" };
  }

  // ===========================================================================
  // PRIVATE: buildContinuationPrompt()
  // Format tool results into prompt for next iteration
  // Uses modelOutput (truncated) to save tokens
  // ===========================================================================
  private buildContinuationPrompt(results: ToolResult[]): string {
    const lines = results.map(
      (r) =>
        `Tool ${r.tool}: ${r.error || r.modelOutput || r.displayOutput || ""}`,
    );
    return `Previous tool results:\n${lines.join("\n")}\n\nContinue task:`;
  }

  // ===========================================================================
  // PRIVATE: parseArgs()
  // Parse tool argument string to object
  // ===========================================================================
  private parseArgs(argsStr: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(argsStr);
      return typeof parsed === "object" && parsed !== null
        ? parsed
        : { args: argsStr };
    } catch {
      return { args: argsStr };
    }
  }

  // ===========================================================================
  // PRIVATE: stop() / fail() / complete()
  // State transition helpers
  // ===========================================================================
  private async stop(reason: string): Promise<void> {
    this.state = { ...this.state, status: "stopped" };
    // Run Stop hook on termination
    await this.hooks.runStop(reason, {
      sessionId: this.state.sessionId,
      turnCount: this.state.turnCount,
    });
    // Emit session.updated event
    BusEvents.sessionUpdated(this.state.sessionId);
  }

  private fail(message: string, error?: string): LoopResult {
    // Emit session.error event
    BusEvents.sessionError(this.state.sessionId, error || message);
    return {
      success: false,
      message: error || message,
      turnCount: this.state.turnCount,
      iterationCount: this.state.iterationCount,
      finalState: { ...this.state, status: "error" },
    };
  }

  private complete(
    message: string,
    content?: string,
    thinking?: string,
    usage?: { inputTokens: number; outputTokens: number },
  ): LoopResult {
    // Emit session.updated event
    BusEvents.sessionUpdated(this.state.sessionId);
    return {
      success: true,
      message,
      content,
      thinking: thinking ?? this.lastThinking,
      turnCount: this.state.turnCount,
      iterationCount: this.state.iterationCount,
      finalState: this.state,
      usage,
    };
  }

  // ===========================================================================
  // PRIVATE: Session Store Helpers
  // Append messages to session store for persistence
  // ===========================================================================

  private async ensureProjectPath(): Promise<void> {
    if (!this.state.projectPath && this.sessionStore) {
      try {
        const all = await this.sessionStore.list();
        const meta = all.find((s) => s.id === this.state.sessionId);
        if (meta && meta.projectPath) {
          this.state.projectPath = meta.projectPath;
        }
      } catch {
        // ignore
      }
    }
  }

  private async appendUserMessage(content: string): Promise<void> {
    if (!this.sessionStore) return;
    await this.ensureProjectPath();
    const message: SerializedMessage = {
      id: randomUUID(),
      role: "user",
      parts: [{ type: "text", content }],
      timestamp: Date.now(),
    };
    await this.sessionStore.appendMessage(
      this.state.sessionId,
      message,
      this.state.projectPath,
    );
  }

  private async appendAssistantMessage(content: string): Promise<string> {
    if (!this.sessionStore) return "";
    await this.ensureProjectPath();
    const id = randomUUID();
    const message: SerializedMessage = {
      id,
      role: "assistant",
      parts: [{ type: "text", content }],
      timestamp: Date.now(),
    };
    await this.sessionStore.appendMessage(
      this.state.sessionId,
      message,
      this.state.projectPath,
    );
    // Set this message as the interrupt target so Ctrl+C marks it
    getInterruptHandler().setActive(this.state.sessionId, id);
    return id;
  }

  private async appendToolMessage(
    toolCall: ToolCall,
    result: ToolResult,
  ): Promise<void> {
    if (!this.sessionStore) return;
    await this.ensureProjectPath();
    const message: SerializedMessage = {
      id: randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "tool",
          tool: {
            name: toolCall.tool,
            args: toolCall.args as Record<string, unknown>,
          },
          result: result.stdout || result.error || "",
        },
      ],
      timestamp: Date.now(),
    };
    await this.sessionStore.appendMessage(
      this.state.sessionId,
      message,
      this.state.projectPath,
    );
  }

  // ===========================================================================
  // PUBLIC: getState() / interrupt() / runEffect()
  // Accessors for external monitoring/control
  // ===========================================================================
  getState(): SessionState {
    return this.state;
  }

  interrupt(): void {
    this.state = { ...this.state, status: "stopped" };
    // Cancel in-flight provider requests and tool executions immediately
    this.abort.abort();
  }

  // Effect wrapper around run(): fiber interruption is wired to interrupt(),
  // so cancelling the effect aborts the in-flight provider stream.
  runEffect(input: UserInput): Effect.Effect<LoopResult, Error> {
    return Effect.tryPromise({
      try: (signal) => {
        signal.addEventListener("abort", () => this.interrupt(), {
          once: true,
        });
        return this.run(input);
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
  }
}

// =============================================================================
// Factory Functions
// =============================================================================
export const createAgentLoop = (
  sessionId: string,
  config?: AgentLoopConfig,
): AgentLoop => {
  return new AgentLoop(sessionId, config);
};

// DI construction path (v3 spec): all collaborators are resolved from the
// Effect context, so a test layer swaps any of them without patching globals.
export const createAgentLoopEffect = (
  sessionId: string,
  config?: Pick<AgentLoopConfig, "maxIterations" | "heuristics">,
): Effect.Effect<
  AgentLoop,
  never,
  | HookRuntimeTag
  | ToolOrchestratorTag
  | SessionStoreTag
  | MemoryFactoryTag
  | RecorderFactoryTag
  | RecoveryManagerTag
> =>
  Effect.gen(function* () {
    const hooks = yield* HookRuntimeTag;
    const orchestrator = yield* ToolOrchestratorTag;
    const sessionStore = yield* SessionStoreTag;
    const memoryFactory = yield* MemoryFactoryTag;
    const recorderFactory = yield* RecorderFactoryTag;
    const recovery = yield* RecoveryManagerTag;

    return new AgentLoop(sessionId, {
      ...config,
      hooks,
      orchestrator,
      sessionStore,
      memory: memoryFactory.forSession(sessionId),
      recorder: recorderFactory.forSession(sessionId),
      recovery,
    });
  });
