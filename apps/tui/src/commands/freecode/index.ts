// =============================================================================
// Freecode Command — sends prompt to CLI via IPC
// =============================================================================

import { registerCommand, type Command, type CommandContext } from "../index.js";
import {
  startCli,
  stopCli,
  sessionStart,
  sessionStop,
  sessionStart as startSession,
  listProviders,
  type SessionInfo,
} from "../../ipc/client.js";

// State
let currentSession: SessionInfo | null = null;
let providersLoaded = false;
let cachedProviders: Array<{ id: string; name: string }> = [];

async function ensureProviders(): Promise<void> {
  if (!providersLoaded) {
    try {
      const providers = await listProviders();
      cachedProviders = providers.map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
      }));
    } catch {
      cachedProviders = [{ id: "chatgpt", name: "ChatGPT" }];
    }
    providersLoaded = true;
  }
}

function formatProviderList(): string {
  return cachedProviders
    .map((p) => `- **${p.name}** (${p.id})`)
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
      provider: "chatgpt",
    });
    return true;
  } catch (error) {
    ctx.showMessage(
      `❌ **Failed to start session:** ${error instanceof Error ? error.message : String(error)}`
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

**Example:** /freecode summarize this project and write at project.md

**Available providers:**
${formatProviderList()}`);
      return;
    }

    ctx.showMessage(`**You:** ${userPrompt}`);
    ctx.showMessage("🔄 **Processing...**");

    // Ensure CLI is running and we have a session
    const ready = await ensureSession(ctx);
    if (!ready) return;

    try {
      // TODO: Wire up session.send when CLI supports streaming
      // For now, just show a placeholder
      ctx.showMessage(
        "⏳ **AI processing...**\n\n(Full CLI integration coming in next step)"
      );
    } catch (error) {
      ctx.showMessage(
        `❌ **Error:** ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export function registerFreecodeCommand(): void {
  registerCommand(freecodeCommand);
}