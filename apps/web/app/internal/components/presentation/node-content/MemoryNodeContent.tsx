"use client";

import React from "react";
import { Brain, FileText, Zap, Database } from "lucide-react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

const MEMORY_FLOW_STEPS = [
  {
    number: 1,
    title: "addMessage(role, content)",
    description:
      "MemoryService records each turn, truncates long tool output, and estimates its token cost",
  },
  {
    number: 2,
    title: "shouldCompact(model)",
    description:
      "Trigger when tokenCount passes the model's context limit minus the auto-compact buffer",
  },
  {
    number: 3,
    title: "selectForCompaction()",
    description:
      "Keep the last 2 user turns (bounded by token caps); mark everything older to summarize",
  },
  {
    number: 4,
    title: "runPreCompact() hook",
    description:
      "PreCompact may block — if it does, retry is deferred until +5k more tokens accumulate",
  },
  {
    number: 5,
    title: "summarizeMessages()",
    description:
      "Fold old turns into an anchored summary: Goal · Done · In Progress · Files · Next Steps",
  },
  {
    number: 6,
    title: "commit + runPostCompact() hook",
    description:
      "Replace history with [summary + preserved turns], persist, then notify PostCompact",
  },
];

const memoryComponents = [
  {
    name: "MemoryService",
    file: "apps/core/src/compaction/service.ts",
    description: "Orchestrates recording, threshold checks, and compaction",
    icon: Brain,
    color: "#f59e0b",
  },
  {
    name: "FileMemoryStorage",
    file: "apps/core/src/compaction/storage.ts",
    description: "JSON persistence of session memory state",
    icon: Database,
    color: "#f59e0b",
  },
  {
    name: "tokens.ts",
    file: "apps/core/src/compaction/tokens.ts",
    description: "Token estimation + per-model context limits",
    icon: Zap,
    color: "#f59e0b",
  },
  {
    name: "selector.ts",
    file: "apps/core/src/compaction/selector.ts",
    description: "selectForCompaction — preserve recent, summarize old",
    icon: FileText,
    color: "#f59e0b",
  },
  {
    name: "summarizer.ts",
    file: "apps/core/src/compaction/summarizer.ts",
    description: "Anchored summary carrying forward the previous one",
    icon: FileText,
    color: "#f59e0b",
  },
];

const compactionStats = [
  { label: "preserveRecentTurns", value: "2 turns" },
  { label: "autoCompactBufferTokens", value: "13,000" },
  { label: "warningBufferTokens", value: "20,000" },
  { label: "maxPreserveRecentTokens", value: "8,000" },
  { label: "minPreserveRecentTokens", value: "2,000" },
  { label: "maxToolOutputChars", value: "2,000" },
];

export function MemoryNodeContent() {
  return (
    <>
      <NodeHeader
        title="Memory & Log Compaction"
        subtext="Session Context Compaction"
      />
      <p className={styles.description}>
        The <strong>compaction system</strong> keeps long sessions inside the
        model&apos;s context window. After each turn the loop asks{" "}
        <strong>MemoryService</strong> whether the running token count has
        crossed the model&apos;s budget; when it has, older turns are folded
        into an <strong>anchored summary</strong> while the most recent turns
        are preserved verbatim. The whole thing is <strong>model-aware</strong>{" "}
        (context limits per model) and <strong>hook-gated</strong> (PreCompact
        can veto, PostCompact is notified). A separate idle-gap micro-compaction
        in the loop also trims stale tool output on cold restarts.
      </p>

      {/* Memory Flow */}
      <div className={`${styles.flowContainer} ${styles.memoryFlow}`}>
        {MEMORY_FLOW_STEPS.map((step, idx) => (
          <React.Fragment key={step.number}>
            <div className={styles.flowStep}>
              <div className={styles.flowContent}>
                <h4 className={styles.flowTitle}>{step.title}</h4>
                <p className={styles.flowDescription}>{step.description}</p>
              </div>
            </div>
            {idx < MEMORY_FLOW_STEPS.length - 1 && (
              <div className={styles.flowArrow}>↓</div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Key Files */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Memory Components</h5>
        <ul className={styles.filesList}>
          {memoryComponents.map((comp) => (
            <li key={comp.name}>
              <span className={styles.fileBadge}>{comp.name}</span>
              <span style={{ color: comp.color, fontSize: "12px" }}>
                {comp.description}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Compaction Stats */}
      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Compaction Config</h5>
        <div className={styles.execList}>
          {compactionStats.map((stat) => (
            <div key={stat.label} className={styles.execItem}>
              <span
                className={styles.execMode}
                style={{ background: "#f59e0b" }}
              >
                {stat.label}
              </span>
              <span className={styles.execTools}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
