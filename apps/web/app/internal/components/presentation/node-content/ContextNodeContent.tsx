"use client";

import { useState, useEffect, useRef } from "react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

export function ContextNodeContent() {
  const [compilationStep, setCompilationStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCompilationStep((prev) => (prev + 1) % 3);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <NodeHeader
        title="Context Engine"
        subtext="File Tree · Instructions · Prompt Compilation"
      />
      <p className={styles.description}>
        The Context Engine gives the model lightweight project awareness each
        turn. <strong>tree-cache.ts</strong> builds a cached{" "}
        <strong>ProjectContext</strong> — name, path, file tree, and git HEAD —
        and invalidates it after any mutating tool. The{" "}
        <strong>PromptCompiler</strong> then assembles the system prompt from the
        provider/mode preamble, project <strong>instructions</strong>{" "}
        (<code>CLAUDE.md</code>, falling back to <code>AGENTS.md</code>), the
        project summary + file tree, and session memory. The file tree is cached
        by git HEAD, so it only rebuilds when HEAD or ignore patterns change.
      </p>
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Tree Cache</span>
            <span className={styles.fileLink}>
              apps/core/src/context/tree-cache.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Prompt Compiler</span>
            <span className={styles.fileLink}>
              apps/core/src/context/compiler.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Instructions</span>
            <span className={styles.fileLink}>
              apps/core/src/context/instructions.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>File Tree</span>
            <span className={styles.fileLink}>
              apps/core/src/context/strategies/file-tree.ts
            </span>
          </li>
        </ul>
      </div>
      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Per-Turn Context Compilation</span>
          <span className={styles.emeraldPulse}></span>
        </div>
        <div className={styles.contextCompiler}>
          <div className={styles.compilerStep}>
            <span className={styles.stepIndicator}>PASS 1</span>
            <span>
              Resolve <strong>git HEAD</strong> + build file tree...{" "}
              <span className={styles.greenText}>CACHED (by HEAD)</span>
            </span>
          </div>
          <div className={styles.compilerStep}>
            <span className={styles.stepIndicator}>PASS 2</span>
            <span>
              Read instructions <strong>CLAUDE.md</strong> → AGENTS.md...{" "}
              <span className={styles.greenText}>LOADED</span>
            </span>
          </div>
          <div className={styles.compilerStep}>
            <span className={styles.stepIndicator}>PASS 3</span>
            <span>
              Compile <strong>SystemBlock[]</strong> (+ memory context)...{" "}
              <span className={styles.greenText}>OK</span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
