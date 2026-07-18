"use client";

import { TabNavigation } from "./components/presentation/TabNavigation";
import { PageWrapper } from "../components/PageWrapper";
import {
  OverviewContainer,
  CLIContainer,
  IPCContainer,
  LifecycleContainer,
} from "./components/containers";
import { useArchitectureTabs, type TabId } from "./hooks";
import styles from "./page.module.css";

export function InternalArchitecture() {
  const { tabs, activeTab, onTabChange } = useArchitectureTabs();

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return <OverviewContainer />;
      case "cli":
        return <CLIContainer />;
      case "ipc":
        return <IPCContainer />;
      case "lifecycle":
        return <LifecycleContainer />;
      default:
        return <OverviewContainer />;
    }
  };

  return (
    <PageWrapper>
      <div className={styles.page}>
        <TabNavigation
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => onTabChange(id as TabId)}
        />

        <main className={styles.content}>{renderContent()}</main>

        <footer className={styles.footer}>
          <div className={styles.footerContent}>
            <span className={styles.footerLabel}>FreeCode Architecture</span>
            <span className={styles.footerDot}>·</span>
            <span className={styles.footerVersion}>
              CLI-driven thin clients
            </span>
          </div>
        </footer>
      </div>
    </PageWrapper>
  );
}
