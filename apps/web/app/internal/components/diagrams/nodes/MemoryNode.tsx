import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';
import type { NodeType } from '../FreeCodeInternalDiagram';

interface MemoryNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function MemoryNode({ selectedNode, onSelectNode }: MemoryNodeProps) {
  const isActive = selectedNode === 'memory';

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ''}`}
      onClick={() => onSelectNode('memory')}
    >
      {/* Database cylinders */}
      <g transform="translate(710, 440)">
        <rect x="0" y="0" width="100" height="130" rx="8" fill="rgba(11, 11, 20, 0.7)" stroke="rgba(245,158,11,0.2)" />

        <ellipse cx="50" cy="25" rx="35" ry="12" fill="rgba(245,158,11,0.2)" stroke="#f59e0b" strokeWidth="2" filter="url(#glow-amber)" />

        <path d="M 15 25 V 60 A 35 12 0 0 0 85 60 V 25" fill="none" stroke="#f59e0b" strokeWidth="2" />
        <ellipse cx="50" cy="60" rx="35" ry="12" fill="rgba(245,158,11,0.1)" stroke="#f59e0b" strokeWidth="1.5" />

        <path d="M 15 60 V 95 A 35 12 0 0 0 85 95 V 60" fill="none" stroke="#f59e0b" strokeWidth="2" />
        <ellipse cx="50" cy="95" rx="35" ry="12" fill="rgba(245,158,11,0.1)" stroke="#f59e0b" strokeWidth="1.5" />

        <text x="50" y="120" className={styles.dbLabel} textAnchor="middle">Memory</text>
      </g>

      {/* Compaction arrows */}
      <g transform="translate(825, 475)">
        <circle r="22" fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.3)" strokeWidth="1" strokeDasharray="3 3" />
        {/* compacting arrows */}
        <path d="M -10,-10 L 0,-3 L 10,-10 M -10,10 L 0,3 L 10,10 M -12,0 H 12" stroke="#f59e0b" strokeWidth="2" fill="none" />
        <text x="0" y="-28" className={styles.dbCompactLabel} textAnchor="middle">auto-compacts</text>
        <text x="0" y="34" className={styles.dbCompactLabel} textAnchor="middle">when full</text>
      </g>
    </g>
  );
}