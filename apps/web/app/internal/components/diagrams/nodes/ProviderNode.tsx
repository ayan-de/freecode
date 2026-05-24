import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';
import type { NodeType } from '../FreeCodeInternalDiagram';

interface ProviderNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function ProviderNode({ selectedNode, onSelectNode }: ProviderNodeProps) {
  const isActive = selectedNode === 'provider';

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ''}`}
      onClick={() => onSelectNode('provider')}
    >
      <rect
        x="460"
        y="440"
        width="150"
        height="130"
        rx="14"
        className={styles.nodeBoxProvider}
        filter="url(#glow-blue)"
      />
      <text x="535" y="466" className={styles.providerHeader} textAnchor="middle">
        LLM / BROWSER
      </text>
      <line x1="476" y1="478" x2="594" y2="478" stroke="rgba(96,165,250,0.35)" />

      <rect x="480" y="492" width="110" height="30" rx="7" fill="rgba(56,189,248,0.12)" stroke="rgba(56,189,248,0.45)" />
      <text x="535" y="511" className={styles.providerCardText} textAnchor="middle">
        Browser UI
      </text>

      <rect x="480" y="530" width="110" height="26" rx="7" fill="rgba(96,165,250,0.1)" stroke="rgba(96,165,250,0.38)" />
      <text x="535" y="547" className={styles.providerCardText} textAnchor="middle">
        ChatGPT / Claude
      </text>

      <text x="535" y="564" className={styles.providerSubtext} textAnchor="middle">
        external provider
      </text>
    </g>
  );
}
