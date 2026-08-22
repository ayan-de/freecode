"use client";

import { useState } from "react";
import {
  FreeCodeInternalDiagram,
  type NodeType,
} from "./FreeCodeInternalDiagram";

export function ArchitectureBlueprint() {
  const [selectedNode, setSelectedNode] = useState<NodeType | null>(null);

  return (
    <FreeCodeInternalDiagram
      selectedNode={selectedNode}
      onSelectNode={setSelectedNode}
    />
  );
}
