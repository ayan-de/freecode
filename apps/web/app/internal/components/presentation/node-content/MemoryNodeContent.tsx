'use client';

import React from 'react';
import { Brain, FileText, Zap, Database } from 'lucide-react';
import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

const MEMORY_FLOW_STEPS = [
  {
    number: 1,
    title: 'addMessage(role, content)',
    description: 'Record each turn in MemoryService',
  },
  {
    number: 2,
    title: 'shouldCompact(provider)',
    description: 'Check if token count exceeds threshold',
  },
  {
    number: 3,
    title: 'runPreCompact()',
    description: 'HookRuntime PreCompact hook — can block',
  },
  {
    number: 4,
    title: 'selectForCompaction()',
    description: 'Preserve recent turns, select older for summary',
  },
  {
    number: 5,
    title: 'summarizeMessages()',
    description: 'Generate anchored continuation summary',
  },
  {
    number: 6,
    title: 'runPostCompact()',
    description: 'HookRuntime PostCompact hook — notify',
  },
];

const memoryComponents = [
  {
    name: 'MemoryService',
    file: 'apps/core/src/memory/service.ts',
    description: 'Orchestrates compaction, recording, persistence',
    icon: Brain,
    color: '#f59e0b',
  },
  {
    name: 'FileMemoryStorage',
    file: 'apps/core/src/memory/storage.ts',
    description: 'JSON persistence under .freecode/sessions/',
    icon: Database,
    color: '#f59e0b',
  },
  {
    name: 'tokens.ts',
    file: 'apps/core/src/memory/tokens.ts',
    description: 'Token estimation and context budgets',
    icon: Zap,
    color: '#f59e0b',
  },
  {
    name: 'selector.ts',
    file: 'apps/core/src/memory/selector.ts',
    description: 'selectForCompaction + renderPromptMemoryContext',
    icon: FileText,
    color: '#f59e0b',
  },
  {
    name: 'summarizer.ts',
    file: 'apps/core/src/memory/summarizer.ts',
    description: 'Anchored summary with Goal, Progress, Files',
    icon: FileText,
    color: '#f59e0b',
  },
];

const compactionStats = [
  { label: 'preserveRecentTurns', value: '2' },
  { label: 'autoCompactBuffer', value: '13,000 tokens' },
  { label: 'maxPreserveRecent', value: '8,000 tokens' },
  { label: 'maxToolOutputChars', value: '2,000 chars' },
];

export function MemoryNodeContent() {
  return (
    <>
      <NodeHeader
        icon={<Brain size={24} color="#f59e0b" />}
        title="Memory & Log Compaction"
        subtext="Session Context Compaction"
      />
      <p className={styles.description}>
        The <strong>Memory System</strong> prevents context window overflow during long sessions
        by compacting old messages into anchored summaries while preserving recent turns.
      </p>

      {/* Memory Flow */}
      <div className={`${styles.flowContainer} ${styles.memoryFlow}`}>
        {MEMORY_FLOW_STEPS.map((step) => (
          <div key={step.number} className={styles.flowStep}>
            <div className={styles.flowContent}>
              <h4 className={styles.flowTitle}>{step.title}</h4>
              <p className={styles.flowDescription}>{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Key Files */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Memory Components</h5>
        <ul className={styles.filesList}>
          {memoryComponents.map((comp) => (
            <li key={comp.name}>
              <span className={styles.fileBadge}>{comp.name}</span>
              <span style={{ color: comp.color, fontSize: '12px' }}>{comp.description}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Compaction Stats */}
      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Compaction Config</h5>
        <div className={styles.execList}>
          {compactionStats.map((stat) => (
            <div key={stat.label} className={styles.execItem}>
              <span className={styles.execMode} style={{ background: '#f59e0b' }}>{stat.label}</span>
              <span className={styles.execTools}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}