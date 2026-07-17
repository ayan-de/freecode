"use client";

import React from "react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";
import { BoundaryDiagram } from "../../diagrams";

const FLOW_STEPS = [
  {
    number: 1,
    title: "run(UserInput)",
    description: "prompt, sessionId, provider, model, projectPath, agentMode",
  },
  {
    number: 2,
    title: "collectContext()",
    description: "served from tree-cache → { name, path, tree, gitHead }",
  },
  {
    number: 3,
    title: "SessionStart hook → loadHistory()",
    description: "restore session, idle-gap micro-compaction, push user message",
  },
  {
    number: 4,
    title: 'while (status === "running")',
    description: "maxIterations + evaluateLoopHealth() guard each turn",
  },
  {
    number: 5,
    title: "TurnStart hook → executeTurn()",
    description: "compileSystemBlocks(): tree + gitHead + memory → cached blocks",
  },
  {
    number: 6,
    title: "UserPromptSubmit hook",
    description: "may rewrite the system prompt before it is sent",
  },
  {
    number: 7,
    title: "sendToProvider()",
    description: "recovery wraps retries + fallback provider chain",
  },
  {
    number: 8,
    title: "provider.stream()",
    description: "text / thinking deltas, tool_call & usage streamed to the UI",
  },
  {
    number: 9,
    title: "collect ToolCall[]",
    description: "native function calls (or [TOOL_CALLS] text fallback)",
  },
  {
    number: 10,
    title: "planToolBatches() → executeTool()",
    description: "concurrency-safe tools run in parallel; others run solo",
  },
  {
    number: 11,
    title: "Pre / Permission / Post hooks per tool",
    description: "gate, approve, then orchestrator.execute() + stream results",
  },
  {
    number: 12,
    title: "updateLoopHealth() → TurnEnd hook",
    description: "append results, accumulate usage, recordDailyUsage()",
  },
  {
    number: 13,
    title: "No tool calls? → complete()",
    description: "otherwise increment turn and loop back to step 4",
  },
];

export function AgentNodeContent() {
  return (
    <>
      <NodeHeader
        title="#Agent Orchestrator Loop"
        subtext="Stateful Turning Loop"
      />

      <p className={styles.description}>
        The <strong>Agent Loop</strong> is a <strong>stateful, turn-based
        cycle</strong>. Each turn it compiles the system prompt (project tree,
        git head, and memory), streams a <strong>single call</strong> to the AI
        provider, and lets the model drive work by emitting{" "}
        <strong>native tool calls</strong>. Those calls are executed — in{" "}
        <strong>parallel batches</strong> where safe — and their results are
        folded back into the conversation for the next turn. The loop keeps
        spinning until the model returns a turn with <em>no</em> tool calls
        (the goal is met), a health check trips a stuck pattern, or the
        iteration cap is hit. Every turn is wrapped in lifecycle hooks and a
        recovery layer that retries transient failures and falls back to a
        secondary provider. The loop implements the following flow:
      </p>

      <div className={styles.agentLoopLayout}>
        <div className={styles.agentLoopFlow}>
          <div className={styles.flowContainer}>
            {FLOW_STEPS.map((step, idx) => (
              <React.Fragment key={step.number}>
                <div className={styles.flowStep}>
                  <div className={styles.flowContent}>
                    <h4 className={styles.flowTitle}>{step.title}</h4>
                    <p className={styles.flowDescription}>{step.description}</p>
                  </div>
                </div>
                {idx < FLOW_STEPS.length - 1 && (
                  <div className={styles.flowArrow}>↓</div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className={styles.agentLoopCharacteristics}>
          <h5 className={styles.characteristicsTitle}>Loop Characteristics</h5>
          <BoundaryDiagram
            layers={[
              {
                name: "Continuous Execution",
                components: [
                  'while(status === "running") loop',
                  "Single streamed provider call per turn",
                  "maxIterations + evaluateLoopHealth() guards",
                  "Ends on a turn with zero tool calls",
                ],
                color: "rgba(249, 115, 22, 0.4)",
              },
              {
                name: "Parallelism & Resilience",
                components: [
                  "planToolBatches() runs safe tools concurrently",
                  "Recovery: retry + fallback provider chain",
                  "AbortController cancels in-flight work",
                  "Memory compaction on token pressure",
                ],
                color: "rgba(59, 130, 246, 0.4)",
              },
              {
                name: "Safety & Observability",
                components: [
                  "Pre / Permission / Post hooks per tool",
                  "Loop-health metrics tracked per turn",
                  "Streamed events + rollout event sourcing",
                  "Per-turn usage → recordDailyUsage()",
                ],
                color: "rgba(168, 85, 247, 0.4)",
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
