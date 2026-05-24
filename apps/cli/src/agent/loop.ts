// =============================================================================
// Agent Loop
// Orchestrates a single agent turn: context → prompt → parse → apply
// =============================================================================

import { PlaywrightBrowserController } from '../browser/controller.js';
import { createDefaultProviders, getProvider } from '../browser/providers/index.js';
import { collectContext } from '../context/collector.js';
import { createDefaultStrategies } from '../context/strategies/index.js';
import { parse } from '../parser/index.js';
import { applyChanges } from '../applier/index.js';
import { logger } from '../utils/logger.js';
import type { StreamCallback, AgentResult, StreamEvent } from './types.js';

createDefaultProviders();
createDefaultStrategies();

export interface ExecutorOptions {
  prompt: string;
  provider: string;
  projectPath: string;
  contextOptions?: {
    maxDepth?: number;
    ignorePatterns?: string[];
  };
}

export async function executePromptCycle(
  options: ExecutorOptions,
  onStream?: StreamCallback
): Promise<AgentResult> {
  const { prompt, provider, projectPath, contextOptions } = options;
  const errors: string[] = [];

  const providerDef = getProvider(provider);
  if (!providerDef) {
    return { success: false, filesCreated: 0, errors: [`Unknown provider: ${provider}`] };
  }

  const controller = new PlaywrightBrowserController();

  const emit = (event: StreamEvent) => {
    onStream?.(event);
  };

  try {
    emit({ type: 'status', content: 'Connecting to browser...' });
    await controller.connect();
    emit({ type: 'status', content: 'Browser connected' });

    emit({ type: 'status', content: `Loading ${providerDef.name}...` });
    await controller.navigate(providerDef);
    emit({ type: 'status', content: `${providerDef.name} loaded` });

    emit({ type: 'status', content: 'Collecting project context...' });
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

    emit({ type: 'status', content: 'Sending to AI...' });
    await controller.sendPrompt(fullPrompt);
    emit({ type: 'status', content: 'Waiting for response...' });

    const response = await controller.waitForResponse();
    emit({ type: 'status', content: 'Response received' });

    logger.info('Raw response length', { length: response.length });

    if (response.length < 50) {
      errors.push(`Response too short (${response.length} chars): ${response}`);
      emit({ type: 'error', content: `Response too short: ${response}` });
      return { success: false, filesCreated: 0, errors };
    }

    const parseResult = parse(response);

    if (!parseResult.success) {
      errors.push(`Parse failed: ${parseResult.error}`);
      emit({ type: 'error', content: 'Could not parse response' });
      emit({ type: 'text', content: response.slice(0, 500) + '...' });
      return { success: false, filesCreated: 0, errors };
    }

    const parsedResponse = parseResult.response!;
    emit({ type: 'status', content: `Summary: ${parsedResponse.summary}` });

    const fileChanges = parsedResponse.changes;
    emit({ type: 'status', content: `Applying ${fileChanges.length} file(s)...` });

    const applyResults = await applyChanges(fileChanges, projectPath);
    const succeeded = applyResults.filter(r => r.success).length;
    const failed = applyResults.filter(r => !r.success);

    if (failed.length > 0) {
      failed.forEach(f => {
        if (f.error) errors.push(f.error);
      });
    }

    emit({ type: 'done', content: `Done! Created ${succeeded}/${fileChanges.length} files` });

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
    emit({ type: 'error', content: errorMessage });
    return { success: false, filesCreated: 0, errors };
  } finally {
    await controller.disconnect();
  }
}