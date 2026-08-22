import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";

// The tool-call gate, in the order agent/loop.ts actually runs it:
// PreToolUse hook -> evaluatePermission (mode + rules) -> PermissionRequest
// hook / interactive ask -> execute.
export function HooksFlow() {
  return (
    <g className={styles.flowLineGroup}>
      {/* Agent -> Hooks */}
      <path
        id="flow-to-hooks"
        d="M 562 286 Q 588 278 606 255"
        stroke="url(#grad-call)"
        strokeWidth="2"
        className={styles.flowLine}
        fill="none"
      />
      <polygon points="606,255 604,265 597,260" fill="#10b981" />
      <text
        x="588"
        y="212"
        className={styles.connectionLabel}
        fill="#f97316"
        textAnchor="middle"
      >
        call
      </text>

      {/* Hooks -> Permission */}
      <path
        id="flow-hooks-to-permission"
        d="M 625 216 L 625 188"
        stroke="#10b981"
        strokeWidth="2"
        className={styles.flowLine}
        fill="none"
      />
      <polygon points="625,182 620,191 630,191" fill="#f43f5e" />

      {/* Permission -> Tools */}
      <path
        id="flow-permission-to-tools"
        d="M 675 136 L 685 136"
        stroke="#f43f5e"
        strokeWidth="2"
        className={styles.flowLine}
        fill="none"
      />
      <polygon points="690,136 681,132 681,140" fill="#a855f7" />
    </g>
  );
}
