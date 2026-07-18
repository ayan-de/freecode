import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";
import type { NodeType } from "../FreeCodeInternalDiagram";

interface ClientsNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function ClientsNode({ selectedNode, onSelectNode }: ClientsNodeProps) {
  const isActive = selectedNode === "clients";

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ""}`}
      onClick={() => onSelectNode("clients")}
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

      {/* Sub-cards — all four thin-client frontends */}
      {/* TUI */}
      <rect
        x="25"
        y="252"
        width="110"
        height="28"
        rx="6"
        fill="rgba(129, 140, 248, 0.15)"
        stroke="rgba(129, 140, 248, 0.4)"
      />
      <text x="80" y="264" className={styles.subCardText} textAnchor="middle">
        Terminal TUI
      </text>
      <text x="80" y="274" className={styles.subCardDesc} textAnchor="middle">
        pi-tui
      </text>

      {/* VS Code Extension */}
      <rect
        x="25"
        y="282"
        width="110"
        height="28"
        rx="6"
        fill="rgba(129, 140, 248, 0.15)"
        stroke="rgba(129, 140, 248, 0.4)"
      />
      <text x="80" y="294" className={styles.subCardText} textAnchor="middle">
        VSCode Ext
      </text>
      <text x="80" y="304" className={styles.subCardDesc} textAnchor="middle">
        React webview
      </text>

      {/* Web (Next.js) */}
      <rect
        x="25"
        y="312"
        width="110"
        height="28"
        rx="6"
        fill="rgba(129, 140, 248, 0.15)"
        stroke="rgba(129, 140, 248, 0.4)"
      />
      <text x="80" y="324" className={styles.subCardText} textAnchor="middle">
        Web
      </text>
      <text x="80" y="334" className={styles.subCardDesc} textAnchor="middle">
        Next.js
      </text>

      {/* Desktop (Tauri) */}
      <rect
        x="25"
        y="342"
        width="110"
        height="28"
        rx="6"
        fill="rgba(129, 140, 248, 0.15)"
        stroke="rgba(129, 140, 248, 0.4)"
      />
      <text x="80" y="354" className={styles.subCardText} textAnchor="middle">
        Desktop
      </text>
      <text x="80" y="364" className={styles.subCardDesc} textAnchor="middle">
        Tauri + Vite
      </text>

      <text x="80" y="388" className={styles.nodeInfoLabel} textAnchor="middle">
        Thin clients
      </text>
    </g>
  );
}
