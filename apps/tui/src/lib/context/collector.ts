import type { ProjectContext, ContextOptions } from './types.js';
import { getStrategy } from './strategies/index.js';
import { logger } from '../utils/logger.js';
import { ok, err, type Result } from '../utils/result.js';

export async function collectContext(
  projectPath: string,
  strategyName = 'file-tree',
  options?: ContextOptions
): Promise<Result<ProjectContext, string>> {
  try {
    const strategy = getStrategy(strategyName);
    if (!strategy) {
      return err(`Unknown context strategy: ${strategyName}`);
    }

    const context = await strategy.collect(projectPath, options);
    return ok(context);
  } catch (error) {
    logger.error('Context collection failed', { error: String(error) });
    return err(`Failed to collect context: ${error instanceof Error ? error.message : String(error)}`);
  }
}