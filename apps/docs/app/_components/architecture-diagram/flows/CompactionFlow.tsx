import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";

// Hung off the provider edge, not Memory: compaction trims the live transcript
// so the request stays under the model's context window, and the threshold is
// judged against provider-reported token counts. Persistent memory is a
// separate store and deliberately has no edge to this.
export function CompactionFlow() {
  return (
    <g className={styles.flowLineGroup}>
      {/* Provider-bound history -> Compaction */}
      <path
        id="flow-compact-out"
        d="M 500 572 L 500 590 Q 500 596 506 596 L 894 596 Q 900 596 900 590 L 900 574"
        stroke="url(#grad-compact-out)"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={styles.flowLineSlow}
        fill="none"
      />
      <polygon points="900,572 896,581 904,581" fill="#2dd4bf" />

      {/* Compaction -> trimmed history */}
      <path
        id="flow-compact-in"
        d="M 916 574 L 916 608 Q 916 614 910 614 L 546 614 Q 540 614 540 608 L 540 572"
        stroke="url(#grad-compact-in)"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={styles.flowLineSlow}
        fill="none"
      />
      <polygon points="540,572 536,581 544,581" fill="#60a5fa" />

      <text
        x="618"
        y="588"
        className={styles.connectionLabel}
        fill="#5eead4"
        textAnchor="middle"
      >
        session history ⇄ summary
      </text>
    </g>
  );
}
