"use client";

import { useState, useCallback } from "react";

export type TabId = "overview" | "cli" | "ipc" | "flow";

interface Tab {
  id: TabId;
  label: string;
  description: string;
}

const TABS: Tab[] = [
  {
    id: "overview",
    label: "Overview",
    description: "High-level system architecture",
  },
  {
    id: "cli",
    label: "CLI Backend",
    description: "All intelligence lives here",
  },
  { id: "ipc", label: "IPC Protocol", description: "JSON-RPC communication" },
  {
    id: "flow",
    label: "Data Flow",
    description: "Two-phase context collection",
  },
];

export function useArchitectureTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const handleTabChange = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
  }, []);

  return {
    tabs: TABS,
    activeTab,
    onTabChange: handleTabChange,
  };
}
