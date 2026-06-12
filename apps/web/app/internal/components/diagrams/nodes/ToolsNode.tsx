import React from "react";
import styles from "../FreeCodeInternalDiagram.module.css";
import type { NodeType } from "../FreeCodeInternalDiagram";

interface ToolsNodeProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function ToolsNode({ selectedNode, onSelectNode }: ToolsNodeProps) {
  const isActive = selectedNode === "tools";

  return (
    <g
      className={`${styles.nodeGroup} ${isActive ? styles.activeNode : ""}`}
      onClick={() => onSelectNode("tools")}
    >
      <rect
        x="690"
        y="60"
        width="250"
        height="320"
        rx="16"
        className={styles.nodeBoxTools}
        filter="url(#glow-purple)"
      />
      <text
        x="815"
        y="90"
        className={styles.nodeHeaderTools}
        textAnchor="middle"
      >
        🛠️ TOOLS
      </text>
      <line x1="710" y1="102" x2="920" y2="102" stroke="rgba(168,85,247,0.3)" />

      {/* Interactive inner tool grids */}
      {/* Tool 1: FileRead / Write */}
      <g transform="translate(715, 115)">
        <rect
          width="95"
          height="85"
          rx="8"
          fill="rgba(168,85,247,0.08)"
          stroke="rgba(168,85,247,0.3)"
        />
        <path
          d="M 47.5,20 V 45 M 35,32 H 60 M 32,58 H 63"
          stroke="#a855f7"
          strokeWidth="2.5"
          fill="none"
        />
        <text
          x="47.5"
          y="70"
          className={styles.toolGridLabel}
          textAnchor="middle"
        >
          File Read/Write
        </text>
        <text
          x="47.5"
          y="79"
          className={styles.toolGridDesc}
          textAnchor="middle"
        >
          read.ts, write.ts
        </text>
      </g>

      {/* Tool 2: Bash Executor */}
      <g transform="translate(830, 115)">
        <rect
          width="95"
          height="85"
          rx="8"
          fill="rgba(168,85,247,0.08)"
          stroke="rgba(168,85,247,0.3)"
        />
        <rect
          x="25"
          y="22"
          width="45"
          height="30"
          rx="4"
          fill="#0b0b14"
          stroke="rgba(168,85,247,0.4)"
        />
        <text
          x="47.5"
          y="42"
          className={styles.terminalIconPrompt}
          textAnchor="middle"
        >
          &gt;_
        </text>
        <text
          x="47.5"
          y="70"
          className={styles.toolGridLabel}
          textAnchor="middle"
        >
          Bash Shell
        </text>
        <text
          x="47.5"
          y="79"
          className={styles.toolGridDesc}
          textAnchor="middle"
        >
          bash.ts
        </text>
      </g>

      {/* Tool 3: Web Search */}
      <g transform="translate(715, 215)">
        <rect
          width="95"
          height="85"
          rx="8"
          fill="rgba(168,85,247,0.08)"
          stroke="rgba(168,85,247,0.3)"
        />
        <circle
          cx="47.5"
          cy="35"
          r="14"
          fill="none"
          stroke="#a855f7"
          strokeWidth="2.5"
        />
        <line
          x1="56"
          y1="44"
          x2="68"
          y2="56"
          stroke="#a855f7"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <text
          x="47.5"
          y="70"
          className={styles.toolGridLabel}
          textAnchor="middle"
        >
          Grep Search
        </text>
        <text
          x="47.5"
          y="79"
          className={styles.toolGridDesc}
          textAnchor="middle"
        >
          grep.ts, find.ts
        </text>
      </g>

      {/* Tool 4: Glob Match */}
      <g transform="translate(830, 215)">
        <rect
          width="95"
          height="85"
          rx="8"
          fill="rgba(168,85,247,0.08)"
          stroke="rgba(168,85,247,0.3)"
        />
        <path
          d="M 47.5,20 L 47.5,50 M 32.5,35 H 62.5 M 37,24.5 L 58,45.5 M 37,45.5 L 58,24.5"
          stroke="#a855f7"
          strokeWidth="2"
        />
        <circle cx="47.5" cy="35" r="5" fill="#a855f7" />
        <text
          x="47.5"
          y="70"
          className={styles.toolGridLabel}
          textAnchor="middle"
        >
          Glob Match
        </text>
        <text
          x="47.5"
          y="79"
          className={styles.toolGridDesc}
          textAnchor="middle"
        >
          glob.ts
        </text>
      </g>

      <text
        x="815"
        y="322"
        className={styles.nodeInfoLabel}
        textAnchor="middle"
      >
        Action handler suite
      </text>
    </g>
  );
}
