"use client";

import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

const eventFamilies = [
  { mode: "stream", tools: "text / thinking / tool deltas — the live turn output", color: "#22d3ee" },
  { mode: "session.*", tools: "created · updated · error · diff", color: "#10b981" },
  { mode: "tool.* / subagent.*", tools: "tool + sub-agent lifecycle progress", color: "#f97316" },
  { mode: "question.* / permission.*", tools: "two-way: ask → wait → answer", color: "#a855f7" },
  { mode: "mcp.server.* / mcp.tools.changed", tools: "MCP server + tool changes", color: "#ec4899" },
];

export function BusNodeContent() {
  return (
    <>
      <NodeHeader
        title="Event Bus"
        subtext="Pub/Sub · Single Frontend Egress"
      />

      <p className={styles.description}>
        Think of the backend as a <strong>busy kitchen</strong> full of cooks —
        the Agent, the Tools, the Sub-agents, the Hooks. None of them can leave
        the kitchen to talk to you, so the kitchen has a{" "}
        <strong>loudspeaker on the wall</strong>: that is the{" "}
        <strong>Bus</strong>. Whenever anything happens, a cook{" "}
        <strong>shouts one line</strong> into it — <em>&quot;Chef is
        thinking!&quot;</em>, <em>&quot;I just edited db.ts!&quot;</em>,{" "}
        <em>&quot;Can I run this scary command? 🙋&quot;</em> — without caring who
        is listening. That is the magic word: <strong>pub/sub</strong> (publish
        once, everyone who cares hears it). Out front, one waiter (the{" "}
        <strong>bridge</strong>) listens to <em>every</em> shout and carries it
        through <strong>one single door</strong> to your screen (TUI, VS Code, or
        Web) — which is why you see text stream in live and tools light up as
        they run. The Bus can also <strong>ask you a question and wait</strong>{" "}
        for your yes/no to come back, then hand the answer to the exact cook who
        asked.
      </p>

      {/* How a message travels */}
      <div className={styles.contextCompiler}>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 1</span>
          <span>
            A core module calls <strong>bus.publish(event)</strong> — e.g.{" "}
            <code>BusEvents.stream(sessionId, delta)</code>
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 2</span>
          <span>
            The bus emits the event&apos;s type <strong>and</strong> a{" "}
            <code>&quot;*&quot;</code> wildcard so all-event listeners hear it
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 3</span>
          <span>
            <strong>bridge.ts</strong> maps the bus event to a{" "}
            <strong>StreamEvent</strong> and drops internal-only ones{" "}
            <span className={styles.greenText}>(no double-emit)</span>
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 4</span>
          <span>
            The single <code>subscribeAll</code> egress writes it to{" "}
            <strong>stdout</strong> (TUI) and <strong>SSE</strong> (Web)
          </span>
        </div>
        <div className={styles.compilerStep}>
          <span className={styles.stepIndicator}>STEP 5</span>
          <span>
            For <strong>ask</strong> events, a pending Promise (keyed by{" "}
            <code>requestId</code>) waits for the answer — headless resolves to{" "}
            <strong>deny</strong>, never allow
          </span>
        </div>
      </div>

      {/* Event families */}
      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Event Families</h5>
        <div className={styles.execList}>
          {eventFamilies.map((e) => (
            <div key={e.mode} className={styles.execItem}>
              <span className={styles.execMode} style={{ background: e.color }}>
                {e.mode}
              </span>
              <span className={styles.execTools}>{e.tools}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Source Links */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Bus + Helpers</span>
            <span className={styles.fileLink}>apps/core/src/bus/index.ts</span>
          </li>
          <li>
            <span className={styles.fileBadge}>Wire Mapping</span>
            <span className={styles.fileLink}>apps/core/src/bus/bridge.ts</span>
          </li>
          <li>
            <span className={styles.fileBadge}>Single Egress</span>
            <span className={styles.fileLink}>
              apps/core/src/server.ts (subscribeAll → stdout + SSE)
            </span>
          </li>
        </ul>
      </div>

      <div className={styles.simContainer}>
        <div className={styles.simHeader}>
          <span>Events On The Wire</span>
          <span className={styles.bluePulse}></span>
        </div>
        <div className={styles.simConsole}>
          <pre className={styles.jsonCode}>{`bus.publish({ type: "stream", sessionId, event })
  -> bridge: unwrap -> StreamEvent
  -> stdout: { "type": "text_delta", "delta": "Reading db.ts" }

bus.publish({ type: "permission.asked", requestId, ... })
  -> UI answers -> answerPermission(requestId, { decision })
  -> resolves the pending Promise the tool is awaiting`}</pre>
        </div>
      </div>
    </>
  );
}
