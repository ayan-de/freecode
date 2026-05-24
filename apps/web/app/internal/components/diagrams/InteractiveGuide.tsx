import React from 'react';
import styles from './FreeCodeInternalDiagram.module.css';

export function InteractiveGuide() {
  return (
    <div className={styles.interactiveGuide}>
      💡 <span>Click on any system component above to inspect its architecture, source code files, and execution logs.</span>
    </div>
  );
}