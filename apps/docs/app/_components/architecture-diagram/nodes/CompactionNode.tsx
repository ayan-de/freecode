import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";
import type { NodeType } from "../FreeCodeInternalDiagram";

export function CompactionNode({
  selectedNode,
  onSelectNode,
}: {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}) {
  const isActive = selectedNode === "compaction";

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ""}`}
      onClick={() => onSelectNode("compaction")}
    >
      <rect
        x="845"
        y="430"
        width="120"
        height="140"
        rx="12"
        className={styles.nodeBoxCompaction}
        filter="url(#glow-teal)"
      />
      <text
        x="905"
        y="452"
        className={styles.compactionHeader}
        textAnchor="middle"
      >
        COMPACTION
      </text>
      <line
        x1="857"
        y1="460"
        x2="953"
        y2="460"
        stroke="rgba(45,212,191,0.3)"
      />

      {/* Token meter — fills toward the threshold, then collapses */}
      <rect
        x="857"
        y="470"
        width="96"
        height="12"
        rx="3"
        fill="rgba(45,212,191,0.06)"
        stroke="rgba(45,212,191,0.35)"
      />
      <rect
        x="859"
        y="472"
        height="8"
        rx="2"
        fill="#2dd4bf"
        className={styles.compactionMeterFill}
      />
      <line
        x1="933"
        y1="468"
        x2="933"
        y2="484"
        stroke="rgba(45,212,191,0.8)"
        strokeWidth="1.5"
      />
      <text
        x="905"
        y="496"
        className={styles.compactionSubtext}
        textAnchor="middle"
      >
        context window
      </text>

      {/* Collapse arrow into the summary chip */}
      <path
        d="M 898 503 L 905 511 L 912 503"
        fill="none"
        stroke="#2dd4bf"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <rect
        x="875"
        y="517"
        width="60"
        height="20"
        rx="5"
        fill="rgba(45,212,191,0.12)"
        stroke="rgba(45,212,191,0.45)"
      />
      <text
        x="905"
        y="531"
        className={styles.compactionChipText}
        textAnchor="middle"
      >
        summary
      </text>

      <text
        x="905"
        y="555"
        className={styles.nodeInfoLabel}
        textAnchor="middle"
      >
        on window overflow
      </text>
    </g>
  );
}
