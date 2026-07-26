"use client";

import React from "react";
import { Brain, FileText, Zap, Database, Network, Sparkles } from "lucide-react";
import styles from "../ArchitectureExplorer.module.css";
import { NodeHeader } from "./NodeHeader";

const MEMORY_FLOW_STEPS = [
  {
    number: 1,
    title: "1. Write down each message",
    description:
      "Every user prompt and model reply is saved, and we estimate its size in tokens (≈ 4 characters = 1 token). Long tool output is trimmed first so it can't hog space.",
  },
  {
    number: 2,
    title: "2. Are we running out of room?",
    description:
      "After each turn we compare the running token count to the model's real context limit (looked up from models.dev) minus a 13,000-token safety buffer. Cross that line and compaction kicks in.",
  },
  {
    number: 3,
    title: "3. Decide what to keep vs. fold away",
    description:
      "The last 2 user turns (capped at 8,000 tokens) are kept word-for-word so recent detail survives. Everything older is marked to be summarized.",
  },
  {
    number: 4,
    title: "4. Ask permission (PreCompact hook)",
    description:
      "A PreCompact hook can veto the compaction. If it blocks, we back off and don't retry until another 5,000 tokens pile up — so we don't re-ask every message.",
  },
  {
    number: 5,
    title: "5. Summarize the old messages",
    description:
      "The active model writes a short, structured recap (Goal · Done · In Progress · Blocked · Decisions · Files · Next Steps). If that call fails, a keyword-based summary is used as a fallback.",
  },
  {
    number: 6,
    title: "6. Swap it in and save",
    description:
      "History becomes [summary + preserved recent turns], the token count drops back down, state is written to disk atomically, and a PostCompact hook is notified.",
  },
];

const memoryComponents = [
  {
    name: "MemoryService",
    file: "apps/core/src/compaction/service.ts",
    description: "Orchestrates recording, the threshold check, and compaction",
    icon: Brain,
    color: "#f59e0b",
  },
  {
    name: "FileMemoryStorage",
    file: "apps/core/src/compaction/storage.ts",
    description: "Atomic JSON persistence at ~/.freecode/memory/{sessionId}",
    icon: Database,
    color: "#f59e0b",
  },
  {
    name: "tokens.ts",
    file: "apps/core/src/compaction/tokens.ts",
    description: "Token estimate + the 'should we compact?' math",
    icon: Zap,
    color: "#f59e0b",
  },
  {
    name: "selector.ts",
    file: "apps/core/src/compaction/selector.ts",
    description: "selectForCompaction — preserve recent, summarize old",
    icon: FileText,
    color: "#f59e0b",
  },
  {
    name: "summarizer.ts",
    file: "apps/core/src/compaction/summarizer.ts",
    description: "LLM summary (with a heuristic fallback), carried forward",
    icon: FileText,
    color: "#f59e0b",
  },
];

const compactionStats = [
  { label: "preserveRecentTurns", value: "2 turns" },
  { label: "autoCompactBufferTokens", value: "13,000" },
  { label: "maxPreserveRecentTokens", value: "8,000" },
  { label: "maxToolOutputChars", value: "2,000" },
];

// ---------------------------------------------------------------------------
// Persistent memory + the derived knowledge graph (apps/core/src/memory/*).
// This is a DIFFERENT kind of memory from compaction above: compaction manages
// one session's context window; this remembers facts ACROSS sessions.
// ---------------------------------------------------------------------------

