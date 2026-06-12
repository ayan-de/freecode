"use client";

import { useState, useEffect, useRef } from "react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

export function SubagentsNodeContent() {
  const [subAgentState, setSubAgentState] = useState<
    "idle" | "spawning" | "running" | "done"
  >("idle");
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    clearAllTimers();
    setSubAgentState("idle");

    const cycleSubAgents = () => {
      setSubAgentState("spawning");

      const t1 = setTimeout(() => setSubAgentState("running"), 2000);
      timersRef.current.push(t1);

      const t2 = setTimeout(() => setSubAgentState("done"), 6000);
      timersRef.current.push(t2);

      const t3 = setTimeout(() => {
        setSubAgentState("idle");
        const loopTimer = setTimeout(cycleSubAgents, 2000);
        timersRef.current.push(loopTimer);
      }, 9500);
      timersRef.current.push(t3);
    };

    const delayStart = setTimeout(cycleSubAgents, 1000);
    timersRef.current.push(delayStart);
    return () => clearAllTimers();
  }, []);

  const clearAllTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  return (
    <>
      <NodeHeader
        icon={<span>🤖</span>}
        title="Parallel Sub-Agents"
        subtext="Distributed AI Workforces"
      />

      <p className={styles.description}>
        For large or complex tasks, the main agent orchestrator can delegate
        discrete tasks to <strong>Sub-Agents</strong>. Each sub-agent runs in
        its own isolated browser context, executing specialized tasks
        concurrently and aggregates the code changes back to the main thread.
      </p>

      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Sub-Agent Spawner</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/core/src/tools/index.ts"
              className={styles.fileLink}
            >
              apps/core/src/tools/index.ts
            </a>
          </li>
          <li>
            <span className={styles.fileBadge}>Agent Router</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/core/src/agent/loop.ts"
              className={styles.fileLink}
            >
              apps/core/src/agent/loop.ts
            </a>
          </li>
        </ul>
      </div>

      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Parallel Thread Manager</span>
          <span className={styles.pinkPulse}></span>
        </div>
        <div className={styles.threadsDashboard}>
          <div className={styles.threadRow}>
            <span className={styles.threadName}>Parent Orchestrator</span>
            {subAgentState === "idle" && (
              <span className={`${styles.statusLabel} ${styles.statusIdle}`}>
                IDLE
              </span>
            )}
            {subAgentState === "spawning" && (
              <span className={`${styles.statusLabel} ${styles.statusWorking}`}>
                DIVIDING TASK...
              </span>
            )}
            {subAgentState === "running" && (
              <span className={`${styles.statusLabel} ${styles.statusWorking}`}>
                MONITORING THREADS...
              </span>
            )}
            {subAgentState === "done" && (
              <span className={`${styles.statusLabel} ${styles.statusSuccess}`}>
                AGGRAGATING CHANGELIST
              </span>
            )}
          </div>

          <div
            className={`${styles.threadRow} ${subAgentState === "running" ? styles.threadRunning : ""}`}
          >
            <span className={styles.threadName}>
              🧵 Thread #1 (Code Reviewer)
            </span>
            {subAgentState === "idle" && (
              <span className={`${styles.statusLabel} ${styles.statusIdle}`}>
                OFFLINE
              </span>
            )}
            {subAgentState === "spawning" && (
              <span
                className={`${styles.statusLabel} ${styles.statusSpawning}`}
              >
                SPAWNING BROWSER...
              </span>
            )}
            {subAgentState === "running" && (
              <span className={`${styles.statusLabel} ${styles.statusActive}`}>
                RUNNING STATIC ANALYSIS
              </span>
            )}
            {subAgentState === "done" && (
              <span className={`${styles.statusLabel} ${styles.statusSuccess}`}>
                COMPLETED (3 findings)
              </span>
            )}
          </div>

          <div
            className={`${styles.threadRow} ${subAgentState === "running" ? styles.threadRunning : ""}`}
          >
            <span className={styles.threadName}>
              🧵 Thread #2 (Unit Tester)
            </span>
            {subAgentState === "idle" && (
              <span className={`${styles.statusLabel} ${styles.statusIdle}`}>
                OFFLINE
              </span>
            )}
            {subAgentState === "spawning" && (
              <span
                className={`${styles.statusLabel} ${styles.statusSpawning}`}
              >
                SPAWNING BROWSER...
              </span>
            )}
            {subAgentState === "running" && (
              <span className={`${styles.statusLabel} ${styles.statusActive}`}>
                WRITING db.test.ts
              </span>
            )}
            {subAgentState === "done" && (
              <span className={`${styles.statusLabel} ${styles.statusSuccess}`}>
                COMPLETED (4 tests written)
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
