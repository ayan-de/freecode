import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';

export function MemoryFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-memory-out"
        d="M 540 380 Q 640 450 710 470"
        stroke="url(#grad-memory)"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={styles.flowLineSlow}
      />
      <polygon points="710,470 701,466 705,474" fill="#f59e0b" />

      <path
        id="flow-memory-in"
        d="M 710 490 Q 610 470 520 380"
        stroke="url(#grad-memory)"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={styles.flowLineSlow}
      />
      <polygon points="520,380 528,386 521,389" fill="#f97316" />
      <text x="640" y="420" className={styles.connectionLabel} fill="#f59e0b" textAnchor="middle">read / write context</text>
    </g>
  );
}