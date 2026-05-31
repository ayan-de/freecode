// =============================================================================
// Freecode Command — sends prompt to CLI via IPC
// =============================================================================

import chalk from "chalk";
import { registerCommand, type Command, type CommandContext } from "../index.js";
import {
  startCli,
  sessionStart,
  sessionSend,
  listProviders,
  type SessionInfo,
} from "../../ipc/client.js";
import { playAlert } from "./alert.js";
import { getRandomElapsedPhrase, getRandomInProgressPhrase } from "../../utils/elapsed-phrases.js";
import { getModelContextLimit } from "../../utils/model-limits.js";
import { formatTokenCount } from "../../utils/format-tokens.js";
export { stopSound } from "./sound.js";

// State
let currentSession: SessionInfo | null = null;
let providersLoaded = false;
let cachedProviders: Array<{ id: string; name: string }> = [];
let currentProvider = "minimax";

async function ensureProviders(): Promise<void> {
  if (!providersLoaded) {
    try {
      const providers = await listProviders();
      cachedProviders = providers.map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
      }));
    } catch {
      cachedProviders = [{ id: "minimax", name: "MiniMax" }];
    }
    providersLoaded = true;
  }
}

function formatProviderList(): string {
  return cachedProviders
    .map((p) => `- **${p.name}** (${p.id})${p.id === currentProvider ? " *(current)*" : ""}`)
    .join("\n");
}

async function ensureSession(ctx: CommandContext): Promise<boolean> {
  if (currentSession) return true;

  startCli();
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    currentSession = await sessionStart({
      projectPath: process.cwd(),
      provider: currentProvider,
    });
    return true;
  } catch (error) {
    ctx.showMessage(
      `Failed to start session: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

const freecodeCommand: Command = {
  name: "freecode",
  description: "Send prompt to AI and apply file changes",
  execute: async (args, ctx) => {
    const userPrompt = args.join(" ");

    if (!userPrompt.trim()) {
      await ensureProviders();
      ctx.showMessage(`**Usage:** /freecode <your prompt>

**Example:** /freecode say hello

**Available providers:**
${formatProviderList()}`);
      return;
    }

    // Show user message with gray background
    ctx.createUserMessage(`**You:** ${userPrompt}`);

    // Show in-progress message and track it for later removal
    const inProgressMsg = ctx.createInProgressMessage(getRandomInProgressPhrase());
    const inProgressId = inProgressMsg.id;
    const startTime = Date.now();

    const ready = await ensureSession(ctx);
    if (!ready) return;

    try {
      const result = await sessionSend(currentSession!.sessionId, userPrompt);

      // Update in-progress message with token counts
      const contextLimit = getModelContextLimit(`${currentProvider}/MiniMax-M2`);
      ctx.updateInProgressMessage(
        inProgressId,
        getRandomInProgressPhrase(),
        result.usage?.inputTokens ?? 0,
        result.usage?.outputTokens ?? 0,
        contextLimit,
        startTime
      );

      // Brief pause so user can see final token state before it disappears
      await new Promise(resolve => setTimeout(resolve, 500));

      // Remove in-progress message now that response has arrived
      ctx.removeMessageById(inProgressId);

      const elapsed = Date.now() - startTime;
      const seconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const timeStr = minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;

      if (result.success) {
        const response = result.content || result.message;
        ctx.createAssistantMessage(`**FreeCode:** ${response || "Done!"}`);
        const inTokens = result.usage?.inputTokens ?? 0;
        const outTokens = result.usage?.outputTokens ?? 0;
        let tokenInfo = `↓${formatTokenCount(inTokens)} ↑${formatTokenCount(outTokens)}`;
        if (contextLimit > 0) {
          tokenInfo += ` [${formatTokenCount(inTokens)}/${formatTokenCount(contextLimit)}]`;
        }
        ctx.createSystemMessage(`${getRandomElapsedPhrase()} for ${timeStr} ${tokenInfo}`);
        playAlert();
      } else {
        ctx.createSystemMessage(`**Error:** ${result.message || "Unknown error"}`);
        ctx.createSystemMessage(`${getRandomElapsedPhrase()} for ${timeStr}`);
        playAlert();
      }
    } catch (error) {
      ctx.removeMessageById(inProgressId);
      ctx.showMessage(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
      playAlert();
    }
  },
};

export function registerFreecodeCommand(): void {
  registerCommand(freecodeCommand);
}