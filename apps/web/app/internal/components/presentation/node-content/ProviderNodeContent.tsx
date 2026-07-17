"use client";

import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

const providers = [
  {
    id: "anthropic",
    name: "Anthropic",
    model: "claude-sonnet-4-5",
    color: "#f97316",
  },
  { id: "openai", name: "OpenAI", model: "gpt-4o", color: "#10b981" },
  { id: "gemini", name: "Gemini", model: "gemini-2.0-flash", color: "#3b82f6" },
  { id: "minimax", name: "MiniMax", model: "MiniMax-M2", color: "#8b5cf6" },
];

export function ProviderNodeContent() {
  return (
    <>
      <NodeHeader
        title="AI Provider Layer"
        subtext="Multi-Provider API · Vercel AI SDK"
      />
      <p className={styles.description}>
        Every provider implements one common <strong>AIProvider</strong>{" "}
        interface and self-registers into the <strong>registry</strong>, so
        swapping Anthropic ↔ OpenAI ↔ Gemini ↔ MiniMax needs no change to the
        loop. Calls go through the <strong>Vercel AI SDK</strong> with real{" "}
        <strong>streaming</strong>, native <strong>tool calling</strong>,
        extended <strong>thinking</strong>, prompt caching, and usage
        accounting — all normalized into a single chunk stream. A{" "}
        <strong>recovery</strong> layer retries transient errors and falls back
        to a secondary provider. (Browser automation is a legacy path, not the
        default.)
      </p>

      {/* Multi-Provider Grid */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Available Providers</h5>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            marginTop: "8px",
          }}
        >
          {providers.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "10px",
                borderRadius: "8px",
                border: `1px solid ${p.color}44`,
                background: `${p.color}11`,
              }}
            >
              <div
                style={{ fontWeight: "bold", color: p.color, fontSize: "14px" }}
              >
                {p.name}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
                {p.model}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Key Codebase Implementations:</h5>
        <ul className={styles.filesList}>
          <li>
            <span className={styles.fileBadge}>Registry</span>
            <span className={styles.fileLink}>
              apps/core/src/providers/registry.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Adapters</span>
            <span className={styles.fileLink}>
              apps/core/src/providers/&#123;anthropic,openai,gemini,minimax&#125;.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Streaming</span>
            <span className={styles.fileLink}>
              apps/core/src/providers/streaming.ts
            </span>
          </li>
          <li>
            <span className={styles.fileBadge}>Recovery</span>
            <span className={styles.fileLink}>
              apps/core/src/agent/recovery/manager.ts
            </span>
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
  -> recovery.callProvider(...)   // retry + fallback chain
  -> provider.stream({ messages, system, tools })
       yields text_delta | thinking_delta | tool_call | usage
  -> loop executes tool_calls, feeds results into next turn`}</pre>
        </div>
      </div>
    </>
  );
}
