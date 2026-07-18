"use client";

import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";
import { PermissionModeSimulator } from "./PermissionModeSimulator";

export function HooksNodeContent() {
  return (
    <>
      <NodeHeader
        title="Safety Middleware — Permissions + Hooks"
        subtext="Rules engine, agent modes & lifecycle interceptors"
      />
      <p className={styles.description}>
        Every tool call passes through two cooperating layers before it
        executes. The <strong>permission rules engine</strong> matches the call
        against user-editable <strong>allow / ask / deny</strong> rules like{" "}
        <code>Bash(npm run test:*)</code> or <code>Read(./secrets/**)</code>,
        merged from project (<code>.freecode/settings.json</code>) and user (
        <code>~/.freecode/settings.json</code>) scopes plus in-session grants.
        The <strong>hooks pipeline</strong> (PreToolUse, PermissionRequest,
        PostToolUse, …) can block, modify, or override around it.
      </p>

      <div className={styles.contextCompiler}>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 1</span>
          <span>
            <strong>danger</strong> mode? Skip everything — no rules, no hooks,
            no prompts. <span className={styles.greenText}>EXECUTE</span>
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 2</span>
          <span>
            Mode enforcement: <strong>plan / review / explore</strong> hard-deny
            mutations — an allow rule cannot override
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 3</span>
          <span>
            <strong>PreToolUse</strong> hooks may block or rewrite the call
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 4</span>
          <span>
            Rules engine: <strong>deny &gt; ask &gt; allow</strong>, first match
            wins; unmatched calls fall to the mode default
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 5</span>
          <span>
            <strong>PermissionRequest</strong> hooks may override ask→allow or
            anything→deny (a rules deny is absolute)
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 6</span>
          <span>
            <strong>ask</strong> → interactive prompt over the bus (
            <code>permission_asked</code> → <code>permission.answer</code>);
            headless resolves to deny, never allow
          </span>
        </div>
      </div>

      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Rules Engine</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/core/src/permission"
              className={styles.fileLink}
            >
              apps/core/src/permission/ (rules · evaluate · mode-policy ·
              settings · prompt)
            </a>
          </li>
          <li>
            <span className={styles.fileBadge}>Hook Handlers</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/core/src/hooks"
              className={styles.fileLink}
            >
              apps/core/src/hooks/
            </a>
          </li>
          <li>
            <span className={styles.fileBadge}>Pipeline Wiring</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/core/src/agent/loop.ts"
              className={styles.fileLink}
            >
              apps/core/src/agent/loop.ts (executeTool)
            </a>
          </li>
          <li>
            <span className={styles.fileBadge}>Design Spec</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/docs/superpowers/specs/2026-07-18-permission-rules.md"
              className={styles.fileLink}
            >
              docs/superpowers/specs/2026-07-18-permission-rules.md
            </a>
          </li>
        </ul>
      </div>

      <PermissionModeSimulator />
    </>
  );
}
