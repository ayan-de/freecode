import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';

export function TaskFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-task"
        d="M 150 300 H 400"
        stroke="url(#grad-task)"
        strokeWidth="2.5"
        className={styles.flowLine}
      />
      <polygon points="400,300 390,295 390,305" fill="#f97316" />
      <rect x="235" y="278" width="80" height="18" rx="4" fill="#0b0b14" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      <text x="275" y="291" className={styles.connectionLabel} fill="rgba(255,255,255,0.7)">JSON-RPC Task</text>
    </g>
  );
}