const GRAPH_FLOW_STEPS = [
  {
    number: 1,
    title: "1. Embed each memory — on your machine",
    description:
      "A small model (all-MiniLM-L6-v2) turns every memory's text into a 384-number vector that captures its meaning. It runs locally via ONNX — no network call — and the result is cached by content hash, so unchanged memories are never re-embedded. Anything that looks like a secret is never embedded.",
  },
  {
    number: 2,
    title: "2. Wire the memories into a graph",
    description:
      "Each memory becomes a node. Edges are drawn deterministically from the files: shared tags → HasTag, [[wikilinks]] in the body → RelatesTo, and frontmatter `supersedes` → Supersedes. Similar memories are also grouped into clusters (deterministic k-means) so related notes can relay to each other.",
  },
  {
    number: 3,
    title: "3. Seed from what you just said",
    description:
      "The current message is embedded and compared against every memory vector; the closest handful (cosine top-k) become the seeds. If embeddings aren't available, it quietly falls back to keyword search — retrieval never breaks the loop.",
  },
  {
    number: 4,
    title: "4. Cascade outward along the edges",
    description:
      "Starting from those seeds it walks the graph up to 2 hops, following tag / link / cluster edges. Each hop's score decays (×0.7), and Contradicts edges are skipped — so a directly-relevant memory also pulls in its closest neighbours, but weakly.",
  },
  {
    number: 5,
    title: "5. Inject one turn behind",
    description:
      "Embedding takes a moment, so retrieval runs in the background. The agent reads whatever the previous background pass produced — the hot path never waits. When the topic clearly changes, the stale set is dropped rather than injected off-topic.",
  },
];

const graphComponents = [
  {
    name: "embedder.ts",
    description: "Local ONNX embeddings (optional dep) → keyword fallback",
    icon: Sparkles,
    color: "#22d3ee",
  },
  {
    name: "vector-store.ts",
    description: "Packed f32 vectors + content-hash cache (.graph/embeddings.bin)",
    icon: Database,
    color: "#22d3ee",
  },
  {
    name: "builder.ts",
    description: "Derives tag / wikilink / supersede edges (deterministic)",
    icon: Network,
    color: "#22d3ee",
  },
  {
    name: "clusters.ts",
    description: "Deterministic k-means grouping over the embeddings",
    icon: Network,
    color: "#22d3ee",
  },
  {
    name: "cascade.ts",
    description: "Seed top-k → graph walk with per-hop decay",
    icon: Zap,
    color: "#22d3ee",
  },
  {
    name: "secret-filter.ts",
    description: "Guarantees secret-bearing memories are never embedded",
    icon: FileText,
    color: "#22d3ee",
  },
  {
    name: "index.ts",
    description: "MemoryGraphService — sync, background prefetch, injection",
    icon: Brain,
    color: "#22d3ee",
  },
];

const graphStats = [
  { label: "embedding model", value: "all-MiniLM-L6-v2" },
  { label: "vector dims", value: "384" },
  { label: "seed pool (K_INITIAL)", value: "10" },
  { label: "seed threshold (cosine)", value: "0.4" },
  { label: "cascade maxDepth", value: "2 hops" },
  { label: "per-hop decay", value: "0.7" },
  { label: "memories injected", value: "≤ 8" },
];

