'use client';

import React from 'react';
import styles from './FreeCodeInternalDiagram.module.css';
import { DiagramDefinitions } from './definitions/DiagramDefinitions';
import { BackgroundGrid } from './BackgroundGrid';
import { SandboxContainer } from './SandboxContainer';
import { TaskFlow } from './flows/TaskFlow';
import { SubagentFlow } from './flows/SubagentFlow';
import { ContextFlow } from './flows/ContextFlow';
import { MemoryFlow } from './flows/MemoryFlow';
import { HooksFlow } from './flows/HooksFlow';
import { ResultFlow } from './flows/ResultFlow';
import { ProviderFlow } from './flows/ProviderFlow';
import { ClientsNode } from './nodes/ClientsNode';
import { AgentNode } from './nodes/AgentNode';
import { SubagentsNode } from './nodes/SubagentsNode';
import { ContextNode } from './nodes/ContextNode';
import { MemoryNode } from './nodes/MemoryNode';
import { HooksNode } from './nodes/HooksNode';
import { ToolsNode } from './nodes/ToolsNode';
import { ProviderNode } from './nodes/ProviderNode';
import { InteractiveGuide } from './InteractiveGuide';

export type NodeType =
  | 'clients'
  | 'agent'
  | 'subagents'
  | 'context'
  | 'memory'
  | 'hooks'
  | 'tools'
  | 'provider';

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
        <span className={styles.diagramLabel}>INTERACTIVE FREECODE SYSTEM BLUEPRINT</span>
      </div>

      <div className={styles.diagramWrapper}>
        <svg
          className={styles.svg}
          viewBox="0 0 1000 650"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <DiagramDefinitions />
          <BackgroundGrid />

          {/* ==================== SANDBOX / SYSTEM CONTAINER ==================== */}
          <SandboxContainer />

          {/* ==================== CONNECTIONS / FLOWS ==================== */}
          <TaskFlow />
          <SubagentFlow />
          <ContextFlow />
          <MemoryFlow />
          <HooksFlow />
          <ResultFlow />
          <ProviderFlow />

          {/* ==================== SANDBOX / SYSTEM CONTAINER ==================== */}
          <SandboxContainer />

          {/* ==================== NODES / INTERACTIVE CARDS ==================== */}
          <ClientsNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
          <AgentNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
          <SubagentsNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
          <ContextNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
          <MemoryNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
          <HooksNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
          <ToolsNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
          <ProviderNode selectedNode={selectedNode} onSelectNode={onSelectNode} />
        </svg>
      </div>

      <InteractiveGuide />
    </div>
  );
}
