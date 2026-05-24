'use client';

import React from 'react';
import styles from './FreeCodeInternalDiagram.module.css';

export type NodeType =
  | 'clients'
  | 'agent'
  | 'subagents'
  | 'context'
  | 'memory'
  | 'hooks'
  | 'tools';

interface FreeCodeInternalDiagramProps {
  selectedNode: NodeType | null;
  onSelectNode: (node: NodeType) => void;
}

export function FreeCodeInternalDiagram({
  selectedNode,
  onSelectNode,
}: FreeCodeInternalDiagramProps) {
  return (
    <div className={styles.container}>
      <div className={styles.diagramHeader}>
        <span className={styles.pulseDot}></span>
        <span className={styles.diagramLabel}>INTERACTIVE SYSTEM BLUEPRINT</span>
      </div>

      <div className={styles.diagramWrapper}>
        <svg
          className={styles.svg}
          viewBox="0 0 1000 650"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* DEFINITIONS FOR GRADIENTS AND GLOWS */}
          <defs>
            {/* Core glows */}
            <filter id="glow-orange" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-purple" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-amber" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Line Gradients */}
            <linearGradient id="grad-task" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
            <linearGradient id="grad-call" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="50%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
            <linearGradient id="grad-result" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
            <linearGradient id="grad-subagent" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
            <linearGradient id="grad-context" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
            <linearGradient id="grad-memory" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
          </defs>

          {/* BACKGROUND GRID PATTERN (Subtle Tech Look) */}
          <g opacity="0.05">
            <path d="M 0,50 L 1000,50 M 0,100 L 1000,100 M 0,150 L 1000,150 M 0,200 L 1000,200 M 0,250 L 1000,250 M 0,300 L 1000,300 M 0,350 L 1000,350 M 0,400 L 1000,400 M 0,450 L 1000,450 M 0,500 L 1000,500 M 0,550 L 1000,550 M 0,600 L 1000,600" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
            <path d="M 100,0 L 100,650 M 200,0 L 200,650 M 300,0 L 300,650 M 400,0 L 400,650 M 500,0 L 500,650 M 600,0 L 600,650 M 700,0 L 700,650 M 800,0 L 800,650 M 900,0 L 900,650" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
          </g>

          {/* ==================== CONNECTIONS / FLOWS ==================== */}

          {/* 1. You/Clients -> Agent (Task) */}
          <g className={styles.flowLineGroup}>
            <path
              id="flow-task"
              d="M 150 300 H 400"
              stroke="url(#grad-task)"
              strokeWidth="2.5"
              className={styles.flowLine}
            />
            <polygon points="400,300 390,295 390,305" fill="#f97316" />
            <rect x="235" y="278" width="80" height="18" rx="4" fill="#0b0b14" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
            <text x="275" y="291" className={styles.connectionLabel} fill="rgba(255,255,255,0.7)">JSON-RPC Task</text>
          </g>

          {/* 2. Agent -> Sub-agents (Delegate / Bidirectional) */}
          <g className={styles.flowLineGroup}>
            <path
              id="flow-subagent-out"
              d="M 440 220 Q 380 180 370 150"
              stroke="url(#grad-subagent)"
              strokeWidth="2"
              strokeDasharray="6 4"
              className={styles.flowLineSlow}
            />
            <polygon points="370,150 378,155 370,161" fill="#ec4899" />
            <text x="345" y="210" className={styles.connectionLabel} fill="#ec4899" textAnchor="end">delegate subtasks</text>

            <path
              id="flow-subagent-in"
              d="M 370 120 Q 400 120 440 240"
              stroke="url(#grad-subagent)"
              strokeWidth="2"
              strokeDasharray="6 4"
              className={styles.flowLineSlow}
            />
            <polygon points="440,240 435,231 443,233" fill="#f97316" />
            <text x="430" y="115" className={styles.connectionLabel} fill="#f97316" textAnchor="start">results</text>
          </g>

          {/* 3. Context -> Agent (Pre-loaded on startup) */}
          <g className={styles.flowLineGroup}>
            <path
              id="flow-context"
              d="M 370 500 Q 420 500 450 380"
              stroke="url(#grad-context)"
              strokeWidth="2"
              className={styles.flowLine}
            />
            <polygon points="450,380 443,388 451,388" fill="#f97316" />
            <text x="445" y="475" className={styles.connectionLabel} fill="#10b981" textAnchor="end">on startup</text>
          </g>

          {/* 4. Agent <-> Memory (Read/Write session state) */}
          <g className={styles.flowLineGroup}>
            <path
              id="flow-memory-out"
              d="M 540 380 Q 640 450 710 470"
              stroke="url(#grad-memory)"
              strokeWidth="2"
              strokeDasharray="6 4"
              className={styles.flowLineSlow}
            />
            <polygon points="710,470 701,466 705,474" fill="#f59e0b" />

            <path
              id="flow-memory-in"
              d="M 710 490 Q 610 470 520 380"
              stroke="url(#grad-memory)"
              strokeWidth="2"
              strokeDasharray="6 4"
              className={styles.flowLineSlow}
            />
            <polygon points="520,380 528,386 521,389" fill="#f97316" />
            <text x="640" y="420" className={styles.connectionLabel} fill="#f59e0b" textAnchor="middle">read / write context</text>
          </g>

          {/* 5. Agent -> Hooks -> Tools (Execution pipeline) */}
          <g className={styles.flowLineGroup}>
            {/* Agent -> Hooks */}
            <path
              id="flow-to-hooks"
              d="M 560 280 Q 600 240 625 210"
              stroke="url(#grad-call)"
              strokeWidth="2"
              className={styles.flowLine}
            />
            <text x="590" y="240" className={styles.connectionLabel} fill="#f97316" textAnchor="end">call</text>

            {/* Hooks -> Tools */}
            <path
              id="flow-hooks-to-tools"
              d="M 645 190 Q 660 170 690 160"
              stroke="#10b981"
              strokeWidth="2"
              className={styles.flowLine}
            />
            <polygon points="690,160 681,158 684,166" fill="#10b981" />
          </g>

          {/* 6. Tools -> Agent (Result callback) */}
          <g className={styles.flowLineGroup}>
            <path
              id="flow-result"
              d="M 690 320 H 560"
              stroke="url(#grad-result)"
              strokeWidth="2"
              className={styles.flowLine}
            />
            <polygon points="560,320 570,315 570,325" fill="#f97316" />
            <text x="625" y="340" className={styles.connectionLabel} fill="#a855f7" textAnchor="middle">result</text>
          </g>


          {/* ==================== SANDBOX / SYSTEM CONTAINER ==================== */}
          <g className={styles.sandboxContainer}>
            <rect
              x="180"
              y="20"
              width="800"
              height="605"
              rx="16"
              className={styles.outerSandbox}
            />
            <rect x="200" y="35" width="220" height="24" rx="6" fill="#121225" />
            <text x="215" y="52" className={styles.outerSandboxTitle}>
              &gt;_ FREECODE CLI BACKEND (DAEMON)
            </text>
          </g>


          {/* ==================== NODES / INTERACTIVE CARDS ==================== */}

          {/* 1. YOU / CLIENTS FRONTEND */}
          <g
            className={`${styles.nodeGroup} ${
              selectedNode === 'clients' ? styles.activeNode : ''
            }`}
            onClick={() => onSelectNode('clients')}
          >
            <rect
              x="10"
              y="200"
              width="140"
              height="200"
              rx="12"
              className={styles.nodeBoxClients}
            />
            {/* Header / Title */}
            <text x="80" y="235" className={styles.nodeHeader} textAnchor="middle">
              YOU / CLIENTS
            </text>
            <line x1="25" y1="245" x2="135" y2="245" stroke="rgba(255,255,255,0.1)" />

            {/* Sub-cards */}
            {/* TUI */}
            <rect x="25" y="260" width="110" height="45" rx="6" fill="rgba(129, 140, 248, 0.15)" stroke="rgba(129, 140, 248, 0.4)" />
            <text x="80" y="280" className={styles.subCardText} textAnchor="middle">Terminal TUI</text>
            <text x="80" y="293" className={styles.subCardDesc} textAnchor="middle">pi-tui rendering</text>

            {/* VS Code Extension */}
            <rect x="25" y="315" width="110" height="45" rx="6" fill="rgba(129, 140, 248, 0.15)" stroke="rgba(129, 140, 248, 0.4)" />
            <text x="80" y="335" className={styles.subCardText} textAnchor="middle">VSCode Ext</text>
            <text x="80" y="348" className={styles.subCardDesc} textAnchor="middle">React webview</text>

            <text x="80" y="382" className={styles.nodeInfoLabel} textAnchor="middle">
              Thin clients
            </text>
          </g>


          {/* 2. AGENT reasoning loop (Center) */}
          <g
            className={`${styles.nodeGroup} ${
              selectedNode === 'agent' ? styles.activeNode : ''
            }`}
            onClick={() => onSelectNode('agent')}
          >
            <rect
              x="400"
              y="220"
              width="160"
              height="160"
              rx="14"
              className={styles.nodeBoxAgent}
              filter="url(#glow-orange)"
            />

            {/* Orange spinner in background */}
            <g transform="translate(480, 290)" className={styles.gearGroup}>
              <circle r="30" stroke="#f97316" strokeWidth="2.5" strokeDasharray="10 5" fill="none" />
              <path d="M 0,-30 L 0,-25 M 0,30 L 0,25 M -30,0 L -25,0 M 30,0 L 25,0 M -21,-21 L -17,-17 M 21,21 L 17,17 M -21,21 L -17,17 M 21,-21 L 17,-17" stroke="#f97316" strokeWidth="3" />
              {/* Internal pulsing starburst */}
              <circle r="15" fill="#f97316" className={styles.pulsingCore} />
            </g>

            <rect x="445" y="335" width="70" height="16" rx="4" fill="#0b0b14" stroke="rgba(249,115,22,0.5)" />
            <text x="480" y="347" className={styles.agentTag} textAnchor="middle">⚙️ AGENT</text>
            <text x="480" y="367" className={styles.agentLoopLabel} textAnchor="middle">Reasoning Loop</text>
          </g>


          {/* 3. SUB-AGENTS box (Top Left) */}
          <g
            className={`${styles.nodeGroup} ${
              selectedNode === 'subagents' ? styles.activeNode : ''
            }`}
            onClick={() => onSelectNode('subagents')}
          >
            <rect
              x="210"
              y="60"
              width="160"
              height="140"
              rx="12"
              className={styles.nodeBoxSubagents}
            />
            <text x="290" y="85" className={styles.nodeHeader} textAnchor="middle">
              💾 SUB-AGENTS
            </text>
            <line x1="225" y1="95" x2="355" y2="95" stroke="rgba(255,255,255,0.1)" />

            {/* Mini chip sub-agent cards */}
            <g transform="translate(225, 108)">
              <rect width="60" height="42" rx="4" fill="rgba(236,72,153,0.1)" stroke="rgba(236,72,153,0.3)" />
              <rect x="5" y="5" width="10" height="10" rx="2" fill="#ec4899" />
              <text x="8" y="27" className={styles.miniCardTitle}>Sub-Agent</text>
              <text x="8" y="36" className={styles.miniCardSub}>Tasker</text>
            </g>

            <g transform="translate(295, 108)">
              <rect width="60" height="42" rx="4" fill="rgba(236,72,153,0.1)" stroke="rgba(236,72,153,0.3)" />
              <rect x="5" y="5" width="10" height="10" rx="2" fill="#ec4899" />
              <text x="8" y="27" className={styles.miniCardTitle}>Sub-Agent</text>
              <text x="8" y="36" className={styles.miniCardSub}>Tester</text>
            </g>

            <text x="290" y="185" className={styles.nodeInfoLabel} textAnchor="middle">
              Parallel execution
            </text>
          </g>


          {/* 4. CONTEXT Engine (Bottom Left) */}
          <g
            className={`${styles.nodeGroup} ${
              selectedNode === 'context' ? styles.activeNode : ''
            }`}
            onClick={() => onSelectNode('context')}
          >
            <rect
              x="210"
              y="420"
              width="160"
              height="160"
              rx="12"
              className={styles.nodeBoxContext}
            />
            <text x="290" y="445" className={styles.nodeHeader} textAnchor="middle">
              📄 CONTEXT
            </text>
            <line x1="225" y1="455" x2="355" y2="455" stroke="rgba(255,255,255,0.1)" />

            {/* AGENTS.md document icon */}
            <g transform="translate(230, 468)">
              <rect width="55" height="60" rx="5" fill="#111827" stroke="rgba(16,185,129,0.4)" />
              <path d="M 12 15 H 43 M 12 25 H 43 M 12 35 H 30 M 12 45 H 25" stroke="rgba(16,185,129,0.5)" strokeWidth="2.5" />
              <text x="27.5" y="52" className={styles.docLabel} textAnchor="middle">AGENTS.md</text>
            </g>

            {/* Skills lightning icon */}
            <g transform="translate(300, 468)">
              <rect width="55" height="60" rx="5" fill="#111827" stroke="rgba(16,185,129,0.4)" />
              <path d="M 28 8 L 18 32 L 28 32 L 24 52 L 40 24 L 28 24 Z" fill="#10b981" />
              <text x="27.5" y="52" className={styles.docLabel} textAnchor="middle">Skills</text>
            </g>

            <text x="290" y="565" className={styles.nodeInfoLabel} textAnchor="middle">
              Project conventions
            </text>
          </g>


          {/* 5. MEMORY Cylinder (Bottom Right) */}
          <g
            className={`${styles.nodeGroup} ${
              selectedNode === 'memory' ? styles.activeNode : ''
            }`}
            onClick={() => onSelectNode('memory')}
          >
            {/* Database cylinders */}
            <g transform="translate(710, 440)">
              <rect x="0" y="0" width="100" height="130" rx="8" fill="rgba(11, 11, 20, 0.7)" stroke="rgba(245,158,11,0.2)" />
              
              <ellipse cx="50" cy="25" rx="35" ry="12" fill="rgba(245,158,11,0.2)" stroke="#f59e0b" strokeWidth="2" filter="url(#glow-amber)" />
              
              <path d="M 15 25 V 60 A 35 12 0 0 0 85 60 V 25" fill="none" stroke="#f59e0b" strokeWidth="2" />
              <ellipse cx="50" cy="60" rx="35" ry="12" fill="rgba(245,158,11,0.1)" stroke="#f59e0b" strokeWidth="1.5" />
              
              <path d="M 15 60 V 95 A 35 12 0 0 0 85 95 V 60" fill="none" stroke="#f59e0b" strokeWidth="2" />
              <ellipse cx="50" cy="95" rx="35" ry="12" fill="rgba(245,158,11,0.1)" stroke="#f59e0b" strokeWidth="1.5" />

              <text x="50" y="120" className={styles.dbLabel} textAnchor="middle">Memory</text>
            </g>

            {/* Compaction arrows */}
            <g transform="translate(825, 475)">
              <circle r="22" fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.3)" strokeWidth="1" strokeDasharray="3 3" />
              {/* compacting arrows */}
              <path d="M -10,-10 L 0,-3 L 10,-10 M -10,10 L 0,3 L 10,10 M -12,0 H 12" stroke="#f59e0b" strokeWidth="2" fill="none" />
              <text x="0" y="-28" className={styles.dbCompactLabel} textAnchor="middle">auto-compacts</text>
              <text x="0" y="34" className={styles.dbCompactLabel} textAnchor="middle">when full</text>
            </g>
          </g>


          {/* 6. HOOKS Lightning Middleware */}
          <g
            className={`${styles.nodeGroup} ${
              selectedNode === 'hooks' ? styles.activeNode : ''
            }`}
            onClick={() => onSelectNode('hooks')}
          >
            <circle
              cx="635"
              cy="200"
              r="26"
              className={styles.hooksCircle}
              filter="url(#glow-green)"
            />
            {/* Green glowing lightning bolt */}
            <path
              d="M 638 184 L 626 202 H 635 L 632 216 L 644 198 H 635 Z"
              fill="#10b981"
              className={styles.hooksLightning}
            />
            <text x="635" y="165" className={styles.hooksLabel} textAnchor="middle">
              Hooks
            </text>
            <text x="635" y="240" className={styles.hooksSublabel} textAnchor="middle">
              (Safety Middleware)
            </text>
          </g>


          {/* 7. TOOLS Box (Right/Top Right) */}
          <g
            className={`${styles.nodeGroup} ${
              selectedNode === 'tools' ? styles.activeNode : ''
            }`}
            onClick={() => onSelectNode('tools')}
          >
            <rect
              x="690"
              y="60"
              width="250"
              height="320"
              rx="16"
              className={styles.nodeBoxTools}
              filter="url(#glow-purple)"
            />
            <text x="815" y="90" className={styles.nodeHeaderTools} textAnchor="middle">
              🛠️ TOOLS
            </text>
            <line x1="710" y1="102" x2="920" y2="102" stroke="rgba(168,85,247,0.3)" />

            {/* Interactive inner tool grids */}
            {/* Tool 1: FileRead / Write */}
            <g transform="translate(715, 115)">
              <rect width="95" height="85" rx="8" fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.3)" />
              <path d="M 47.5,20 V 45 M 35,32 H 60 M 32,58 H 63" stroke="#a855f7" strokeWidth="2.5" fill="none" />
              <text x="47.5" y="70" className={styles.toolGridLabel} textAnchor="middle">File Read/Write</text>
              <text x="47.5" y="79" className={styles.toolGridDesc} textAnchor="middle">read.ts, write.ts</text>
            </g>

            {/* Tool 2: Bash Executor */}
            <g transform="translate(830, 115)">
              <rect width="95" height="85" rx="8" fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.3)" />
              <rect x="25" y="22" width="45" height="30" rx="4" fill="#0b0b14" stroke="rgba(168,85,247,0.4)" />
              <text x="47.5" y="42" className={styles.terminalIconPrompt} textAnchor="middle">&gt;_</text>
              <text x="47.5" y="70" className={styles.toolGridLabel} textAnchor="middle">Bash Shell</text>
              <text x="47.5" y="79" className={styles.toolGridDesc} textAnchor="middle">bash.ts</text>
            </g>

            {/* Tool 3: Web Search */}
            <g transform="translate(715, 215)">
              <rect width="95" height="85" rx="8" fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.3)" />
              <circle cx="47.5" cy="35" r="14" fill="none" stroke="#a855f7" strokeWidth="2.5" />
              <line x1="56" y1="44" x2="68" y2="56" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" />
              <text x="47.5" y="70" className={styles.toolGridLabel} textAnchor="middle">Grep Search</text>
              <text x="47.5" y="79" className={styles.toolGridDesc} textAnchor="middle">grep.ts, find.ts</text>
            </g>

            {/* Tool 4: Glob Match */}
            <g transform="translate(830, 215)">
              <rect width="95" height="85" rx="8" fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.3)" />
              <path d="M 47.5,20 L 47.5,50 M 32.5,35 H 62.5 M 37,24.5 L 58,45.5 M 37,45.5 L 58,24.5" stroke="#a855f7" strokeWidth="2" />
              <circle cx="47.5" cy="35" r="5" fill="#a855f7" />
              <text x="47.5" y="70" className={styles.toolGridLabel} textAnchor="middle">Glob Match</text>
              <text x="47.5" y="79" className={styles.toolGridDesc} textAnchor="middle">glob.ts</text>
            </g>

            <text x="815" y="322" className={styles.nodeInfoLabel} textAnchor="middle">
              Action handler suite
            </text>
          </g>
        </svg>
      </div>

      <div className={styles.interactiveGuide}>
        💡 <span>Click on any system component above to inspect its architecture, source code files, and execution logs.</span>
      </div>
    </div>
  );
}
