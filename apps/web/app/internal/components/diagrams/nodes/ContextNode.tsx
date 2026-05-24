import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';
import type { NodeType } from '../FreeCodeInternalDiagram';

interface ContextNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function ContextNode({ selectedNode, onSelectNode }: ContextNodeProps) {
  const isActive = selectedNode === 'context';

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ''}`}
      onClick={() => onSelectNode('context')}
    >
      <rect
        x="210"
        y="420"
        width="160"
        height="160"
        rx="12"
        className={styles.nodeBoxContext}
      />
      <text x="290" y="445" className={styles.nodeHeader} textAnchor="middle">
        📄 CONTEXT
      </text>
      <line x1="225" y1="455" x2="355" y2="455" stroke="rgba(255,255,255,0.1)" />

      {/* AGENTS.md document icon */}
      <g transform="translate(230, 468)">
        <rect width="55" height="60" rx="5" fill="#111827" stroke="rgba(16,185,129,0.4)" />
        <path d="M 12 15 H 43 M 12 25 H 43 M 12 35 H 30 M 12 45 H 25" stroke="rgba(16,185,129,0.5)" strokeWidth="2.5" />
        <text x="27.5" y="52" className={styles.docLabel} textAnchor="middle">AGENTS.md</text>
      </g>

      {/* Skills lightning icon */}
      <g transform="translate(300, 468)">
        <rect width="55" height="60" rx="5" fill="#111827" stroke="rgba(16,185,129,0.4)" />
        <path d="M 28 8 L 18 32 L 28 32 L 24 52 L 40 24 L 28 24 Z" fill="#10b981" />
        <text x="27.5" y="52" className={styles.docLabel} textAnchor="middle">Skills</text>
      </g>

      <text x="290" y="565" className={styles.nodeInfoLabel} textAnchor="middle">
        Project conventions
      </text>
    </g>
  );
}