'use client';

import { useState } from 'react';
import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

export function HooksNodeContent() {
  const [activeHookSafety, setActiveHookSafety] = useState<'safe' | 'unsafe'>('safe');

  return (
    <>
      <NodeHeader
        icon={<span>⚡</span>}
        title="Hooks Safety Middleware"
        subtext="Pre & Post Execution Interceptors"
      />
      <p className={styles.description}>
        To protect the user's computer, FreeCode pipes every tool call through a strict <strong>Hooks Middleware Pipeline</strong>. Pre-hooks inspect the command and can completely block malicious queries.
      </p>
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Middleware Loop</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/core/src/agent/loop.ts" className={styles.fileLink}>apps/core/src/agent/loop.ts</a>
          </li>
        </ul>
      </div>
      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Safety Middleware Simulator Playground</span>
          <span className={styles.emeraldPulse}></span>
        </div>
        <div className={styles.hooksSandbox}>
          <div className={styles.hooksToggle}>
            <button
              className={`${styles.toggleBtn} ${activeHookSafety === 'safe' ? styles.toggleActiveSafe : ''}`}
              onClick={() => setActiveHookSafety('safe')}
            >
              Test Safe Command
            </button>
            <button
              className={`${styles.toggleBtn} ${activeHookSafety === 'unsafe' ? styles.toggleActiveUnsafe : ''}`}
              onClick={() => setActiveHookSafety('unsafe')}
            >
              Test Dangerous Command
            </button>
          </div>
          <div className={styles.sandboxOutput}>
            {activeHookSafety === 'safe' ? (
              <div className={styles.hookConsoleLog}>
                <div className={styles.hookLogLine}><span className={styles.hookInfo}>[INFO]</span> Intercepting tool request: <code>read_file("src/db.ts")</code></div>
                <div className={styles.hookLogLine}><span className={styles.hookPre}>[PRE-EXEC]</span> Scanning parameters... Safe action verified.</div>
                <div className={styles.hookLogLine}><span className={styles.hookSuccess}>[STATUS]</span> Executing tool read_file...</div>
                <div className={styles.hookLogLine}><span className={styles.hookPost}>[POST-EXEC]</span> Action logged. Returning output chunk (142 bytes) to AI loop.</div>
              </div>
            ) : (
              <div className={styles.hookConsoleLog}>
                <div className={styles.hookLogLine}><span className={styles.hookInfo}>[INFO]</span> Intercepting tool request: <code>run_bash("rm -rf /")</code></div>
                <div className={styles.hookLogLine}><span className={styles.hookPre}>[PRE-EXEC]</span> Scanning parameters... <span className={styles.errorText}>DANGEROUS PATTERN MATCHED!</span></div>
                <div className={styles.hookLogBlockAlert}>
                  🛑 ERROR: COMMAND BLOCKED!
                  <div style={{ fontSize: '11px', marginTop: '4px', fontWeight: 'normal', color: 'rgba(255, 255, 255, 0.7)' }}>
                    The PreExecute Hooks daemon has terminated the execution.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}