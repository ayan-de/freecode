'use client';

import React, { useState, useEffect, useRef } from 'react';
import styles from './ArchitectureExplorer.module.css';
import { type NodeType } from '../diagrams/FreeCodeInternalDiagram';

interface ArchitectureExplorerProps {
  selectedNode: NodeType | null;
  onClose?: () => void;
}

export function ArchitectureExplorer({ selectedNode, onClose }: ArchitectureExplorerProps) {
  const [activeHookSafety, setActiveHookSafety] = useState<'safe' | 'unsafe'>('safe');
  const [memoryCapacity, setMemoryCapacity] = useState(35);
  const [isCompacting, setIsCompacting] = useState(false);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [ipcStep, setIpcStep] = useState(0);
  const [subAgentState, setSubAgentState] = useState<'idle' | 'spawning' | 'running' | 'done'>('idle');

  // References for timeouts
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const clearAllTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // 1. Agent Loop Simulation
  useEffect(() => {
    if (selectedNode !== 'agent') {
      setAgentLogs([]);
      return;
    }
    clearAllTimers();

    const logs = [
      '🤖 Starting agent turn (Sequence #4)...',
      '🔍 Querying ContextEngine for updated file list...',
      '📡 Querying AI Provider (ChatGPT/Claude)...',
      '💭 AI Thinking: "We need to fix the typo in database client..."',
      '🛠️ AI Decided to call tool: grep_search({ query: "DB_CONNECTION_LIMIT" })',
      '⚡ Intercepting tool call with Pre-Execute Hooks...',
      '✅ Safety check passed. Executing grep_search...',
      '📤 Tool returned: "Found 1 match in src/db.ts:45"',
      '📡 Sending tool results back to AI Provider...',
      '💭 AI Thinking: "I will now edit line 45 using replace_file_content..."',
      '🛠️ AI Decided to call tool: replace_file_content(...)',
      '⚡ Intercepting tool call with Pre-Execute Hooks...',
      '✅ Safety check passed. Writing diff preview...',
      '📝 Applied code change successfully! User approved diff.',
      '🏁 Turn complete! Task fully accomplished.'
    ];

    setAgentLogs([logs[0] || '']);
    let currentIdx = 0;

    const streamLogs = () => {
      if (currentIdx >= logs.length - 1) {
        const resetTimer = setTimeout(() => {
          currentIdx = 0;
          setAgentLogs([logs[0] || '']);
          streamLogs();
        }, 4000);
        timersRef.current.push(resetTimer);
        return;
      }

      currentIdx++;
      const nextLog = logs[currentIdx];
      if (nextLog) {
        setAgentLogs(prev => [...prev, nextLog]);
      }
      const logTimer = setTimeout(streamLogs, 1500);
      timersRef.current.push(logTimer);
    };

    const initialTimer = setTimeout(streamLogs, 1500);
    timersRef.current.push(initialTimer);

    return () => clearAllTimers();
  }, [selectedNode]);

  // 2. Memory Compaction Simulation
  useEffect(() => {
    if (selectedNode !== 'memory') return;
    clearAllTimers();
    setIsCompacting(false);
    setMemoryCapacity(35);

    const runMemoryCycle = () => {
      let currentVal = 35;
      const interval = setInterval(() => {
        currentVal += 15;
        if (currentVal >= 95) {
          clearInterval(interval);
          setMemoryCapacity(98);
          setIsCompacting(true);

          // Compaction phase
          const compactTimer = setTimeout(() => {
            setIsCompacting(false);
            setMemoryCapacity(15);
            // Run again
            const loopAgainTimer = setTimeout(runMemoryCycle, 2000);
            timersRef.current.push(loopAgainTimer);
          }, 3000);
          timersRef.current.push(compactTimer);
        } else {
          setMemoryCapacity(currentVal);
        }
      }, 1000);

      // Track interval so we can clear it
      const pushInterval = {
        ref: interval,
        close: () => clearInterval(interval)
      };
      // We manually clear intervals using our ref
      timersRef.current.push(setTimeout(() => pushInterval.close(), 10000));
    };

    runMemoryCycle();

    return () => clearAllTimers();
  }, [selectedNode]);

  // 3. IPC Step simulation
  useEffect(() => {
    if (selectedNode !== 'clients') return;
    clearAllTimers();

    const cycleIpc = () => {
      setIpcStep(prev => (prev + 1) % 4);
      const timer = setTimeout(cycleIpc, 3000);
      timersRef.current.push(timer);
    };

    const timer = setTimeout(cycleIpc, 3000);
    timersRef.current.push(timer);

    return () => clearAllTimers();
  }, [selectedNode]);

  // 4. Sub-Agent Simulation
  useEffect(() => {
    if (selectedNode !== 'subagents') return;
    clearAllTimers();
    setSubAgentState('idle');

    const cycleSubAgents = () => {
      setSubAgentState('spawning');
      
      const t1 = setTimeout(() => {
        setSubAgentState('running');
      }, 2000);
      timersRef.current.push(t1);

      const t2 = setTimeout(() => {
        setSubAgentState('done');
      }, 6000);
      timersRef.current.push(t2);

      const t3 = setTimeout(() => {
        setSubAgentState('idle');
        const loopTimer = setTimeout(cycleSubAgents, 2000);
        timersRef.current.push(loopTimer);
      }, 9500);
      timersRef.current.push(t3);
    };

    const delayStart = setTimeout(cycleSubAgents, 1000);
    timersRef.current.push(delayStart);

    return () => clearAllTimers();
  }, [selectedNode]);

  const renderContent = () => {
    switch (selectedNode) {
      case 'clients':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>💻</span>
              <div>
                <h4 className={styles.title}>You / Clients Frontends</h4>
                <p className={styles.subtext}>Thin Client UI Presentation</p>
              </div>
            </div>

            <p className={styles.description}>
              FreeCode is designed with a **strict separation of concerns**. The TUI (Terminal User Interface) and VS Code extensions contain <strong>zero business logic</strong>. They do not handle browser automation, file reading/writing, or AI reasoning. They act purely as rendering engines and user interaction captures.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>TUI Shell</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/tui/src/index.ts" className={styles.fileLink}>apps/tui/src/index.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>VSCode Ext</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/vscode/src/extension.ts" className={styles.fileLink}>apps/vscode/src/extension.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>Types/IPC</span>
                  <a href="file:///home/ayan-de/Projects/freecode/packages/shared/src/ipc/protocol.ts" className={styles.fileLink}>packages/shared/src/ipc/protocol.ts</a>
                </li>
              </ul>
            </div>

            <div className={styles.simContainer}>
              <div className={styles.simHeader}>
                <span>JSON-RPC Live Communication Stream</span>
                <span className={styles.greenPulse}></span>
              </div>
              <div className={styles.simConsole}>
                {ipcStep === 0 && (
                  <pre className={styles.jsonCode}>
{`// 1. Client connects and starts a new project session
--> WRITE stdin (Request):
{
  "jsonrpc": "2.0",
  "id": 101,
  "method": "session.start",
  "params": {
    "projectPath": "/home/user/my-app",
    "provider": "chatgpt"
  }
}`}
                  </pre>
                )}
                {ipcStep === 1 && (
                  <pre className={styles.jsonCode}>
{`<-- READ stdout (Response):
{
  "jsonrpc": "2.0",
  "id": 101,
  "result": {
    "sessionId": "sess_8f3d12c6"
  }
}`}
                  </pre>
                )}
                {ipcStep === 2 && (
                  <pre className={styles.jsonCode}>
{`// 2. User sends prompt to the Agent
--> WRITE stdin (Request):
{
  "jsonrpc": "2.0",
  "id": 102,
  "method": "session.send",
  "params": {
    "sessionId": "sess_8f3d12c6",
    "message": "Fix database connection limits in db.ts"
  }
}`}
                  </pre>
                )}
                {ipcStep === 3 && (
                  <pre className={styles.jsonCode}>
{`<-- READ stdout (Streaming MessagePart):
{
  "jsonrpc": "2.0",
  "id": 102,
  "result": {
    "type": "text",
    "content": "Searching for database connection files..."
  }
}`}
                  </pre>
                )}
              </div>
            </div>
          </>
        );

      case 'agent':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>⚙️</span>
              <div>
                <h4 className={styles.title}>Agent Orchestrator Loop</h4>
                <p className={styles.subtext}>Stateful Turning Loop</p>
              </div>
            </div>

            <p className={styles.description}>
              The <strong>Agent Loop</strong> is the intelligence core. It operates in cyclic turns: instead of a single completion request, it repeatedly queries the AI provider, evaluates what tool to run next, invokes the tools safely, appends results to session history, and loops again until the goal is fully accomplished.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>Loop Engine</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/agent/loop.ts" className={styles.fileLink}>apps/cli/src/agent/loop.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>Session Store</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/agent/session.ts" className={styles.fileLink}>apps/cli/src/agent/session.ts</a>
                </li>
              </ul>
            </div>

            <div className={styles.simContainer}>
              <div className={styles.simHeader}>
                <span>Live Orchestrator Trace logs</span>
                <span className={styles.orangePulse}></span>
              </div>
              <div className={styles.simTerminal} ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
                {agentLogs.map((log, idx) => (
                  <div key={idx} className={styles.terminalLine}>
                    <span className={styles.promptArrow}>&gt;</span> {log}
                  </div>
                ))}
              </div>
            </div>
          </>
        );

      case 'subagents':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>🤖</span>
              <div>
                <h4 className={styles.title}>Parallel Sub-Agents</h4>
                <p className={styles.subtext}>Distributed AI Workforces</p>
              </div>
            </div>

            <p className={styles.description}>
              For large or complex tasks, the main agent orchestrator can delegate discrete tasks to <strong>Sub-Agents</strong>. Each sub-agent runs in its own isolated browser context, executing specialized tasks concurrently (like generating tests or scanning for security) and aggregates the code changes back to the main thread.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>Sub-Agent Spawner</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/tools/index.ts" className={styles.fileLink}>apps/cli/src/tools/index.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>Agent Router</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/agent/loop.ts" className={styles.fileLink}>apps/cli/src/agent/loop.ts</a>
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
                  {subAgentState === 'idle' && <span className={`${styles.statusLabel} ${styles.statusIdle}`}>IDLE</span>}
                  {subAgentState === 'spawning' && <span className={`${styles.statusLabel} ${styles.statusWorking}`}>DIVIDING TASK...</span>}
                  {subAgentState === 'running' && <span className={`${styles.statusLabel} ${styles.statusWorking}`}>MONITORING THREADS...</span>}
                  {subAgentState === 'done' && <span className={`${styles.statusLabel} ${styles.statusSuccess}`}>AGGRAGATING CHANGELIST</span>}
                </div>

                <div className={`${styles.threadRow} ${subAgentState === 'running' ? styles.threadRunning : ''}`}>
                  <span className={styles.threadName}>🧵 Thread #1 (Code Reviewer)</span>
                  {subAgentState === 'idle' && <span className={`${styles.statusLabel} ${styles.statusIdle}`}>OFFLINE</span>}
                  {subAgentState === 'spawning' && <span className={`${styles.statusLabel} ${styles.statusSpawning}`}>SPAWNING BROWSER...</span>}
                  {subAgentState === 'running' && <span className={`${styles.statusLabel} ${styles.statusActive}`}>RUNNING STATIC ANALYSIS</span>}
                  {subAgentState === 'done' && <span className={`${styles.statusLabel} ${styles.statusSuccess}`}>COMPLETED (3 findings)</span>}
                </div>

                <div className={`${styles.threadRow} ${subAgentState === 'running' ? styles.threadRunning : ''}`}>
                  <span className={styles.threadName}>🧵 Thread #2 (Unit Tester)</span>
                  {subAgentState === 'idle' && <span className={`${styles.statusLabel} ${styles.statusIdle}`}>OFFLINE</span>}
                  {subAgentState === 'spawning' && <span className={`${styles.statusLabel} ${styles.statusSpawning}`}>SPAWNING BROWSER...</span>}
                  {subAgentState === 'running' && <span className={`${styles.statusLabel} ${styles.statusActive}`}>WRITING db.test.ts</span>}
                  {subAgentState === 'done' && <span className={`${styles.statusLabel} ${styles.statusSuccess}`}>COMPLETED (4 tests written)</span>}
                </div>
              </div>
            </div>
          </>
        );

      case 'context':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>📄</span>
              <div>
                <h4 className={styles.title}>Context Engine</h4>
                <p className={styles.subtext}>Convention Rules & Custom Skills</p>
              </div>
            </div>

            <p className={styles.description}>
              FreeCode is project-aware! On session startup, the Context Engine loads <strong>AGENTS.md</strong> (prioritized) or falls back to <strong>CLAUDE.md</strong>. These files contain rules (file directories, styles, testing frameworks). It also loads reusable files called **Skills** from `.claude/skills/`.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>Context Collector</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/context/collector.ts" className={styles.fileLink}>apps/cli/src/context/collector.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>File Tree generator</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/context/file-tree.ts" className={styles.fileLink}>apps/cli/src/context/file-tree.ts</a>
                </li>
              </ul>
            </div>

            <div className={styles.simContainer}>
              <div className={styles.simHeader}>
                <span>Startup Context Compilation Simulation</span>
                <span className={styles.emeraldPulse}></span>
              </div>
              <div className={styles.contextCompiler}>
                <div className={styles.compilerStep}>
                  <span className={styles.stepIndicator}>PASS 1</span>
                  <span>Scanning Workspace root for <strong>AGENTS.md</strong>... <span className={styles.greenText}>FOUND (Priority)</span></span>
                </div>
                <div className={styles.compilerStep}>
                  <span className={styles.stepIndicator}>PASS 2</span>
                  <span>Scanning <strong>.claude/skills/</strong> for custom behaviors... <span className={styles.greenText}>LOADED (2 skills)</span></span>
                </div>
                <div className={styles.compilerStep}>
                  <span className={styles.stepIndicator}>PASS 3</span>
                  <span>Constructing <strong>File Tree Map</strong> (excluding node_modules)... <span className={styles.greenText}>OK (18 nodes mapped)</span></span>
                </div>
                <div className={styles.compilerSystemPrompt}>
                  <div className={styles.promptHeader}>COMPRESSED SYSTEM PROMPT:</div>
                  <pre className={styles.promptCode}>
{`You are FreeCode, an AI coding assistant.
[CONVENTIONS LOADED FROM AGENTS.md]:
- Use React 19 and Next.js App Router for apps/web.
- Always write Vanilla CSS modules; avoid Tailwind.
- Verify changes using "npm run build" before turn complete.

[ACTIVE SKILLS IMPLEMENTED]:
- CodeReviewer (v1.2) - static scan guidelines.
- TestGenerator (v2.0) - mock db rules.`}
                  </pre>
                </div>
              </div>
            </div>
          </>
        );

      case 'memory':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>💾</span>
              <div>
                <h4 className={styles.title}>Memory & Log Compaction</h4>
                <p className={styles.subtext}>Handling Long-Running Sessions</p>
              </div>
            </div>

            <p className={styles.description}>
              When agent cycles run for dozens of turns, LLM context windows overflow. To prevent crashes, FreeCode accumulates session logs, and dynamically runs **Memory Compaction**. It condenses conversations into a compressed historical synopsis while maintaining working memory of the goals.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>Session History</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/agent/session.ts" className={styles.fileLink}>apps/cli/src/agent/session.ts</a>
                </li>
              </ul>
            </div>

            <div className={styles.simContainer}>
              <div className={styles.simHeader}>
                <span>History Buffer Status</span>
                <span className={isCompacting ? styles.yellowPulse : styles.amberPulse}></span>
              </div>
              <div className={styles.memoryBarContainer}>
                <div className={styles.memoryBarLabel}>
                  <span>Context window capacity:</span>
                  <span><strong>{memoryCapacity}%</strong> ({memoryCapacity * 100} / 10000 tokens)</span>
                </div>
                <div className={styles.memoryProgressBar}>
                  <div 
                    className={`${styles.memoryFill} ${isCompacting ? styles.memoryFillCompacting : ''} ${memoryCapacity > 80 ? styles.memoryHigh : ''}`}
                    style={{ width: `${memoryCapacity}%` }}
                  />
                </div>
                {isCompacting && (
                  <div className={styles.compactAlert}>
                    ⚠️ BUFFER FULL! RUNNING BACKGROUND SUMMARIZATION DEAMON...
                  </div>
                )}
                {!isCompacting && memoryCapacity > 80 && (
                  <div className={styles.warningAlert}>
                    🚨 CRITICAL LIMIT NEARING! PREPARING FOR COMPACTION CYCLE...
                  </div>
                )}
                {!isCompacting && memoryCapacity <= 35 && (
                  <div className={styles.successAlert}>
                    ✅ HISTORY COMPRESSED! Synced context window cleared.
                  </div>
                )}
              </div>
            </div>
          </>
        );

      case 'hooks':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>⚡</span>
              <div>
                <h4 className={styles.title}>Hooks Safety Middleware</h4>
                <p className={styles.subtext}>Pre & Post Execution Interceptors</p>
              </div>
            </div>

            <p className={styles.description}>
              To protect the user&apos;s computer, FreeCode pipes every tool call through a strict **Hooks Middleware Pipeline**. Pre-hooks inspect the command and can completely block malicious queries (like destructive bash scripts). Post-hooks capture results for real-time observability logs.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>Middleware Loop</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/agent/loop.ts" className={styles.fileLink}>apps/cli/src/agent/loop.ts</a>
                </li>
              </ul>
            </div>

            <div className={styles.simContainer}>
              <div className={styles.simHeader}>
                <span>Safety Middleware Simulator Playground</span>
                <span className={styles.emeraldPulse}></span>
              </div>
              <div className={styles.hooksSandbox}>
                <div className={styles.hooksToggle}>
                  <button 
                    className={`${styles.toggleBtn} ${activeHookSafety === 'safe' ? styles.toggleActiveSafe : ''}`}
                    onClick={() => setActiveHookSafety('safe')}
                  >
                    Test Safe Command
                  </button>
                  <button 
                    className={`${styles.toggleBtn} ${activeHookSafety === 'unsafe' ? styles.toggleActiveUnsafe : ''}`}
                    onClick={() => setActiveHookSafety('unsafe')}
                  >
                    Test Dangerous Command
                  </button>
                </div>

                <div className={styles.sandboxOutput}>
                  {activeHookSafety === 'safe' ? (
                    <div className={styles.hookConsoleLog}>
                      <div className={styles.hookLogLine}><span className={styles.hookInfo}>[INFO]</span> Intercepting tool request: <code>read_file(&quot;src/db.ts&quot;)</code></div>
                      <div className={styles.hookLogLine}><span className={styles.hookPre}>[PRE-EXEC]</span> Scanning parameters... Safe action verified.</div>
                      <div className={styles.hookLogLine}><span className={styles.hookSuccess}>[STATUS]</span> Executing tool read_file...</div>
                      <div className={styles.hookLogLine}><span className={styles.hookPost}>[POST-EXEC]</span> Action logged. Returning output chunk (142 bytes) to AI loop.</div>
                    </div>
                  ) : (
                    <div className={styles.hookConsoleLog}>
                      <div className={styles.hookLogLine}><span className={styles.hookInfo}>[INFO]</span> Intercepting tool request: <code>run_bash(&quot;rm -rf /&quot;)</code></div>
                      <div className={styles.hookLogLine}><span className={styles.hookPre}>[PRE-EXEC]</span> Scanning parameters... <span className={styles.errorText}>DANGEROUS PATTERN MATCHED!</span></div>
                      <div className={styles.hookLogBlockAlert}>
                        🛑 ERROR: COMMAND BLOCKED!
                        <div style={{ fontSize: '11px', marginTop: '4px', fontWeight: 'normal', color: 'rgba(255, 255, 255, 0.7)' }}>
                          The PreExecute Hooks daemon has terminated the execution. Reason: Command contains prohibited system alterations.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        );

      case 'tools':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>🛠️</span>
              <div>
                <h4 className={styles.title}>The Tools Execution Suite</h4>
                <p className={styles.subtext}>CLI Capabilities Catalog</p>
              </div>
            </div>

            <p className={styles.description}>
              The AI provider cannot interact with the operating system itself. It must select and invoke specialized **Tools** exposed by the CLI backend. These modules implement strict validation schemas so the AI knows exactly what properties are required.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>Tools Registry</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/tools/index.ts" className={styles.fileLink}>apps/cli/src/tools/index.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>Bash Executor</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/tools/bash.ts" className={styles.fileLink}>apps/cli/src/tools/bash.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>File Editor</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/tools/edit.ts" className={styles.fileLink}>apps/cli/src/tools/edit.ts</a>
                </li>
              </ul>
            </div>

            <div className={styles.simContainer}>
              <div className={styles.simHeader}>
                <span>Standard Tool JSON-Schema Contract</span>
                <span className={styles.purplePulse}></span>
              </div>
              <div className={styles.simConsole}>
                <pre className={styles.jsonCode}>
{`// apps/cli/src/tools/write.ts - Tool schema exposed to AI
{
  "id": "write_file",
  "description": "Create a new file or overwrite an existing file",
  "parameters": {
    "type": "object",
    "properties": {
      "filePath": {
        "type": "string",
        "description": "Absolute destination filepath inside workspace"
      },
      "content": {
        "type": "string",
        "description": "Raw file code content payload"
      }
    },
    "required": ["filePath", "content"]
  }
}`}
                </pre>
              </div>
            </div>
          </>
        );

      case 'provider':
        return (
          <>
            <div className={styles.header}>
              <span className={styles.icon}>🌐</span>
              <div>
                <h4 className={styles.title}>LLM / Browser Call Boundary</h4>
                <p className={styles.subtext}>External Provider Automation</p>
              </div>
            </div>

            <p className={styles.description}>
              The CLI owns the browser automation path. The agent loop builds the task prompt, the browser controller fills the provider UI, and provider adapters isolate DOM selectors for ChatGPT, Claude, or future browser-backed LLMs.
            </p>

            <div className={styles.filesBox}>
              <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
              <ul className={styles.filesList}>
                <li>
                  <span className={styles.fileBadge}>Prompt Cycle</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/agent/loop.ts" className={styles.fileLink}>apps/cli/src/agent/loop.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>Browser Driver</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/browser/controller.ts" className={styles.fileLink}>apps/cli/src/browser/controller.ts</a>
                </li>
                <li>
                  <span className={styles.fileBadge}>Provider Adapter</span>
                  <a href="file:///home/ayan-de/Projects/freecode/apps/cli/src/browser/providers/chatgpt.ts" className={styles.fileLink}>apps/cli/src/browser/providers/chatgpt.ts</a>
                </li>
              </ul>
            </div>

            <div className={styles.simContainer}>
              <div className={styles.simHeader}>
                <span>Current Browser Call Sequence</span>
                <span className={styles.bluePulse}></span>
              </div>
              <div className={styles.simConsole}>
                <pre className={styles.jsonCode}>
{`agent/loop.ts
  -> controller.connect()
  -> controller.navigate(provider)
  -> controller.sendPrompt(fullPrompt)
  -> controller.waitForResponse()
  -> parser extracts file changes`}
                </pre>
              </div>
            </div>
          </>
        );

      default:
        return (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🔍</span>
            <h4>Interactive Blueprints Explorer</h4>
            <p>Click on any component card inside the system architecture diagram to explore details, hyperlinks to key source files, and live execution simulations.</p>
          </div>
        );
    }
  };

  return (
    <div className={styles.container}>
      {selectedNode && onClose && (
        <button
          onClick={onClose}
          className={styles.closeButton}
          aria-label="Close details"
          title="Close details"
        >
          ✕
        </button>
      )}
      {renderContent()}
    </div>
  );
}
