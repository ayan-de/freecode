'use client';

import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

const tools = [
  {
    category: 'File Operations',
    items: [
      { name: 'Read', description: 'Read files or directories', params: ['filePath', 'offset?', 'limit?'] },
      { name: 'Write', description: 'Create or overwrite files', params: ['filePath', 'content'] },
      { name: 'Edit', description: 'In-place editing with 9 strategies', params: ['filePath', 'oldString', 'newString', 'replaceAll?'] },
      { name: 'Glob', description: 'Find files by glob patterns', params: ['pattern', 'path?'] },
    ],
    color: '#a855f7',
  },
  {
    category: 'Search',
    items: [
      { name: 'Grep', description: 'Search file contents via regex', params: ['pattern', 'path?', 'include?', '-i?'] },
    ],
    color: '#7c3aed',
  },
];

const executionModes = [
  { mode: 'Sequential', tools: 'Edit, Write', color: '#f97316' },
  { mode: 'Parallel-safe', tools: 'Read, Glob, Grep', color: '#10b981' },
];

export function ToolsNodeContent() {
  return (
    <>
      <NodeHeader
        icon={<span>🛠️</span>}
        title="Tool System"
        subtext="5 Built-in Tools"
      />
      <p className={styles.description}>
        Tools extend the AI model's capabilities by exposing file operations, search, and execution primitives.
      </p>

      {/* Tool Categories */}
      <div className={styles.toolsGrid}>
        {tools.map((category) => (
          <div key={category.category} className={styles.toolCategory}>
            <h5 className={styles.toolCatTitle} style={{ color: category.color }}>
              {category.category}
            </h5>
            <div className={styles.toolList}>
              {category.items.map((tool) => (
                <div key={tool.name} className={styles.toolItem}>
                  <span className={styles.toolName} style={{ color: category.color }}>{tool.name}</span>
                  <span className={styles.toolDesc}>{tool.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Execution Modes */}
      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Execution Modes</h5>
        <div className={styles.execList}>
          {executionModes.map((exec) => (
            <div key={exec.mode} className={styles.execItem}>
              <span className={styles.execMode} style={{ background: exec.color }}>{exec.mode}</span>
              <span className={styles.execTools}>{exec.tools}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Source Links */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>Source Code</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Registry</span>
            <a href="file:///home/ayande/Project/freecode/apps/cli/src/tools/index.ts" className={styles.fileLink}>apps/cli/src/tools/index.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>Orchestrator</span>
            <a href="file:///home/ayande/Project/freecode/apps/cli/src/tools/orchestrator.ts" className={styles.fileLink}>apps/cli/src/tools/orchestrator.ts</a>
          </li>
        </ul>
      </div>
    </>
  );
}
