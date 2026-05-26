'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';
import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';
import { BoundaryDiagram } from '../../diagrams';

const FLOW_STEPS = [
  {
    number: 1,
    title: 'User Input',
    description: 'run() receives UserInput with prompt, sessionId, provider, projectPath',
    details: ['Session started with createInitialSessionState()', 'Status transitions: idle → starting → running'],
  },
  {
    number: 2,
    title: 'Collect Context',
    description: 'Gather project metadata and file tree',
    details: ['collectContext() reads project directory', 'Returns: { name, projectPath, tree }'],
  },
  {
    number: 3,
    title: 'Execute Turn',
    description: 'One iteration: build prompt → send → normalize → parse → execute',
    details: ['sendToProvider() sends prompt to AI via BrowserController', 'normalizeResponse() transforms provider output to AssistantContent[]', 'parseResponse() extracts ToolCall[] from normalized content'],
  },
  {
    number: 4,
    title: 'Continuous Loop',
    description: 'Cycle executes until goal is accomplished',
    details: ['evaluateLoopHealth() checks for stuck patterns', 'Checks: repeatedTools, stagnantTurns, oscillationScore, totalIterationLimit'],
  },
  {
    number: 5,
    title: 'Execute Tools',
    description: 'Run each tool sequentially, collect results',
    details: ['executeTool() runs each ToolCall', 'buildContinuationPrompt() formats results for next iteration', 'Loop back to step 3 with updated prompt'],
  },
  {
    number: 6,
    title: 'Loop Result',
    description: 'Exit when no more tools or health threshold reached',
    details: ['fail() returns on error', 'complete() returns success with turnCount, iterationCount', 'Post-sampling hooks: auto-compact, memory extract'],
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
        The <strong>Agent Loop</strong> is a <strong>continuous cycle</strong> that queries the AI provider,
        executes tools, and loops until the goal is accomplished. The loop implements the following flow:
      </p>

      <div className={styles.agentLoopLayout}>
        <div className={styles.agentLoopFlow}>
          <div className={styles.flowContainer}>
            {FLOW_STEPS.map((step, idx) => (
              <React.Fragment key={step.number}>
                <div className={styles.flowStep}>
                  <div className={styles.flowNumber}>{step.number}</div>
                  <div className={styles.flowContent}>
                    <h4 className={styles.flowTitle}>{step.title}</h4>
                    <p className={styles.flowDescription}>{step.description}</p>
                    <ul className={styles.flowDetails}>
                      {step.details.map((detail, i) => (
                        <li key={i}>{detail}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                {idx < FLOW_STEPS.length - 1 && <div className={styles.flowArrow}>↓</div>}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className={styles.agentLoopCharacteristics}>
          <h5 className={styles.characteristicsTitle}>Loop Characteristics</h5>
          <BoundaryDiagram
            layers={[
              {
                name: 'Continuous Execution',
                components: ['while(status === "running") loop', 'Checks maxIterations on each iteration', 'evaluateLoopHealth() detects stuck patterns'],
                color: 'rgba(249, 115, 22, 0.4)',
              },
              {
                name: 'Safety & Observability',
                components: ['Pre/Post hooks via HookRuntime', 'Loop health metrics tracked per turn', 'Tool results streamed back to AI'],
                color: 'rgba(168, 85, 247, 0.4)',
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
