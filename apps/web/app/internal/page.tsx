'use client';

import { TabNavigation } from './components/presentation/TabNavigation';
import {
  OverviewContainer,
  CLIContainer,
  IPCContainer,
  FlowContainer,
} from './components/containers';
import { useArchitectureTabs, type TabId } from './hooks';
import styles from './page.module.css';

export default function InternalPage() {
  const { tabs, activeTab, onTabChange } = useArchitectureTabs();

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewContainer />;
      case 'cli':
        return <CLIContainer />;
      case 'ipc':
        return <IPCContainer />;
      case 'flow':
        return <FlowContainer />;
      default:
        return <OverviewContainer />;
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Internal Architecture</h1>
        <p className={styles.subtitle}>
          Explore how FreeCode&apos;s thin-client architecture enables scalable AI-assisted coding
        </p>
      </header>

      <div className={styles.navigation}>
        <TabNavigation
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => onTabChange(id as TabId)}
        />
      </div>

      <main className={styles.content}>
        {renderContent()}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <span className={styles.footerLabel}>FreeCode Architecture</span>
          <span className={styles.footerDot}>·</span>
          <span className={styles.footerVersion}>CLI-driven thin clients</span>
        </div>
      </footer>
    </div>
  );
}