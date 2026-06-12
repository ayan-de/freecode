import React from "react";
import styles from "./FreeCodeInternalDiagram.module.css";

export function SandboxContainer() {
  return (
    <g className={styles.sandboxContainer}>
      <rect
        x="180"
        y="20"
        width="800"
        height="605"
        rx="14"
        className={styles.outerSandbox}
      />
      <rect x="200" y="25" width="280" height="24" rx="6" fill="#121225" />
      <text x="215" y="42" className={styles.outerSandboxTitle}>
        &gt;_ FREECODE CLI BACKEND (DAEMON)
      </text>
    </g>
  );
}
