// =============================================================================
// PromptCompiler - Mode-aware prompt building with caching
// PRIMARY: Build prompts with stable sections: system, tools, project, history, message
// CACHING: File tree by git HEAD + ignore patterns, tool schemas per provider/model
// =============================================================================

import type { AgentMode } from "../agent/types.js";
import type { ToolCall, ToolResult } from "../agent/types.js";
import type { SystemBlock } from "../providers/types.js";
import { compileInstructionsSection } from "./instructions.js";
import { loadProviderPrompt } from "../session/prompt.js";

// ===========================================================================
// System Prompts per Agent Mode
// ===========================================================================

const MODE_PROMPTS: Record<AgentMode, string> = {
  plan: `You are in PLAN mode - read-only analysis and thinking.
Do NOT write any files, run commands, or make changes.
Only analyze, read files, grep/search, and provide recommendations.
When you have a plan, present it clearly and wait for user approval before any build step.`,

  build: `You are in BUILD mode - normal coding assistant.
You can read and write files, run commands, and use all available tools.
Work systematically to complete the task at hand.
Always verify your changes work correctly.`,

  review: `You are in REVIEW mode - code review and quality analysis.
Do NOT make changes. Only read, analyze, and provide feedback.
Focus on: correctness, security, performance, maintainability.
Provide specific, actionable feedback with code references.`,

  explore: `You are in EXPLORE mode - discovery and learning.
Navigate freely, read files, search codebases.
Understand the architecture, patterns, and conventions.
Provide summaries of what you find without making changes.`,

  danger: `You are in DANGER mode - unrestricted full access.
ALL permission checks are BYPASSED. You have complete access to everything.
Read and write any files, run any commands including destructive ones.
Use with extreme caution - you can break things permanently.`,
};

// ===========================================================================
// Tool Schema Cache
// ===========================================================================

interface CachedToolSchemas {
  schema: string;
  timestamp: number;
}

const toolSchemaCache = new Map<string, CachedToolSchemas>();
const TOOL_SCHEMA_TTL_MS = 60 * 60 * 1000; // 1 hour

function getToolSchemasKey(provider: string, model?: string): string {
  return `${provider}:${model || "default"}`;
}

// ===========================================================================
// File Tree Cache
// ===========================================================================

interface CachedFileTree {
  tree: string;
  gitHead: string;
  ignorePatterns: string;
  timestamp: number;
}

const fileTreeCache = new Map<string, CachedFileTree>();
const FILE_TREE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getFileTreeKey(
  projectPath: string,
  gitHead: string,
  ignorePatterns: string,
): string {
  return `${projectPath}:${gitHead}:${ignorePatterns}`;
}

// ===========================================================================
// PromptCompiler Class
// ===========================================================================

export class PromptCompiler {
  private projectPath: string;
  private projectName: string;
  private agentMode: AgentMode;

  constructor(
    projectPath: string,
    projectName: string,
    agentMode: AgentMode = "build",
  ) {
    this.projectPath = projectPath;
    this.projectName = projectName;
    this.agentMode = agentMode;
  }

  /**
   * Update agent mode
   */
  setAgentMode(mode: AgentMode): void {
    this.agentMode = mode;
  }

  compileSystemPrompt(): string {
    const modePrompt = MODE_PROMPTS[this.agentMode];
    const formattingGuidelines = `

RESPONSE FORMATTING GUIDELINES:
- Keep responses concise. Output is rendered on a terminal/TUI CLI.
- Markdown tables are fully supported and encouraged for displaying structured data.
- Avoid using deep sub-headings (e.g., ###, ####, etc.) or HTML tags. Keep the document structure clean and simple (e.g., use only single '#' or '##' for main sections, '**bold**' for key terms/emphasis, and bullet lists (-) for listings).
- Use code blocks (with appropriate language tags) for code, and inline code for paths/variable/function names.
- Do NOT tell the user to manually launch Chrome or Chromium with remote debugging (e.g., never output commands like \`chromium --remote-debugging-port=9222\` or \`google-chrome --remote-debugging-port=9222\`). The browser controller is managed internally.
- Do NOT use formatting elements that are poorly supported in terminal views.`;
    return `${modePrompt}${formattingGuidelines}`;
  }

