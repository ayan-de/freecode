import { registerCommand, type Command, type CommandContext } from '../index.js';
import { selectProvider, formatProviderList } from './provider-mgr.js';
import { executePromptCycle } from './executor.js';
import { createDefaultProviders } from '../../lib/browser/providers/index.js';

createDefaultProviders();

const freecodeCommand: Command = {
  name: 'freecode',
  description: 'Send prompt to ChatGPT and apply file changes',
  execute: async (args, ctx) => {
    const userPrompt = args.join(' ');

    if (!userPrompt.trim()) {
      ctx.showMessage(`**Usage:** /freecode <your prompt>

**Example:** /freecode summarize this project and write at project.md

**Available providers:**
${formatProviderList()}`);
      return;
    }

    const provider = selectProvider();
    if (!provider) {
      ctx.showMessage('❌ **No provider available**');
      return;
    }

    const projectPath = process.cwd();

    const result = await executePromptCycle(
      { prompt: userPrompt, provider, projectPath },
      (status) => ctx.showMessage(status)
    );

    if (!result.success && result.errors.length > 0) {
      ctx.showMessage(`❌ **Errors:**\n${result.errors.map(e => `- ${e}`).join('\n')}`);
    }
  },
};

export function registerFreecodeCommand(): void {
  registerCommand(freecodeCommand);
}