import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";
import type { NodeType } from "../FreeCodeInternalDiagram";

interface BusNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function BusNode({ selectedNode, onSelectNode }: BusNodeProps) {
  const isActive = selectedNode === "bus";

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ""}`}
      onClick={() => onSelectNode("bus")}
    >
      {/* Vertical spine just inside the sandbox's left edge — the single
          doorway every core event travels through to reach the clients. */}
      <rect
        x="184"
        y="230"
        width="26"
        height="210"
        rx="10"
        className={styles.nodeBoxBus}
        filter="url(#glow-cyan)"
      />

      {/* Little event chips riding the bus */}
      <circle cx="197" cy="262" r="3.5" fill="#22d3ee" />
      <circle cx="197" cy="335" r="3.5" fill="#22d3ee" />
      <circle cx="197" cy="408" r="3.5" fill="#22d3ee" />

      {/* Vertical labels (read bottom-to-top) */}
      <text
        transform="translate(194 335) rotate(-90)"
        className={styles.busLabel}
        textAnchor="middle"
      >
        EVENT BUS
      </text>
      <text
        transform="translate(205 335) rotate(-90)"
        className={styles.busSublabel}
        textAnchor="middle"
      >
        pub / sub
      </text>
    </g>
  );
}
