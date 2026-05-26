'use client';

import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

export function ProviderNodeContent() {
  return (
    <>
      <NodeHeader
        icon={<span>🌐</span>}
        title="LLM / Browser Call Boundary"
        subtext="External Provider Automation"
      />
      <p className={styles.description}>
        The CLI owns the browser automation path. The agent loop builds the task prompt, the browser controller fills the provider UI, and provider adapters isolate DOM selectors.
      </p>
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Prompt Cycle</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/agent/loop.ts" className={styles.fileLink}>apps/cli/src/agent/loop.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>Browser Driver</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/browser/controller.ts" className={styles.fileLink}>apps/cli/src/browser/controller.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>Provider Adapter</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/browser/providers/chatgpt.ts" className={styles.fileLink}>apps/cli/src/browser/providers/chatgpt.ts</a>
          </li>
        </ul>
      </div>
      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Current Browser Call Sequence</span>
          <span className={styles.bluePulse}></span>
        </div>
        <div className={styles.simConsole}>
          <pre className={styles.jsonCode}>{`agent/loop.ts
  -> controller.connect()
  -> controller.navigate(provider)
  -> controller.sendPrompt(fullPrompt)
  -> controller.waitForResponse()
  -> parser extracts file changes`}</pre>
        </div>
      </div>
    </>
  );
}