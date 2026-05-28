// =============================================================================
// File Tree Context Strategy
// Collects file tree and file contents up to maxDepth
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { ContextStrategy, ContextOptions, ProjectContext, ContextMetadata } from '../types.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  '.vscode', '.idea', '*.lock', '*.log', '.cache', '.temp',
];

export class FileTreeStrategy implements ContextStrategy {
  name = 'file-tree';

  async collect(projectPath: string, options: ContextOptions = {}): Promise<ProjectContext> {
    const {
      maxDepth = 3,
      ignorePatterns = DEFAULT_IGNORE,
    } = options;

    logger.info('Collecting project context', { projectPath, maxDepth });

    const { tree, files } = this.gatherContext(projectPath, ignorePatterns, maxDepth);

    const metadata: ContextMetadata = {
      collectedAt: Date.now(),
      fileCount: Object.keys(files).length,
      totalSize: Object.values(files).reduce((acc, content) => acc + content.length, 0),
    };

    logger.info('Context collected', { fileCount: metadata.fileCount });

    return {
      projectPath,
      name: path.basename(projectPath),
      tree,
      files,
      metadata,
    };
  }

  private gatherContext(
    dirPath: string,
    patterns: string[],
    maxDepth: number,
    currentDepth = 0
  ): { tree: string; files: Record<string, string> } {
    let tree = '';
    const files: Record<string, string> = {};

    if (currentDepth > maxDepth) return { tree, files };

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (this.shouldIgnore(fullPath, patterns)) continue;

        const indent = currentDepth > 0 ? '  '.repeat(currentDepth) : '';
        const icon = entry.isDirectory() ? '📁 ' : '📄 ';
        tree += `${indent}${icon}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

        if (entry.isFile()) {
          const relativePath = path.relative(process.cwd(), fullPath);
          files[relativePath] = this.readFile(fullPath);
        } else if (entry.isDirectory()) {
          const childContext = this.gatherContext(fullPath, patterns, maxDepth, currentDepth + 1);
          tree += childContext.tree;
          Object.assign(files, childContext.files);
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return { tree, files };
  }

  private shouldIgnore(filePath: string, patterns: string[]): boolean {
    const basename = path.basename(filePath);
    return patterns.some((pattern) => {
      if (pattern.startsWith('*')) return basename.endsWith(pattern.slice(1));
      return basename === pattern;
    });
  }

  private readFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return `// Error reading: ${filePath}`;
    }
  }
}