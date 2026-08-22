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
        cx="625"
        cy="240"
        r="24"
        className={styles.hooksCircle}
        filter="url(#glow-green)"
      />
      {/* Green glowing lightning bolt */}
      <path
        d="M 628 224 L 616 242 H 625 L 622 256 L 634 238 H 625 Z"
        fill="#10b981"
        className={styles.hooksLightning}
      />
      <text x="625" y="283" className={styles.hooksLabel} textAnchor="middle">
        Hooks
      </text>
      <text
        x="625"
        y="295"
        className={styles.hooksSublabel}
        textAnchor="middle"
      >
        PreToolUse
      </text>
    </g>
  );
}
