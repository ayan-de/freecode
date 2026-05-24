import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';
import type { NodeType } from '../FreeCodeInternalDiagram';

interface AgentNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function AgentNode({ selectedNode, onSelectNode }: AgentNodeProps) {
  const isActive = selectedNode === 'agent';

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ''}`}
      onClick={() => onSelectNode('agent')}
    >
      <rect
        x="390"
        y="220"
        width="180"
        height="160"
        rx="14"
        className={styles.nodeBoxAgent}
        filter="url(#glow-orange)"
      />

      {/* Orange spinner in background */}
      <g transform="translate(480, 290)" className={styles.gearGroup}>
        <circle r="30" stroke="#f97316" strokeWidth="2.5" strokeDasharray="10 5" fill="none" />
        <path d="M 0,-30 L 0,-25 M 0,30 L 0,25 M -30,0 L -25,0 M 30,0 L 25,0 M -21,-21 L -17,-17 M 21,21 L 17,17 M -21,21 L -17,17 M 21,-21 L 17,-17" stroke="#f97316" strokeWidth="3" />
        {/* Internal pulsing starburst */}
        <circle r="15" fill="#f97316" className={styles.pulsingCore} />
      </g>

      <rect x="430" y="335" width="100" height="16" rx="4" fill="#0b0b14" stroke="rgba(249,115,22,0.5)" />
      <text x="480" y="347" className={styles.agentTag} textAnchor="middle">⚙️ FreeCode AGENT</text>
      <text x="480" y="367" className={styles.agentLoopLabel} textAnchor="middle">Reasoning Loop</text>
    </g>
  );
}