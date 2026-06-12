"use client";

import { useState, useEffect, useRef } from "react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

export function ClientsNodeContent() {
  const [ipcStep, setIpcStep] = useState(0);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    clearAllTimers();
    const cycleIpc = () => {
      setIpcStep((prev) => (prev + 1) % 4);
      const timer = setTimeout(cycleIpc, 3000);
      timersRef.current.push(timer);
    };
    const timer = setTimeout(cycleIpc, 3000);
    timersRef.current.push(timer);
    return () => clearAllTimers();
  }, []);

  const clearAllTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  return (
    <>
      <NodeHeader
        icon={<span>💻</span>}
        title="You / Clients Frontends"
        subtext="Thin Client UI Presentation"
      />

      <p className={styles.description}>
        FreeCode is designed with a{" "}
        <strong>strict separation of concerns</strong>. The TUI (Terminal User
        Interface) and VS Code extensions contain{" "}
        <strong>zero business logic</strong>. They do not handle browser
        automation, file reading/writing, or AI reasoning. They act purely as
        rendering engines and user interaction captures.
      </p>

      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>TUI Shell</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/tui/src/index.ts"
              className={styles.fileLink}
            >
              apps/tui/src/index.ts
            </a>
          </li>
          <li>
            <span className={styles.fileBadge}>VSCode Ext</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/vscode/src/extension.ts"
              className={styles.fileLink}
            >
              apps/vscode/src/extension.ts
            </a>
          </li>
          <li>
            <span className={styles.fileBadge}>Types/IPC</span>
            <a
              href="file:///home/ayan-de/Projects/freecode/apps/core/src/ipc/protocol.ts"
              className={styles.fileLink}
            >
              packages/shared/src/ipc/protocol.ts
            </a>
          </li>
        </ul>
      </div>

      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>JSON-RPC Live Communication Stream</span>
          <span className={styles.greenPulse}></span>
        </div>
        <div className={styles.simConsole}>
          {ipcStep === 0 && (
            <pre
              className={styles.jsonCode}
            >{`// 1. Client connects and starts a new project session
--> WRITE stdin (Request):
{
  "jsonrpc": "2.0",
  "id": 101,
  "method": "session.start",
  "params": {
    "projectPath": "/home/user/my-app",
    "provider": "chatgpt"
  }
}`}</pre>
          )}
          {ipcStep === 1 && (
            <pre className={styles.jsonCode}>{`<-- READ stdout (Response):
{
  "jsonrpc": "2.0",
  "id": 101,
  "result": {
    "sessionId": "sess_8f3d12c6"
  }
}`}</pre>
          )}
          {ipcStep === 2 && (
            <pre
              className={styles.jsonCode}
            >{`// 2. User sends prompt to the Agent
--> WRITE stdin (Request):
{
  "jsonrpc": "2.0",
  "id": 102,
  "method": "session.send",
  "params": {
    "sessionId": "sess_8f3d12c6",
    "message": "Fix database connection limits in db.ts"
  }
}`}</pre>
          )}
          {ipcStep === 3 && (
            <pre
              className={styles.jsonCode}
            >{`<-- READ stdout (Streaming MessagePart):
{
  "jsonrpc": "2.0",
  "id": 102,
  "result": {
    "type": "text",
    "content": "Searching for database connection files..."
  }
}`}</pre>
          )}
        </div>
      </div>
    </>
  );
}
