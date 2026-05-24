import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';

export function ResultFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-result"
        d="M 690 320 C 640 320 590 320 570 320"
        stroke="rgba(168,85,247,0.85)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="8 6"
        className={styles.flowLine}
        fill="none"
      />
      <polygon points="570,320 580,315 580,325" fill="rgba(168,85,247,1)" />
      <rect x="605" y="332" width="60" height="18" rx="4" fill="#0b0b14" stroke="rgba(168,85,247,0.26)" strokeWidth="1" />
      <text x="635" y="344" className={styles.connectionLabel} fill="rgba(255,255,255,0.76)" textAnchor="middle">result</text>
    </g>
  );
}