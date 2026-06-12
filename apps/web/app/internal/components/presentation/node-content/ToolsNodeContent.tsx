"use client";

import {
  Wrench,
  FileText,
  FileEdit,
  FilePlus,
  Search,
  FolderOpen,
} from "lucide-react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

const toolCategories = [
  {
    category: "File Operations",
    icon: FileText,
    color: "#a855f7",
    tools: [
      {
        name: "Read",
        icon: FileText,
        description: "Read files or directories",
      },
      {
        name: "Write",
        icon: FilePlus,
        description: "Create or overwrite files",
      },
      {
        name: "Edit",
        icon: FileEdit,
        description: "In-place editing with 9 strategies",
      },
      {
        name: "Glob",
        icon: FolderOpen,
        description: "Find files by glob patterns",
      },
    ],
  },
  {
    category: "Search",
    icon: Search,
    color: "#10b981",
    tools: [
      {
        name: "Grep",
        icon: Search,
        description: "Search file contents via regex",
      },
    ],
  },
];

const executionModes = [
  { mode: "Sequential", tools: "Write, Edit", color: "#f97316" },
  { mode: "Parallel", tools: "Read, Glob, Grep", color: "#10b981" },
];

export function ToolsNodeContent() {
  return (
    <>
      <NodeHeader
        icon={<Wrench size={20} color="#a855f7" />}
        title="Tool System"
        subtext="5 Built-in Tools"
      />
      <p className={styles.description}>
        Tools extend the AI model with file operations, search, and execution
        primitives. Results are returned to the{" "}
        <strong>LLM / Browser Call Boundary</strong> for the next iteration.
      </p>

      {/* Tool Categories */}
      {toolCategories.map((cat) => (
        <div
          key={cat.category}
          className={styles.toolCategory}
          style={{
            borderColor: `${cat.color}33`,
            background: `${cat.color}08`,
          }}
        >
          <div className={styles.toolCategoryHeader}>
            <cat.icon size={14} color={cat.color} />
            <span style={{ color: cat.color }}>{cat.category}</span>
          </div>
          <div className={styles.toolCategoryRow}>
            {cat.tools.map((tool) => (
              <div key={tool.name} className={styles.toolCard}>
                <tool.icon size={16} color={cat.color} />
                <span
                  className={styles.toolCardName}
                  style={{ color: cat.color }}
                >
                  {tool.name}
                </span>
                <span className={styles.toolCardDesc}>{tool.description}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Execution Modes */}
      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Execution Modes</h5>
        <div className={styles.execList}>
          {executionModes.map((exec) => (
            <div key={exec.mode} className={styles.execItem}>
              <span
                className={styles.execMode}
                style={{ background: exec.color }}
              >
                {exec.mode}
              </span>
              <span className={styles.execTools}>{exec.tools}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Source Links */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>Source Code</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Registry</span>
            <a
              href="file:///home/ayande/Project/freecode/apps/core/src/tools/index.ts"
              className={styles.fileLink}
            >
              apps/core/src/tools/index.ts
            </a>
          </li>
          <li>
            <span className={styles.fileBadge}>Orchestrator</span>
            <a
              href="file:///home/ayande/Project/freecode/apps/core/src/tools/orchestrator.ts"
              className={styles.fileLink}
            >
              apps/core/src/tools/orchestrator.ts
            </a>
          </li>
        </ul>
      </div>
    </>
  );
}
