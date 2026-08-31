// =============================================================================
// PromptCompiler - Mode-aware prompt building with caching
// PRIMARY: Build system prompt blocks: provider prompt, mode, instructions, project
// CACHING: File tree by git HEAD + ignore patterns
// =============================================================================

import type { AgentMode } from "../agent/types.js";
import type { SystemBlock } from "../providers/types.js";
import { compileInstructionsSection } from "./instructions.js";
import { loadSystemPrompt } from "../session/prompt.js";
import { renderAvailableSkillsSection } from "../skills/prompt.js";
import { buildMemoryGuidanceBlock } from "../memory/mem-prompt.js";

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
// System Prompt Segments
// ===========================================================================

/** A named part of the static system prompt. */
export interface SystemSegment {
  id: "system-prompt" | "project-instructions" | "skills" | "memory-guidance";
  label: string;
  /** "" when the section has nothing to contribute (no CLAUDE.md, no skills). */
  text: string;
}

/** Drop empty sections, then join — how every prompt section has been glued. */
function joinSections(parts: string[]): string {
  return parts.filter((s) => s.length > 0).join("\n\n");
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
    // Response-formatting guidance lives in the base system prompt
    // (session/prompt/system.txt); here we only add mode-specific behavior.
    return MODE_PROMPTS[this.agentMode];
  }

  /**
   * Compile project summary section.
   *
   * Not cached: the actual project-context cache lives in
   * `context/tree-cache.ts` (keyed on projectPath, watcher-invalidated). A
   * second cache here — keyed on gitHead but not on the `tree` string it
   * formats — used to serve a stale tree for up to 5 minutes whenever the
   * tree changed without HEAD moving (an uncommitted edit). This is a plain
   * string template, cheap enough that caching it bought nothing.
   */
  compileProjectSummary(tree: string): string {
    return `Project: ${this.projectName}
Path: ${this.projectPath}

File tree:
${tree}`;
  }

  /**
   * The static system prompt, split into the parts a human would name.
   *
   * compileSystemBlocks is a join over this, so `/context` can attribute tokens
   * to "project instructions" vs "skills" without maintaining a second, parallel
   * idea of what the prompt contains. Add a section here, not there, and the
   * breakdown picks it up for free.
   */
  async buildStaticSegments(
    provider: string,
    model?: string,
    skillsSection?: string,
  ): Promise<SystemSegment[]> {
    // Ground the model's identity so it never confuses itself with the vendor
    // whose model powers it (e.g. reporting itself as "Claude Code").
    const modelIdentity = model
      ? `You are powered by the model named ${model}.`
      : provider
        ? `You are powered by the ${provider} provider.`
        : "";

    // Advertise available skills (name + description only) so the model knows
    // which skills exist and can load one on demand via the `skill` tool.
    const skills =
      skillsSection ?? (await renderAvailableSkillsSection(this.projectPath));

    // Tools are sent as native schemas by the providers; no text list needed.
    return [
      {
        id: "system-prompt",
        label: "System prompt",
        text: joinSections([
          (await loadSystemPrompt()).trim(),
          modelIdentity,
          this.compileSystemPrompt(),
        ]),
      },
      {
        id: "project-instructions",
        label: "Project instructions",
        text: compileInstructionsSection(this.projectPath),
      },
      { id: "skills", label: "Skills", text: skills },
      {
        id: "memory-guidance",
        // Constant text — safe in the cached prefix. The memories themselves are
        // injected per turn by the loop, never here.
        label: "Memory guidance",
        text: buildMemoryGuidanceBlock(),
      },
    ];
  }

  /**
   * Compile the **static** system prompt block. Cached; its content never
   * changes within a session, so a breakpoint here is what makes the prefix
   * re-readable. Anything that changes between turns (file tree, memory, clock)
   * belongs in compileDynamicContext, inlined as a normal user message.
   */
  async compileSystemBlocks(
    provider: string,
    model?: string,
    skillsSection?: string,
  ): Promise<SystemBlock[]> {
    const segments = await this.buildStaticSegments(
      provider,
      model,
      skillsSection,
    );
    return [
      { text: joinSections(segments.map((s) => s.text)), cache: true },
    ];
  }

  /**
   * The dynamic half: project summary (file tree + git head), optional session
   * memory, and a coarse-grained clock. Returned as a single text block so the
   * loop can inline it as the conversation's first user message.
   *
   * The loop freezes tree/gitHead/clock per session (session-context.ts) so
   * this block stays byte-stable across turns — sitting inside the system
   * blocks instead would invalidate the static prefix on every change.
   *
   * Claude Code splits at SYSTEM_PROMPT_DYNAMIC_BOUNDARY for the same reason
   * (utils/api.ts:321, splitSysPromptPrefix) and moves dynamic content out
   * when MCP tools are present. Our equivalent is just to never merge the two.
   */
  compileDynamicContext(
    tree: string,
    gitHead: string,
    ignorePatterns: string,
    memoryContext?: string,
    /**
     * When set (session freeze), reuse this clock instead of wall time so
     * position 0 does not rewrite itself on the hour boundary.
     */
    clock?: string,
  ): string {
    const roundedTime =
      clock ?? new Date().toISOString().slice(0, 13) + ":00:00Z";
    return [
      this.compileProjectSummary(tree),
      "",
      memoryContext ? `Session context:\n${memoryContext}` : "",
      `Current Time: ${roundedTime}`,
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
}
