'use client';

import { useState, useEffect, useRef } from 'react';
import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

export function ContextNodeContent() {
  const [compilationStep, setCompilationStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCompilationStep(prev => (prev + 1) % 3);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <NodeHeader
        icon={<span>📄</span>}
        title="Context Engine"
        subtext="Convention Rules & Custom Skills"
      />
      <p className={styles.description}>
        FreeCode is project-aware! On session startup, the Context Engine loads <strong>AGENTS.md</strong> (prioritized) or falls back to <strong>CLAUDE.md</strong>. These files contain rules. It also loads reusable files called <strong>Skills</strong> from <code>.claude/skills/</code>.
      </p>
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Context Collector</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/context/collector.ts" className={styles.fileLink}>apps/cli/src/context/collector.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>File Tree generator</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/context/file-tree.ts" className={styles.fileLink}>apps/cli/src/context/file-tree.ts</a>
          </li>
        </ul>
      </div>
      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Startup Context Compilation Simulation</span>
          <span className={styles.emeraldPulse}></span>
        </div>
        <div className={styles.contextCompiler}>
          <div className={styles.compilerStep}>
            <span className={styles.stepIndicator}>PASS 1</span>
            <span>Scanning Workspace root for <strong>AGENTS.md</strong>... <span className={styles.greenText}>FOUND (Priority)</span></span>
          </div>
          <div className={styles.compilerStep}>
            <span className={styles.stepIndicator}>PASS 2</span>
            <span>Scanning <strong>.claude/skills/</strong> for custom behaviors... <span className={styles.greenText}>LOADED (2 skills)</span></span>
          </div>
          <div className={styles.compilerStep}>
            <span className={styles.stepIndicator}>PASS 3</span>
            <span>Constructing <strong>File Tree Map</strong>... <span className={styles.greenText}>OK (18 nodes mapped)</span></span>
          </div>
        </div>
      </div>
    </>
  );
}