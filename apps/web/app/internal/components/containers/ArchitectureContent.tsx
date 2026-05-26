'use client';

import { useState, useRef, useEffect } from 'react';
import { ArchitectureDiagram, BoundaryDiagram, FreeCodeInternalDiagram, type NodeType } from '../diagrams';
import { ArchitectureExplorer, IntroSection } from '../presentation';
import styles from './ArchitectureContent.module.css';

export function OverviewContainer() {
  const [selectedNode, setSelectedNode] = useState<NodeType | null>(null);
  const explorerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedNode) {
      const timer = setTimeout(() => {
        explorerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [selectedNode]);

  return (
    <div className={styles.container}>
      {/* TODO: unused section - comment out
      <div className={styles.introSection}>
        <IntroSection
          title="Interactive Blueprint & Execution Engine"
          description="FreeCode operates as a persistent CLI daemon coordinating a stateful Agent Loop, pluggable Safety Hooks, a local Context Engine, and parallelized Sub-Agents. Select any card or node in the interactive blueprint below to explore deep architectural insights, links to source code files, and simulated execution logs!"
        />
      </div>
*/}

      <div className={styles.fullWidthDiagram}>
        <FreeCodeInternalDiagram
          selectedNode={selectedNode}
          onSelectNode={setSelectedNode}
        />
      </div>

      {selectedNode && (
        <div ref={explorerRef} className={styles.bottomExplorer}>
          <ArchitectureExplorer
            selectedNode={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        </div>
      )}

      <div className={styles.grid} style={{ marginTop: '32px' }}>
        <div className={styles.section} style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.sectionTitle}>System Domain Boundaries</h3>
          <BoundaryDiagram layers={BOUNDARY_LAYERS} />
        </div>
      </div>
    </div>
  );
}

const BOUNDARY_LAYERS = [
  {
    name: 'CLI (All Intelligence)',
    components: ['Browser Controller', 'Agent Loop', 'Parser', 'Tools', 'Context Engine'],
    color: 'rgba(99, 102, 241, 0.4)',
  },
  {
    name: 'TUI & VSCode (Presentation)',
    components: ['Rendering', 'IPC Client', 'State Management'],
    color: 'rgba(168, 85, 247, 0.4)',
  },
  {
    name: 'Providers (External)',
    components: ['ChatGPT', 'Claude', 'Gemini'],
    color: 'rgba(34, 211, 238, 0.4)',
  },
];

export function CLIContainer() {
  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>CLI Backend Architecture</h3>
          <ArchitectureDiagram nodes={CLI_NODES} connections={CLI_CONNECTIONS} />
        </div>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Module Responsibilities</h3>
          <BoundaryDiagram
            layers={[
              {
                name: 'Core Modules',
                components: ['server.ts - IPC Server', 'agent/loop.ts - Agent Loop', 'browser/ - Playwright/CDP'],
                color: 'rgba(99, 102, 241, 0.4)',
              },
              {
                name: 'Supporting Modules',
                components: ['context/ - File tree', 'parser/ - Multi-strategy', 'tools/ - Tool execution', 'applier/ - Diff preview'],
                color: 'rgba(168, 85, 247, 0.4)',
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

const CLI_NODES = [
  { id: 'server', label: 'Server', sublabel: 'JSON-RPC' },
  { id: 'agent', label: 'Agent Loop', sublabel: 'Session Mgmt' },
  { id: 'browser', label: 'Browser', sublabel: 'Playwright/CDP' },
  { id: 'context', label: 'Context', sublabel: 'File Tree' },
  { id: 'parser', label: 'Parser', sublabel: 'Response' },
  { id: 'tools', label: 'Tools', sublabel: 'Execution' },
  { id: 'applier', label: 'Applier', sublabel: 'File Diff' },
];

const CLI_CONNECTIONS = [
  { from: 'server', to: 'agent', label: 'RPC' },
  { from: 'agent', to: 'browser', label: 'CDP' },
  { from: 'agent', to: 'context', label: 'query' },
  { from: 'agent', to: 'parser', label: 'parse' },
  { from: 'parser', to: 'tools', label: 'call' },
  { from: 'tools', to: 'applier', label: 'diff' },
];

export function IPCContainer() {
  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>IPC Protocol Methods</h3>
          <div className={styles.table}>
            <table className={styles.ipcTable}>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Params</th>
                  <th>Returns</th>
                </tr>
              </thead>
              <tbody>
                {IPC_METHODS.map((method) => (
                  <tr key={method.name}>
                    <td className={styles.methodName}>{method.name}</td>
                    <td className={styles.methodParams}>{method.params}</td>
                    <td className={styles.methodReturns}>{method.returns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Protocol Characteristics</h3>
          <BoundaryDiagram
            layers={[
              {
                name: 'Transport',
                components: ['stdin/stdout', 'JSON-RPC 2.0', 'Streaming'],
                color: 'rgba(99, 102, 241, 0.4)',
              },
              {
                name: 'Message Types',
                components: ['request', 'response', 'error', 'notification'],
                color: 'rgba(168, 85, 247, 0.4)',
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

const IPC_METHODS = [
  { name: 'tools.list', params: '—', returns: 'ToolListItem[]' },
  { name: 'tools.call', params: '{ name, args }', returns: 'ToolResult' },
  { name: 'session.start', params: '{ projectPath, provider? }', returns: '{ sessionId }' },
  { name: 'session.send', params: '{ sessionId, message }', returns: 'StreamResponse' },
  { name: 'session.stop', params: '{ sessionId }', returns: 'void' },
  { name: 'providers.list', params: '—', returns: 'ProviderInfo[]' },
];

const FLOW_STEPS = [
  {
    id: 'phase1',
    title: 'Phase 1: Context Collection',
    description: 'LLM determines which files are needed for the task',
    details: ['Send prompt + file tree to LLM', 'LLM returns list of needed files', 'CLI reads only those files'],
  },
  {
    id: 'phase2',
    title: 'Phase 2: Response Generation',
    description: 'LLM generates structured file changes with full context',
    details: ['Send files + prompt to LLM', 'LLM returns structured response', 'Parser extracts code changes'],
  },
  {
    id: 'phase3',
    title: 'Phase 3: Review & Apply',
    description: 'Changes are previewed for user approval before writing',
    details: ['Show diff to user', 'User approves or rejects', 'Applier writes changes to filesystem'],
  },
];

export function FlowContainer() {
  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Two-Phase Context Collection</h3>
          <BoundaryDiagram
            layers={[
              {
                name: 'Traditional Approach',
                components: ['Send entire codebase', 'High token cost', 'Slow response', 'Context overflow'],
                color: 'rgba(236, 72, 153, 0.4)',
              },
              {
                name: 'FreeCode Approach',
                components: ['Send file tree only', 'LLM requests specific files', 'Read only needed files', 'Full context with less tokens'],
                color: 'rgba(34, 211, 238, 0.4)',
              },
            ]}
          />
        </div>
        <div className={styles.section} style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.sectionTitle}>Data Flow Steps</h3>
          <div className={styles.flowContainer}>
            {FLOW_STEPS.map((step, i) => (
              <div key={step.id} className={styles.flowStep}>
                <div className={styles.flowNumber}>{i + 1}</div>
                <div className={styles.flowContent}>
                  <h4 className={styles.flowTitle}>{step.title}</h4>
                  <p className={styles.flowDescription}>{step.description}</p>
                  <ul className={styles.flowDetails}>
                    {step.details?.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const AGENT_LOOP_STEPS = [
  {
    id: 'input',
    title: '1. User Input',
    description: 'run() receives UserInput with prompt, sessionId, provider, projectPath',
    details: ['Session started with createInitialSessionState()', 'Status transitions: idle → starting → running'],
  },
  {
    id: 'context',
    title: '2. Collect Context',
    description: 'Gather project metadata and file tree',
    details: ['collectContext() reads project directory', 'Returns: { name, projectPath, tree }'],
  },
  {
    id: 'loop',
    title: '3. Continuous Loop',
    description: 'Cycle executes until goal is accomplished',
    details: ['evaluateLoopHealth() checks for stuck patterns', 'Checks: repeatedTools, stagnantTurns, oscillationScore, totalIterationLimit'],
  },
  {
    id: 'turn',
    title: '4. Execute Turn',
    description: 'One iteration: build prompt → send → normalize → parse → execute',
    details: ['sendToProvider() sends prompt to AI via BrowserController', 'normalizeResponse() transforms provider output to AssistantContent[]', 'parseResponse() extracts ToolCall[] from normalized content'],
  },
  {
    id: 'execute',
    title: '5. Execute Tools',
    description: 'Run each tool sequentially, collect results',
    details: ['executeTool() runs each ToolCall', 'buildContinuationPrompt() formats results for next iteration', 'Loop back to step 3 with updated prompt'],
  },
  {
    id: 'result',
    title: '6. Loop Result',
    description: 'Exit when no more tools or health threshold reached',
    details: ['fail() returns on error', 'complete() returns success with turnCount, iterationCount', 'Post-sampling hooks: auto-compact, memory extract'],
  },
]

export function AgentLoopContainer() {
  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Agent Orchestrator Loop</h3>
          <p className={styles.flowDescription}>
            The <strong>Agent Loop</strong> is a <strong>continuous cycle</strong> that queries the AI provider,
            executes tools, and loops until the goal is accomplished. The loop implements the following flow:
          </p>
          <div className={styles.flowContainer}>
            {AGENT_LOOP_STEPS.map((step, i) => (
              <div key={step.id} className={styles.flowStep}>
                <div className={styles.flowNumber}>{i + 1}</div>
                <div className={styles.flowContent}>
                  <h4 className={styles.flowTitle}>{step.title}</h4>
                  <p className={styles.flowDescription}>{step.description}</p>
                  <ul className={styles.flowDetails}>
                    {step.details?.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Loop Characteristics</h3>
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
    </div>
  );
}