  /**
   * Compile tool schemas with caching
   */
  compileToolsSection(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>,
    provider: string,
    model?: string,
  ): string {
    const cacheKey = getToolSchemasKey(provider, model);
    const cached = toolSchemaCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < TOOL_SCHEMA_TTL_MS) {
      return cached.schema;
    }

    const schema = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");

    const section = `Available tools:
${schema}

Use tools as needed. Format: [TOOL_CALLS]\ntool_name: {args}\n[/TOOL_CALLS]`;

    toolSchemaCache.set(cacheKey, { schema: section, timestamp: Date.now() });
    return section;
  }

  /**
   * Compile project summary section with caching
   */
  compileProjectSummary(
    tree: string,
    gitHead: string,
    ignorePatterns: string,
  ): string {
    const cacheKey = getFileTreeKey(this.projectPath, gitHead, ignorePatterns);
    const cached = fileTreeCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < FILE_TREE_TTL_MS) {
      return cached.tree;
    }

    // Cache miss - build section and store
    const section = `Project: ${this.projectName}
Path: ${this.projectPath}

File tree:
${tree}`;

    fileTreeCache.set(cacheKey, {
      tree: section,
      gitHead,
      ignorePatterns,
      timestamp: Date.now(),
    });

    return section;
  }

  /**
   * Compile recent history section
   */
  compileHistorySection(
    recentTurns: Array<{
      prompt: string;
      response: string;
      toolResults?: ToolResult[];
    }>,
    maxTurns: number = 3,
  ): string {
    if (recentTurns.length === 0) return "";

    const recent = recentTurns.slice(-maxTurns);
    const lines = recent.map((turn, i) => {
      let entry = `[Turn ${i + 1}]
User: ${turn.prompt}
Assistant: ${turn.response}`;
      if (turn.toolResults && turn.toolResults.length > 0) {
        const toolSummary = turn.toolResults
          .map((r) => `  - ${r.tool}: ${r.error || "ok"}`)
          .join("\n");
        entry += `\nTool results:\n${toolSummary}`;
      }
      return entry;
    });

    return `Recent turns:\n${lines.join("\n\n")}\n\n`;
  }

  /**
   * Compile latest user message section
   */
  compileMessageSection(prompt: string): string {
    return `Task: ${prompt}`;
  }

  /**
   * Compile system prompt blocks for caching
   */
  compileSystemBlocks(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>,
    tree: string,
    gitHead: string,
    ignorePatterns: string,
    provider: string,
    model?: string,
    memoryContext?: string,
  ): SystemBlock[] {
    const staticText = [
      loadProviderPrompt(model ?? provider).trim(),
      this.compileSystemPrompt(),
      compileInstructionsSection(this.projectPath),
      this.compileToolsSection(tools, provider, model),
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");

    const dynamicText = [
      this.compileProjectSummary(tree, gitHead, ignorePatterns),
      "",
      memoryContext ? `Session context:\n${memoryContext}` : "",
      `Current Time: ${new Date().toISOString()}`,
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");

    return [
      { text: staticText, cache: true },
      { text: dynamicText, cache: false },
    ];
  }

  /**
   * Compile full prompt from sections
   */
  compile(
    prompt: string,
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>,
    tree: string,
    gitHead: string,
    ignorePatterns: string,
    recentTurns: Array<{
      prompt: string;
      response: string;
      toolResults?: ToolResult[];
    }>,
    provider: string,
    model?: string,
    memoryContext?: string,
  ): string {
    const sections = [
      this.compileSystemPrompt(),
      "",
      this.compileToolsSection(tools, provider, model),
      "",
      this.compileProjectSummary(tree, gitHead, ignorePatterns),
      "",
      memoryContext ? `Session context:\n${memoryContext}\n` : "",
      this.compileHistorySection(recentTurns),
      "",
      this.compileMessageSection(prompt),
    ].filter((s) => s.length > 0);

    return sections.join("\n");
  }

  /**
   * Clear caches (useful for refresh)
   */
  static clearCaches(): void {
    toolSchemaCache.clear();
    fileTreeCache.clear();
  }

  /**
   * Clear tool schema cache for a specific provider
   */
  static clearToolSchemaCache(provider: string, model?: string): void {
    const key = getToolSchemasKey(provider, model);
    toolSchemaCache.delete(key);
  }
}
