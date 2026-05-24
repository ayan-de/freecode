import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';

export function ResultFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-result"
        d="M 690 320 H 560"
        stroke="url(#grad-result)"
        strokeWidth="2"
        className={styles.flowLine}
      />
      <polygon points="560,320 570,315 570,325" fill="#f97316" />
      <text x="625" y="340" className={styles.connectionLabel} fill="#a855f7" textAnchor="middle">result</text>
    </g>
  );
}