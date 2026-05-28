'use client';

import { Globe } from 'lucide-react';
import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

const providers = [
  { id: 'anthropic', name: 'Anthropic', model: 'Claude 3.5 Sonnet', color: '#f97316' },
  { id: 'openai', name: 'OpenAI', model: 'GPT-4o', color: '#10b981' },
  { id: 'gemini', name: 'Gemini', model: 'Gemini Pro', color: '#3b82f6' },
  { id: 'minimax', name: 'MiniMax', model: 'MiniMax-M2', color: '#8b5cf6' },
];

export function ProviderNodeContent() {
  return (
    <>
      <NodeHeader
        icon={<Globe size={24} color="#38bdf8" />}
        title="LLM / Browser Call Boundary"
        subtext="Multi-Provider External Automation"
      />
      <p className={styles.description}>
        The CLI owns the browser automation path. The agent loop builds the task prompt, the browser controller fills the provider UI, and provider adapters isolate DOM selectors. Providers are swappable via the registry pattern.
      </p>

      {/* Multi-Provider Grid */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Available Providers</h5>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
          {providers.map((p) => (
            <div key={p.id} style={{
              padding: '10px',
              borderRadius: '8px',
              border: `1px solid ${p.color}44`,
              background: `${p.color}11`,
            }}>
              <div style={{ fontWeight: 'bold', color: p.color, fontSize: '14px' }}>{p.name}</div>
              <div style={{ fontSize: '11px', color: '#aaa' }}>{p.model}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Provider Registry</span>
            <a href="file:///home/ayande/Project/freecode/apps/core/src/providers/registry.ts" className={styles.fileLink}>apps/core/src/providers/registry.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>Provider Index</span>
            <a href="file:///home/ayande/Project/freecode/apps/core/src/providers/index.ts" className={styles.fileLink}>apps/core/src/providers/index.ts</a>
          </li>
          <li>
            <span className={styles.fileBadge}>Agent Loop</span>
            <a href="file:///home/ayande/Project/freecode/apps/core/src/agent/loop.ts" className={styles.fileLink}>apps/core/src/agent/loop.ts</a>
          </li>
        </ul>
      </div>
      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Provider Call Sequence</span>
          <span className={styles.bluePulse}></span>
        </div>
        <div className={styles.simConsole}>
          <pre className={styles.jsonCode}>{`agent/loop.ts
  -> getProvider(provider)
  -> provider.execute({ prompt })
  -> returns ExecuteResult { content, usage, stopReason }
  -> normalizeResponse() -> parseResponse()`}</pre>
        </div>
      </div>
    </>
  );
}