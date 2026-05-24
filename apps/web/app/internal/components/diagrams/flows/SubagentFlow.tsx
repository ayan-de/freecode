import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';

export function SubagentFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-subagent-out"
        d="M 440 220 Q 380 180 370 150"
        stroke="url(#grad-subagent)"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={styles.flowLineSlow}
      />
      <polygon points="370,150 378,155 370,161" fill="#ec4899" />
      <text x="345" y="210" className={styles.connectionLabel} fill="#ec4899" textAnchor="end">delegate subtasks</text>

      <path
        id="flow-subagent-in"
        d="M 370 120 Q 400 120 440 240"
        stroke="url(#grad-subagent)"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={styles.flowLineSlow}
      />
      <polygon points="440,240 435,231 443,233" fill="#f97316" />
      <text x="430" y="115" className={styles.connectionLabel} fill="#f97316" textAnchor="start">results</text>
    </g>
  );
}