'use client';

import { useState, useEffect, useRef } from 'react';
import styles from '../ArchitectureExplorer.module.css';
import { NodeHeader } from './NodeHeader';

export function MemoryNodeContent() {
  const [memoryCapacity, setMemoryCapacity] = useState(35);
  const [isCompacting, setIsCompacting] = useState(false);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const clearAllTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  useEffect(() => {
    clearAllTimers();
    setIsCompacting(false);
    setMemoryCapacity(35);

    const runMemoryCycle = () => {
      let currentVal = 35;
      const interval = setInterval(() => {
        currentVal += 15;
        if (currentVal >= 95) {
          clearInterval(interval);
          setMemoryCapacity(98);
          setIsCompacting(true);
          const compactTimer = setTimeout(() => {
            setIsCompacting(false);
            setMemoryCapacity(15);
            const loopAgainTimer = setTimeout(runMemoryCycle, 2000);
            timersRef.current.push(loopAgainTimer);
          }, 3000);
          timersRef.current.push(compactTimer);
        } else {
          setMemoryCapacity(currentVal);
        }
      }, 1000);
      timersRef.current.push(setTimeout(() => clearInterval(interval), 10000));
    };

    runMemoryCycle();
    return () => clearAllTimers();
  }, []);

  return (
    <>
      <NodeHeader
        icon={<span>💾</span>}
        title="Memory & Log Compaction"
        subtext="Handling Long-Running Sessions"
      />
      <p className={styles.description}>
        When agent cycles run for dozens of turns, LLM context windows overflow. To prevent crashes, FreeCode accumulates session logs, and dynamically runs <strong>Memory Compaction</strong>.
      </p>
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Session History</span>
            <a href="file:///home/ayan-de/Projects/freecode/apps/core/src/agent/session.ts" className={styles.fileLink}>apps/core/src/agent/session.ts</a>
          </li>
        </ul>
      </div>
      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>History Buffer Status</span>
          <span className={isCompacting ? styles.yellowPulse : styles.amberPulse}></span>
        </div>
        <div className={styles.memoryBarContainer}>
          <div className={styles.memoryBarLabel}>
            <span>Context window capacity:</span>
            <span><strong>{memoryCapacity}%</strong> ({memoryCapacity * 100} / 10000 tokens)</span>
          </div>
          <div className={styles.memoryProgressBar}>
            <div
              className={`${styles.memoryFill} ${isCompacting ? styles.memoryFillCompacting : ''} ${memoryCapacity > 80 ? styles.memoryHigh : ''}`}
              style={{ width: `${memoryCapacity}%` }}
            />
          </div>
          {isCompacting && <div className={styles.compactAlert}>⚠️ BUFFER FULL! RUNNING BACKGROUND SUMMARIZATION DEAMON...</div>}
          {!isCompacting && memoryCapacity > 80 && <div className={styles.warningAlert}>🚨 CRITICAL LIMIT NEARING! PREPARING FOR COMPACTION CYCLE...</div>}
          {!isCompacting && memoryCapacity <= 35 && <div className={styles.successAlert}>✅ HISTORY COMPRESSED! Synced context window cleared.</div>}
        </div>
      </div>
    </>
  );
}