import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';

export function HooksFlow() {
  return (
    <g className={styles.flowLineGroup}>
      {/* Agent -> Hooks */}
      <path
        id="flow-to-hooks"
        d="M 560 280 Q 600 240 625 210"
        stroke="url(#grad-call)"
        strokeWidth="2"
        className={styles.flowLine}
      />
      <text x="590" y="240" className={styles.connectionLabel} fill="#f97316" textAnchor="end">call</text>

      {/* Hooks -> Tools */}
      <path
        id="flow-hooks-to-tools"
        d="M 645 190 Q 660 170 690 160"
        stroke="#10b981"
        strokeWidth="2"
        className={styles.flowLine}
      />
      <polygon points="690,160 681,158 684,166" fill="#10b981" />
    </g>
  );
}