export function MemoryNodeContent() {
  return (
    <>
      <NodeHeader
        title="Memory"
        subtext="Session Compaction · Persistent Memory · Knowledge Graph"
      />
      <p className={styles.description}>
        <strong>The problem:</strong> a model can only read so much at once — its{" "}
        <strong>context window</strong>. Think of it like a whiteboard with
        limited space. As a conversation grows, the whiteboard fills up, and
        eventually there&apos;s no room left to write the next reply.
      </p>
      <p className={styles.description}>
        <strong>Compaction</strong> is how FreeCode keeps long sessions from
        overflowing. When the conversation gets close to full, it{" "}
        <strong>erases the old notes and replaces them with a short summary</strong>{" "}
        — while keeping the last couple of turns exactly as they were. The
        session keeps going, the gist is preserved, and there&apos;s room to
        write again.
      </p>

      {/* Worked example — the trigger is BEFORE the window is full */}
      <div className={styles.compactAlert}>
        EXAMPLE · 1,000,000-token window
        <br />
        compaction fires at 1,000,000 − 13,000 = 987,000 tokens
        <br />
        (it triggers just BEFORE full, leaving ~13k headroom for the reply)
      </div>

      <p className={styles.description}>
        Notice it does <strong>not</strong> wait until the window is completely
        full — it fires a little early, on purpose, so there&apos;s always
        headroom for the model to answer. Here&apos;s the whole cycle, step by
        step:
      </p>

      {/* Memory Flow */}
      <div className={`${styles.flowContainer} ${styles.memoryFlow}`}>
        {MEMORY_FLOW_STEPS.map((step, idx) => (
          <React.Fragment key={step.number}>
            <div className={styles.flowStep}>
              <div className={styles.flowContent}>
                <h4 className={styles.flowTitle}>{step.title}</h4>
                <p className={styles.flowDescription}>{step.description}</p>
              </div>
            </div>
            {idx < MEMORY_FLOW_STEPS.length - 1 && (
              <div className={styles.flowArrow}>↓</div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Key Files */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>🔑 Memory Components</h5>
        <ul className={styles.filesList}>
          {memoryComponents.map((comp) => (
            <li key={comp.name}>
              <span className={styles.fileBadge}>{comp.name}</span>
              <span style={{ color: comp.color, fontSize: "12px" }}>
                {comp.description}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Compaction Stats */}
      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Compaction Config (the knobs)</h5>
        <div className={styles.execList}>
          {compactionStats.map((stat) => (
            <div key={stat.label} className={styles.execItem}>
              <span
                className={styles.execMode}
                style={{ background: "#f59e0b" }}
              >
                {stat.label}
              </span>
              <span className={styles.execTools}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ================= Persistent Memory & Knowledge Graph ================= */}
      <NodeHeader
        title="Persistent Memory & the Knowledge Graph"
        subtext="Remembering facts across sessions"
      />
      <p className={styles.description}>
        Compaction (above) keeps a <em>single</em> conversation from overflowing.{" "}
        <strong>Persistent memory</strong> is the other half: small markdown
        notes — typed <code>user</code>, <code>feedback</code>,{" "}
        <code>project</code>, or <code>reference</code> — that FreeCode writes
        down and keeps <strong>across</strong> sessions, so it doesn&apos;t
        re-learn your preferences and project facts every time.
      </p>
      <p className={styles.description}>
        <strong>The problem:</strong> once you have dozens of these notes,
        pasting all of them into every prompt wastes tokens and buries the two
        that actually matter. The <strong>knowledge graph</strong> is a derived,
        throw-away-able index (a <code>.graph/</code> sidecar you can delete and
        rebuild) that surfaces just the handful of memories relevant to what
        you&apos;re doing right now.
      </p>

      <div className={styles.compactAlert}>
        DERIVED · REBUILDABLE
        <br />
        the markdown files are the source of truth
        <br />
        (delete .graph/ any time → `freecode memory graph rebuild`)
      </div>

      {/* Graph Flow */}
      <div className={`${styles.flowContainer} ${styles.memoryFlow}`}>
        {GRAPH_FLOW_STEPS.map((step, idx) => (
          <React.Fragment key={step.number}>
            <div className={styles.flowStep}>
              <div className={styles.flowContent}>
                <h4 className={styles.flowTitle}>{step.title}</h4>
                <p className={styles.flowDescription}>{step.description}</p>
              </div>
            </div>
            {idx < GRAPH_FLOW_STEPS.length - 1 && (
              <div className={styles.flowArrow}>↓</div>
            )}
          </React.Fragment>
        ))}
      </div>

      <p className={styles.description}>
        Every step degrades gracefully: if the local embedder can&apos;t load
        (say, a minimal install), retrieval silently falls back to keyword search
        and the agent keeps working — it just loses the semantic ranking.
      </p>

      {/* Graph Key Files */}
      <div className={styles.filesBox}>
        <h5 className={styles.filesTitle}>
          🔑 Knowledge Graph (apps/core/src/memory/graph/)
        </h5>
        <ul className={styles.filesList}>
          {graphComponents.map((comp) => (
            <li key={comp.name}>
              <span className={styles.fileBadge}>{comp.name}</span>
              <span style={{ color: comp.color, fontSize: "12px" }}>
                {comp.description}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Graph Stats */}
      <div className={styles.execModes}>
        <h5 className={styles.execTitle}>Retrieval Config (the knobs)</h5>
        <div className={styles.execList}>
          {graphStats.map((stat) => (
            <div key={stat.label} className={styles.execItem}>
              <span
                className={styles.execMode}
                style={{ background: "#22d3ee" }}
              >
                {stat.label}
              </span>
              <span className={styles.execTools}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
