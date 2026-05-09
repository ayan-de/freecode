import * as fs from 'fs';
import * as path from 'path';
import type { FileChange } from '../../lib/parser/types.js';
import { logger } from '../../lib/utils/logger.js';
import { ok, err, type Result } from '../../lib/utils/result.js';

export interface ApplyResult {
  path: string;
  success: boolean;
  error?: string;
}

export async function applyFileChange(
  change: FileChange,
  basePath: string
): Promise<Result<ApplyResult, string>> {
  const fullPath = path.join(basePath, change.path);

  try {
    if (change.action === 'delete') {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        logger.info('Deleted file', { path: change.path });
      }
      return ok({ path: change.path, success: true });
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (change.content !== undefined) {
      fs.writeFileSync(fullPath, change.content, 'utf-8');
      logger.info('Wrote file', { path: change.path, size: change.content.length });
      return ok({ path: change.path, success: true });
    }

    return err('No content provided for write/create');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to apply change', { path: change.path, error: errorMessage });
    return err(`Failed to ${change.action} ${change.path}: ${errorMessage}`);
  }
}

export async function applyChanges(
  changes: FileChange[],
  basePath: string
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const change of changes) {
    const result = await applyFileChange(change, basePath);
    results.push(result.success ? result.value : { path: change.path, success: false, error: result.error });
  }

  return results;
}