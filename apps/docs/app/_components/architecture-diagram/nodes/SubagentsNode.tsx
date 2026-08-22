import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";
import type { NodeType } from "../FreeCodeInternalDiagram";

interface SubagentsNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function SubagentsNode({
  selectedNode,
  onSelectNode,
}: SubagentsNodeProps) {
  const isActive = selectedNode === "subagents";

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ""}`}
      onClick={() => onSelectNode("subagents")}
    >
      <rect
        x="210"
        y="60"
        width="160"
        height="140"
        rx="12"
        className={styles.nodeBoxSubagents}
      />
      <text x="290" y="85" className={styles.nodeHeader} textAnchor="middle">
        💾 SUB-AGENTS
      </text>
      <line x1="225" y1="95" x2="355" y2="95" stroke="rgba(255,255,255,0.1)" />

      {/* Mini chip sub-agent cards */}
      <g transform="translate(225, 108)">
        <rect
          width="60"
          height="42"
          rx="4"
          fill="rgba(236,72,153,0.1)"
          stroke="rgba(236,72,153,0.3)"
        />
        <rect x="5" y="5" width="10" height="10" rx="2" fill="#ec4899" />
        <text x="8" y="27" className={styles.miniCardTitle}>
          Sub-Agent
        </text>
        <text x="8" y="36" className={styles.miniCardSub}>
          Explorer
        </text>
      </g>

      <g transform="translate(295, 108)">
        <rect
          width="60"
          height="42"
          rx="4"
          fill="rgba(236,72,153,0.1)"
          stroke="rgba(236,72,153,0.3)"
        />
        <rect x="5" y="5" width="10" height="10" rx="2" fill="#ec4899" />
        <text x="8" y="27" className={styles.miniCardTitle}>
          Sub-Agent
        </text>
        <text x="8" y="36" className={styles.miniCardSub}>
          Tester
        </text>
      </g>

      <text
        x="290"
        y="185"
        className={styles.nodeInfoLabel}
        textAnchor="middle"
      >
        Parallel execution
      </text>
    </g>
  );
}
