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
        title="Parallel Sub-Agents"
        subtext="Isolated Nested Agent Loops · 4 Roles"
      />

      <p className={styles.description}>
        For large or branching tasks, the main loop delegates independent
        subtasks through the <strong>agent</strong> tool. Each sub-agent is a
        fresh <strong>AgentLoop</strong> with its own session id, tool set, and
        iteration budget (default <strong>20</strong>) — fully isolated from the
        parent&apos;s history. Read-only roles run in <strong>explore</strong>{" "}
        mode, write-capable roles in <strong>build</strong> mode. Progress is
        published on the bus (<code>subagentStarted</code> /{" "}
        <code>subagentCompleted</code>) and the final result is returned to the
        parent turn.
      </p>

      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Spawner Tool</span>
            <span className={styles.fileLink}>
              apps/core/src/tools/agent.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Sub-Agent Runtime</span>
            <span className={styles.fileLink}>
              apps/core/src/agent/subagent.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Nested Loop</span>
            <span className={styles.fileLink}>
              apps/core/src/agent/loop.ts
            </span>
          </li>
        </ul>
      </div>

      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Sub-Agent Roles</h5>
        <div className={styles.execList}>
          <div className={styles.execItem}>
            <span className={styles.execMode} style={{ background: "#3b82f6" }}>
              explorer
            </span>
            <span className={styles.execTools}>
              Search the codebase (read-only)
            </span>
          </div>
          <div className={styles.execItem}>
            <span className={styles.execMode} style={{ background: "#10b981" }}>
              reviewer
            </span>
            <span className={styles.execTools}>
              Review for bugs, security, performance (read-only)
            </span>
          </div>
          <div className={styles.execItem}>
            <span className={styles.execMode} style={{ background: "#f97316" }}>
              tester
            </span>
            <span className={styles.execTools}>
              Write and run tests (build mode)
            </span>
          </div>
          <div className={styles.execItem}>
            <span className={styles.execMode} style={{ background: "#a855f7" }}>
              summarizer
            </span>
            <span className={styles.execTools}>
              Summarize conversations, docs, or code (read-only)
            </span>
          </div>
        </div>
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
                AGGREGATING RESULTS
              </span>
            )}
          </div>

          <div
            className={`${styles.threadRow} ${subAgentState === "running" ? styles.threadRunning : ""}`}
          >
            <span className={styles.threadName}>
              🧵 reviewer (explore mode)
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
                SPAWNING SUB-LOOP...
              </span>
            )}
            {subAgentState === "running" && (
              <span className={`${styles.statusLabel} ${styles.statusActive}`}>
                REVIEWING FOR BUGS
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
              🧵 tester (build mode)
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
                SPAWNING SUB-LOOP...
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
