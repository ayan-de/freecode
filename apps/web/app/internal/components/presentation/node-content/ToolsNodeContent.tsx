"use client";

import {
  FileText,
  FileEdit,
  FilePlus,
  FolderOpen,
  Search,
  Code,
  Terminal,
  Bot,
  Globe,
  Download,
  Sparkles,
  ListTodo,
  HelpCircle,
} from "lucide-react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

const toolCategories = [
  {
    category: "File Operations",
    icon: FileText,
    color: "#a855f7",
    tools: [
      { name: "Read", icon: FileText, description: "Read file contents" },
      { name: "Write", icon: FilePlus, description: "Create or overwrite files" },
      { name: "Edit", icon: FileEdit, description: "In-place string replacement" },
    ],
  },
  {
    category: "Search & Code Intelligence",
    icon: Search,
    color: "#10b981",
    tools: [
      { name: "Glob", icon: FolderOpen, description: "Find files by glob pattern" },
      { name: "Grep", icon: Search, description: "Regex search over file contents" },
      { name: "Lsp", icon: Code, description: "Language-server diagnostics & hover" },
    ],
  },
  {
    category: "Execution & Delegation",
    icon: Terminal,
    color: "#f97316",
    tools: [
      { name: "Bash", icon: Terminal, description: "Run shell commands" },
      { name: "Agent", icon: Bot, description: "Spawn a sub-agent for a subtask" },
    ],
  },
  {
    category: "Web Access",
    icon: Globe,
    color: "#38bdf8",
    tools: [
      { name: "WebFetch", icon: Download, description: "Fetch and read a URL" },
      { name: "WebSearch", icon: Globe, description: "Search the web" },
    ],
  },
  {
    category: "Workflow",
    icon: Sparkles,
    color: "#ec4899",
    tools: [
      { name: "Skill", icon: Sparkles, description: "Load a specialized skill" },
      { name: "TodoWrite", icon: ListTodo, description: "Track a task checklist" },
      { name: "Question", icon: HelpCircle, description: "Ask the user for input" },
    ],
  },
];

const executionModes = [
  {
    mode: "Parallel",
    tools: "Read, Grep, Glob, Lsp, WebFetch, WebSearch, Skill",
    color: "#10b981",
  },
  {
    mode: "Sequential",
    tools: "Write, Edit, Bash, Agent, TodoWrite, Question",
    color: "#f97316",
  },
];

export function ToolsNodeContent() {
  return (
    <>
      <NodeHeader title="Tool System" subtext="13 Built-in Tools + MCP" />
      <p className={styles.description}>
        Tools are how the model acts on the world. FreeCode ships{" "}
        <strong>13 built-in tools</strong> — file I/O, search, code
        intelligence, shell, web access, and sub-agents — plus any tools exposed
        dynamically over <strong>MCP</strong>. Each is built through{" "}
        <strong>factory.ts</strong> and run by the <strong>orchestrator</strong>,
        which batches concurrency-safe tools to run in parallel and executes
        mutating tools one at a time.
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
            <span className={styles.fileLink}>apps/core/src/tools/index.ts</span>
          </li>
          <li>
            <span className={styles.fileBadge}>Factory</span>
            <span className={styles.fileLink}>apps/core/src/tools/factory.ts</span>
          </li>
          <li>
            <span className={styles.fileBadge}>Orchestrator</span>
            <span className={styles.fileLink}>
              apps/core/src/tools/orchestrator.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Batching</span>
            <span className={styles.fileLink}>
              apps/core/src/tools/batching.ts
            </span>
          </li>
        </ul>
      </div>
    </>
  );
}
