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
import { playSound } from "./sound.js";
import { playAlert } from "./alert.js";

// State
let currentSession: SessionInfo | null = null;
let providersLoaded = false;
let cachedProviders: Array<{ id: string; name: string }> = [];
let currentProvider = "minimax"; // Default to minimax

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

  // Small delay to let CLI start
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

    ctx.showMessage(`**You:** ${userPrompt}`);
    ctx.showMessage("Processing...");

    // Play sound while processing
    // playSound();

    // Track start time for elapsed display
    const startTime = Date.now();

    // Ensure CLI is running and we have a session
    const ready = await ensureSession(ctx);
    if (!ready) return;

    try {
      const result = await sessionSend(currentSession!.sessionId, userPrompt) as {
        success: boolean;
        message?: string;
        content?: string;
        turnCount?: number;
        iterationCount?: number;
      };

      // Calculate elapsed time
      const elapsed = Date.now() - startTime;
      const seconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const timeStr = minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;

      if (result.success) {
        const response = result.content || result.message;
        ctx.showMessage(`**FreeCode:** ${response || "Done!"}`);
        ctx.showMessage(chalk.dim(`Baked for ${timeStr}`));
        // stopSound();
        playAlert();
      } else {
        ctx.showMessage(`**FreeCode:** ${result.message || "Unknown error"}`);
        // stopSound();
        playAlert();
      }
    } catch (error) {
      ctx.showMessage(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    //   stopSound();
      playAlert();
    }
  },
};

export function registerFreecodeCommand(): void {
  registerCommand(freecodeCommand);
}