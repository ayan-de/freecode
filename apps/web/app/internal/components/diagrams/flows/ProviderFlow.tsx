import React from 'react';
import styles from '../FreeCodeInternalDiagram.module.css';

export function ProviderFlow() {
  return (
    <g className={styles.flowLineGroup}>
      <path
        id="flow-provider-prompt"
        d="M 500 380 C 515 405 525 420 535 440"
        stroke="url(#grad-llm)"
        strokeWidth="2.4"
        className={styles.flowLine}
        fill="none"
      />
      <polygon points="535,440 526,431 538,429" fill="#38bdf8" />
      <rect x="530" y="405" width="78" height="18" rx="4" fill="#0b0b14" stroke="rgba(56,189,248,0.28)" strokeWidth="1" />
      <text x="569" y="418" className={styles.connectionLabel} fill="#7dd3fc" textAnchor="middle">
        prompt
      </text>

      <path
        id="flow-provider-response"
        d="M 485 440 C 455 420 452 397 465 380"
        stroke="#60a5fa"
        strokeWidth="2"
        className={styles.flowLineSlow}
        fill="none"
      />
      <polygon points="465,380 467,392 457,386" fill="#60a5fa" />
      <text x="438" y="414" className={styles.connectionLabel} fill="#bfdbfe" textAnchor="middle">
        response
      </text>
    </g>
  );
}
