import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";
import type { NodeType } from "../FreeCodeInternalDiagram";

interface HooksNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function HooksNode({ selectedNode, onSelectNode }: HooksNodeProps) {
  const isActive = selectedNode === "hooks";

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ""}`}
      onClick={() => onSelectNode("hooks")}
    >
      <circle
        cx="635"
        cy="200"
        r="26"
        className={styles.hooksCircle}
        filter="url(#glow-green)"
      />
      {/* Green glowing lightning bolt */}
      <path
        d="M 638 184 L 626 202 H 635 L 632 216 L 644 198 H 635 Z"
        fill="#10b981"
        className={styles.hooksLightning}
      />
      <text x="635" y="165" className={styles.hooksLabel} textAnchor="middle">
        Hooks
      </text>
      <text
        x="635"
        y="240"
        className={styles.hooksSublabel}
        textAnchor="middle"
      >
        (Permissions + Hooks)
      </text>
    </g>
  );
}
