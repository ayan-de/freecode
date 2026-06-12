"use client";

import React from "react";
import { X } from "lucide-react";
import styles from "./ArchitectureExplorer.module.css";
import { type NodeType } from "../diagrams/FreeCodeInternalDiagram";
import {
  NodeHeader,
  ClientsNodeContent,
  AgentNodeContent,
  SubagentsNodeContent,
  ContextNodeContent,
  MemoryNodeContent,
  HooksNodeContent,
  ToolsNodeContent,
  ProviderNodeContent,
} from "./node-content";

interface ArchitectureExplorerProps {
  selectedNode: NodeType | null;
  onClose?: () => void;
}

export function ArchitectureExplorer({
  selectedNode,
  onClose,
}: ArchitectureExplorerProps) {
  const renderContent = () => {
    switch (selectedNode) {
      case "clients":
        return <ClientsNodeContent />;

      case "agent":
        return <AgentNodeContent />;

      case "subagents":
        return <SubagentsNodeContent />;

      case "context":
        return <ContextNodeContent />;

      case "memory":
        return <MemoryNodeContent />;

      case "hooks":
        return <HooksNodeContent />;

      case "tools":
        return <ToolsNodeContent />;

      case "provider":
        return <ProviderNodeContent />;

      default:
        return (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🔍</span>
            <h4>Interactive Blueprints Explorer</h4>
            <p>
              Click on any component card inside the system architecture diagram
              to explore details.
            </p>
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
          <X size={14} />
        </button>
      )}
      {renderContent()}
    </div>
  );
}
