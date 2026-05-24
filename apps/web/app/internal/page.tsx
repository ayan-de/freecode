'use client';

import { PageHeader } from './components/presentation/PageHeader';
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
      <TabNavigation
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as TabId)}
      />

      {/* <PageHeader
        title="Internal Architecture"
        subtitle="Explore how FreeCode's thin-client architecture enables scalable AI-assisted coding"
      /> */}

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