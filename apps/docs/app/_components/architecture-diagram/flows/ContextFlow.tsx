import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";

export function ContextFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-context"
        d="M 370 500 Q 420 500 450 380"
        stroke="url(#grad-context)"
        strokeWidth="2"
        className={styles.flowLine}
      />
      <polygon points="450,380 443,388 451,388" fill="#f97316" />
      <text
        x="445"
        y="475"
        className={styles.connectionLabel}
        fill="#10b981"
        textAnchor="end"
      >
        on startup
      </text>
    </g>
  );
}
