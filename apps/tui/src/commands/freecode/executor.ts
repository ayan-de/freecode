import { PlaywrightBrowserController } from '../../lib/browser/controller.js';
import { collectContext } from '../../lib/context/collector.js';
import { parse } from '../../lib/parser/index.js';
import { applyChanges } from './file-applier.js';
import { type SelectedProvider } from './provider-mgr.js';
import { logger } from '../../lib/utils/logger.js';
import { createDefaultStrategies } from '../../lib/context/strategies/index.js';

createDefaultStrategies();

export interface ExecutorOptions {
  prompt: string;
  provider: SelectedProvider;
  projectPath: string;
  contextOptions?: {
    maxDepth?: number;
    ignorePatterns?: string[];
  };
}

export interface ExecutorResult {
  success: boolean;
  summary?: string;
  filesCreated: number;
  errors: string[];
}

export async function executePromptCycle(
  options: ExecutorOptions,
  onStatus: (message: string) => void
): Promise<ExecutorResult> {
  const { prompt, provider, projectPath, contextOptions } = options;
  const errors: string[] = [];

  const controller = new PlaywrightBrowserController();

  try {
    onStatus('🔄 **Connecting to browser...**');
    await controller.connect();
    onStatus('✅ **Browser connected**');

    onStatus('✅ **Loading ChatGPT...**');
    await controller.navigate(provider.definition);
    onStatus(`✅ **${provider.name} loaded**`);

    onStatus('📁 **Collecting project context...**');
    const contextResult = await collectContext(projectPath, 'file-tree', contextOptions);

    if (!contextResult.success) {
      errors.push(`Context collection failed: ${contextResult.error}`);
      return { success: false, filesCreated: 0, errors };
    }

    const context = contextResult.value;

    const fullPrompt = `Project: ${context.name}
Path: ${context.projectPath}

File tree:
${context.tree}

Task: ${prompt}

IMPORTANT: Respond with file operations in this EXACT format:
FILE: <relative-path>
\`\`\`
<file-content>
\`\`\`

Create or modify files as needed to complete the task.`;

    onStatus('📤 **Sending to ChatGPT...**');
    await controller.sendPrompt(fullPrompt);
    onStatus('⏳ **Waiting for response...**');

    const response = await controller.waitForResponse();
    onStatus('✅ **Response received**');

    logger.info('Raw response length', { length: response.length });
    logger.debug('Response preview', { preview: response.slice(0, 300) });

    if (response.length < 50) {
      errors.push(`Response too short (${response.length} chars): ${response}`);
      onStatus(`⚠️ **Response too short:** ${response}`);
      return { success: false, filesCreated: 0, errors };
    }

    const parseResult = parse(response);

    logger.debug('Parse result', { success: parseResult.success, error: parseResult.error });

    if (!parseResult.success) {
      errors.push(`Parse failed: ${parseResult.error}`);
      onStatus('⚠️ **Could not parse response**');
      onStatus('```\n' + response.slice(0, 500) + '...\n```');
      return { success: false, filesCreated: 0, errors };
    }

    const parsedResponse = parseResult.response!;
    onStatus(`📝 **Summary:** ${parsedResponse.summary}`);

    const fileChanges = parsedResponse.changes;
    onStatus(`📋 **Applying ${fileChanges.length} file(s)...**`);

    const applyResults = await applyChanges(fileChanges, projectPath);
    const succeeded = applyResults.filter(r => r.success).length;
    const failed = applyResults.filter(r => !r.success);

    if (failed.length > 0) {
      failed.forEach(f => {
        if (f.error) errors.push(f.error);
      });
    }

    onStatus(`✨ **Done!** Created ${succeeded}/${fileChanges.length} files`);

    return {
      success: errors.length === 0,
      summary: parsedResponse.summary,
      filesCreated: succeeded,
      errors,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Executor failed', { error: errorMessage });
    errors.push(errorMessage);
    return { success: false, filesCreated: 0, errors };
  } finally {
    await controller.disconnect();
  }
}