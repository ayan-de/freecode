'use client';

import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

export function ToolsNodeContent() {
  return (
    <>
      <NodeHeader
        icon={<span>🛠️</span>}
        title="The Tools Execution Suite"
        subtext="CLI Capabilities Catalog"
      />
      <p className={styles.description}>
        The AI provider cannot interact with the operating system itself. It must select and invoke specialized <strong>Tools</strong> exposed by the CLI backend.
      </p>
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Tools Registry</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/tools/index.ts" className={styles.fileLink}>apps/cli/src/tools/index.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>Bash Executor</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/tools/bash.ts" className={styles.fileLink}>apps/cli/src/tools/bash.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>File Editor</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/tools/edit.ts" className={styles.fileLink}>apps/cli/src/tools/edit.ts</a>
          </li>
        </ul>
      </div>
      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Standard Tool JSON-Schema Contract</span>
          <span className={styles.purplePulse}></span>
        </div>
        <div className={styles.simConsole}>
          <pre className={styles.jsonCode}>{`{
  "id": "write_file",
  "description": "Create a new file or overwrite",
  "parameters": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string" },
      "content": { "type": "string" }
    },
    "required": ["filePath", "content"]
  }
}`}</pre>
        </div>
      </div>
    </>
  );
}