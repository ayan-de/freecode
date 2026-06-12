import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";

export function TaskFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-task"
        d="M 150 300 C 230 300 310 300 392 300"
        stroke="rgba(249,115,22,0.85)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="8 6"
        className={styles.flowLine}
        fill="none"
      />
      <polygon points="392,300 382,295 382,305" fill="rgba(249,115,22,0.85)" />
      <rect
        x="226"
        y="278"
        width="98"
        height="18"
        rx="4"
        fill="#0b0b14"
        stroke="rgba(249,115,22,0.26)"
        strokeWidth="1"
      />
      <text
        x="275"
        y="291"
        className={styles.connectionLabel}
        fill="rgba(255,255,255,0.76)"
        textAnchor="middle"
      >
        JSON-RPC Task
      </text>
    </g>
  );
}
