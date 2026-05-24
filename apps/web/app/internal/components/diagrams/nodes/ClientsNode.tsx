import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';
import type { NodeType } from '../FreeCodeInternalDiagram';

interface ClientsNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function ClientsNode({ selectedNode, onSelectNode }: ClientsNodeProps) {
  const isActive = selectedNode === 'clients';

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ''}`}
      onClick={() => onSelectNode('clients')}
    >
      <rect
        x="10"
        y="200"
        width="140"
        height="200"
        rx="12"
        className={styles.nodeBoxClients}
      />
      {/* Header / Title */}
      <text x="80" y="235" className={styles.nodeHeader} textAnchor="middle">
        YOU / CLIENTS
      </text>
      <line x1="25" y1="245" x2="135" y2="245" stroke="rgba(255,255,255,0.1)" />

      {/* Sub-cards */}
      {/* TUI */}
      <rect x="25" y="260" width="110" height="45" rx="6" fill="rgba(129, 140, 248, 0.15)" stroke="rgba(129, 140, 248, 0.4)" />
      <text x="80" y="280" className={styles.subCardText} textAnchor="middle">Terminal TUI</text>
      <text x="80" y="293" className={styles.subCardDesc} textAnchor="middle">pi-tui rendering</text>

      {/* VS Code Extension */}
      <rect x="25" y="315" width="110" height="45" rx="6" fill="rgba(129, 140, 248, 0.15)" stroke="rgba(129, 140, 248, 0.4)" />
      <text x="80" y="335" className={styles.subCardText} textAnchor="middle">VSCode Ext</text>
      <text x="80" y="348" className={styles.subCardDesc} textAnchor="middle">React webview</text>

      <text x="80" y="382" className={styles.nodeInfoLabel} textAnchor="middle">
        Thin clients
      </text>
    </g>
  );
}