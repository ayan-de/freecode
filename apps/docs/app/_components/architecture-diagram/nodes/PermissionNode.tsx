import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";
import type { NodeType } from "../FreeCodeInternalDiagram";

export function PermissionNode({
  selectedNode,
  onSelectNode,
}: {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}) {
  const isActive = selectedNode === "permission";

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ""}`}
      onClick={() => onSelectNode("permission")}
    >
      <rect
        x="575"
        y="90"
        width="100"
        height="92"
        rx="12"
        className={styles.nodeBoxPermission}
        filter="url(#glow-rose)"
      />
      <text
        x="625"
        y="111"
        className={styles.permissionHeader}
        textAnchor="middle"
      >
        PERMISSION
      </text>
      <line
        x1="587"
        y1="119"
        x2="663"
        y2="119"
        stroke="rgba(244,63,94,0.3)"
      />

      {/* Shield — the gate every tool call passes through */}
      <g className={styles.permissionShield}>
        <path
          d="M 625 127 L 638 132 V 144 Q 638 154 625 159 Q 612 154 612 144 V 132 Z"
          fill="rgba(244,63,94,0.12)"
          stroke="#f43f5e"
          strokeWidth="2"
        />
        <path
          d="M 619 142 L 623.5 147 L 631 138"
          fill="none"
          stroke="#f43f5e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      <text
        x="625"
        y="174"
        className={styles.permissionSubtext}
        textAnchor="middle"
      >
        allow · ask · deny
      </text>
    </g>
  );
}
