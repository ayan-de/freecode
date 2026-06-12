"use client";

import React from "react";
import { RefreshCw } from "lucide-react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";
import { BoundaryDiagram } from "../../diagrams";

const FLOW_STEPS = [
  {
    number: 10,
    title: "User types message",
    description: "keyboard input or piped stdin",
  },
  {
    number: 1,
    title: "run() receives UserInput",
    description: "prompt, sessionId, provider, projectPath",
  },
  {
    number: 2,
    title: "collectContext()",
    description: "reads project directory → { name, path, tree }",
  },
  {
    number: 3,
    title: "while running",
    description: "evaluateLoopHealth() checks stuck patterns",
  },
  {
    number: 4,
    title: "sendToProvider() → getProvider()",
    description: "provider registry → AI provider execute()",
  },
  {
    number: 5,
    title: "normalizeResponse()",
    description: "transform raw → AssistantContent[]",
  },
  {
    number: 6,
    title: "parseResponse()",
    description: "extract ToolCall[] from content",
  },
  {
    number: 7,
    title: "executeTool()",
    description: "run each tool sequentially, collect results",
  },
  {
    number: 8,
    title: "buildContinuationPrompt()",
    description: "format results → next iteration",
  },
];

export function AgentNodeContent() {
  return (
    <>
      <NodeHeader
        icon={<RefreshCw size={24} />}
        title="Agent Orchestrator Loop"
        subtext="Stateful Turning Loop"
      />

      <p className={styles.description}>
        The <strong>Agent Loop</strong> is a <strong>continuous cycle</strong>{" "}
        that queries the AI provider, executes tools, and loops until the goal
        is accomplished. The loop implements the following flow:
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
                  "Checks maxIterations on each iteration",
                  "evaluateLoopHealth() detects stuck patterns",
                ],
                color: "rgba(249, 115, 22, 0.4)",
              },
              {
                name: "Safety & Observability",
                components: [
                  "Pre/Post hooks via HookRuntime",
                  "Loop health metrics tracked per turn",
                  "Tool results streamed back to AI",
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
