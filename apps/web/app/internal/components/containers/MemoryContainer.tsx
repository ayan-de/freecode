"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Cpu,
  Database,
  Network,
  GitBranch,
  ArrowRight,
  Lock,
  RefreshCw,
  Play,
  Sparkles,
  Info,
  Layers,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";
import styles from "./MemoryContainer.module.css";

// MOCK DATA FOR VECTOR SIMILARITY WIDGET
interface VectorNode {
  id: string;
  text: string;
  x: number; // mapped coordinates on a 2D plane for display
  y: number;
  category: "tooling" | "editor" | "system";
}

const MOCK_VECTOR_NODES: VectorNode[] = [
  { id: "A", text: "User prefers pnpm for packages", x: 260, y: 150, category: "tooling" },
  { id: "B", text: "Install dependencies using pnpm", x: 300, y: 100, category: "tooling" },
  { id: "C", text: "Use dark theme for VS Code editor", x: 120, y: 320, category: "editor" },
  { id: "D", text: "Editor theme config: dark mode", x: 90, y: 280, category: "editor" },
  { id: "E", text: "Project is written in TypeScript", x: 420, y: 220, category: "system" },
  { id: "F", text: "Target OS is Linux", x: 500, y: 290, category: "system" }
];

interface QueryPreset {
  id: string;
  query: string;
  x: number; // Query coordinate in the mock space
  y: number;
}

const QUERY_PRESETS: QueryPreset[] = [
  { id: "q1", query: "package manager preference", x: 275, y: 125 },
  { id: "q2", query: "how should I style the editor", x: 110, y: 295 },
  { id: "q3", query: "what programming language is used", x: 390, y: 200 }
];

// MOCK DATA FOR GRAPH BFS CASCADE WIDGET
interface GraphNode {
  id: string;
  label: string;
  type: "memory" | "tag" | "cluster";
  x: number;
  y: number;
  description: string;
}

interface GraphEdge {
  from: string;
  to: string;
  kind: "HasTag" | "RelatesTo" | "Supersedes" | "Contradicts" | "InCluster";
  weight: number;
}

const GRAPH_NODES: GraphNode[] = [
  { id: "M1", label: "User prefers pnpm", type: "memory", x: 150, y: 150, description: "Persistent memory stating user package preference" },
  { id: "M2", label: "pnpm install command", type: "memory", x: 320, y: 90, description: "Helper memory about pnpm commands and flags" },
  { id: "M3", label: "VS Code editor theme", type: "memory", x: 450, y: 300, description: "Memory detail regarding UI theme" },
  { id: "M4", label: "Target OS: Linux", type: "memory", x: 680, y: 200, description: "Target environment memory card" },
  { id: "T1", label: "#package-mgr", type: "tag", x: 220, y: 280, description: "Common tag node grouping package topics" },
  { id: "T2", label: "#editor", type: "tag", x: 550, y: 380, description: "Tag node grouping editor preferences" },
  { id: "C1", label: "Cluster: Tooling", type: "cluster", x: 100, y: 60, description: "Auto-discovered semantic cluster of memory nodes" },
  { id: "C2", label: "Cluster: Configs", type: "cluster", x: 580, y: 100, description: "Auto-discovered config theme cluster" }
];

const GRAPH_EDGES: GraphEdge[] = [
  { from: "M1", to: "T1", kind: "HasTag", weight: 0.8 },
  { from: "M2", to: "T1", kind: "HasTag", weight: 0.8 },
  { from: "M3", to: "T2", kind: "HasTag", weight: 0.8 },
  { from: "M1", to: "M2", kind: "RelatesTo", weight: 0.7 },
  { from: "M1", to: "C1", kind: "InCluster", weight: 0.6 },
  { from: "M2", to: "C1", kind: "InCluster", weight: 0.6 },
  { from: "M3", to: "C2", kind: "InCluster", weight: 0.6 },
  { from: "M4", to: "C2", kind: "InCluster", weight: 0.6 },
  { from: "M1", to: "M3", kind: "Contradicts", weight: 0.0 } // contradicts has weight 0, is skipped
];

// MOCK DATA FOR K-MEANS WIDGET
interface ClusterPoint {
  id: number;
  x: number;
  y: number;
  clusterId: number | null;
}

const INITIAL_POINTS: ClusterPoint[] = [
  { id: 1, x: 80, y: 80, clusterId: null },
  { id: 2, x: 100, y: 120, clusterId: null },
  { id: 3, x: 140, y: 90, clusterId: null },
  { id: 4, x: 90, y: 60, clusterId: null },
  { id: 5, x: 280, y: 220, clusterId: null },
  { id: 6, x: 300, y: 250, clusterId: null },
  { id: 7, x: 330, y: 210, clusterId: null },
  { id: 8, x: 270, y: 260, clusterId: null },
  { id: 9, x: 500, y: 110, clusterId: null },
  { id: 10, x: 520, y: 150, clusterId: null },
  { id: 11, x: 550, y: 90, clusterId: null },
  { id: 12, x: 480, y: 130, clusterId: null },
  { id: 13, x: 110, y: 160, clusterId: null },
  { id: 14, x: 310, y: 170, clusterId: null },
  { id: 15, x: 530, y: 180, clusterId: null }
];

export function MemoryContainer() {
  // VECTOR SIMULATOR STATE
  const [selectedQueryId, setSelectedQueryId] = useState<string>("q1");
  const activeQuery = useMemo(() => {
    return (QUERY_PRESETS.find((q) => q.id === selectedQueryId) || QUERY_PRESETS[0])!;
  }, [selectedQueryId]);

  // Compute mock similarities based on geometric distances (re-mapped to [0, 1])
  const similarities = useMemo(() => {
    return MOCK_VECTOR_NODES.map((node) => {
      const dx = node.x - activeQuery.x;
      const dy = node.y - activeQuery.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Map distance to a cosine-like similarity score
      const sim = Math.max(0.1, 1 - dist / 220);
      return {
        ...node,
        sim: Number(sim.toFixed(2)),
        isSeed: sim >= 0.4
      };
    }).sort((a, b) => b.sim - a.sim);
  }, [activeQuery]);

  // GRAPH BFS STATE
  const [bfsStep, setBfsStep] = useState<number>(0);
  const [bfsSeed, setBfsSeed] = useState<string>("M1");

  // BFS Cascade calculation
  const bfsStatus = useMemo(() => {
    // Step 0: Only seed is visited (Score = 1.0)
    // Step 1: 1-hop neighbours get score = 1.0 * edgeWeight
    // Step 2: 2-hop neighbours get score = Parent Score * edgeWeight * 0.7 (decay)
    const scores: Record<string, number> = {};
    const visitedEdges = new Set<string>();

    if (bfsStep >= 0) {
      scores[bfsSeed] = 1.0;
    }

    if (bfsStep >= 1) {
      GRAPH_EDGES.forEach((edge) => {
        if (edge.kind === "Contradicts") return; // skipped!
        
        let targetId = "";
        let sourceId = "";
        if (edge.from === bfsSeed) {
          targetId = edge.to;
          sourceId = edge.from;
        } else if (edge.to === bfsSeed) {
          targetId = edge.from;
          sourceId = edge.to;
        }

        if (targetId) {
          // Match cascade.ts: decay (0.7) is applied on EVERY hop, including
          // the first — score = parentScore * edgeWeight * decay^depth.
          const parentScore = scores[sourceId] ?? 0;
          scores[targetId] = Number((parentScore * edge.weight * 0.7).toFixed(2));
          visitedEdges.add(`${edge.from}-${edge.to}`);
        }
      });
    }

    if (bfsStep >= 2) {
      GRAPH_EDGES.forEach((edge) => {
        if (edge.kind === "Contradicts") return; // skipped!
        
        // Find links originating from any node visited in step 1 (except seed)
        const step1Nodes = Object.keys(scores).filter((id) => id !== bfsSeed);
        
        step1Nodes.forEach((parent) => {
          let childId = "";
          if (edge.from === parent && edge.to !== bfsSeed) {
            childId = edge.to;
          } else if (edge.to === parent && edge.from !== bfsSeed) {
            childId = edge.from;
          }

          if (childId) {
            // Decayed score = parent score * edge weight * 0.7
            const parentScore = scores[parent] ?? 0;
            const potentialScore = Number((parentScore * edge.weight * 0.7).toFixed(2));
            const existingScore = scores[childId];
            if (existingScore === undefined || potentialScore > existingScore) {
              scores[childId] = potentialScore;
              visitedEdges.add(`${edge.from}-${edge.to}`);
            }
          }
        });
      });
    }

    return { scores, visitedEdges };
  }, [bfsSeed, bfsStep]);

  // K-MEANS STATE
  const [kmeansStep, setKmeansStep] = useState<number>(0); // 0: unclustered, 1: choose centers, 2: assign points, 3: finalize
  const [points, setPoints] = useState<ClusterPoint[]>(INITIAL_POINTS);

  const centers = useMemo(() => {
    // Deterministic centroids
    return [
      { id: 1, x: 100, y: 90, color: "#38bdf8" }, // Tooling center
      { id: 2, x: 300, y: 220, color: "#a855f7" }, // Preferences center
      { id: 3, x: 520, y: 120, color: "#22c55e" }  // Configs center
    ];
  }, []);

  const runKmeansStep = () => {
    if (kmeansStep === 0) {
      // Step 1: select starting centers
      setKmeansStep(1);
    } else if (kmeansStep === 1) {
      // Step 2: assign points to closest center
      const nextPoints = points.map((p) => {
        let minDist = Infinity;
        let closestId = 1;
        centers.forEach((c) => {
          const dx = p.x - c.x;
          const dy = p.y - c.y;
          const d = dx * dx + dy * dy;
          if (d < minDist) {
            minDist = d;
            closestId = c.id;
          }
        });
        return { ...p, clusterId: closestId };
      });
      setPoints(nextPoints);
      setKmeansStep(2);
    } else if (kmeansStep === 2) {
      // Step 3: complete (add clusters to indices)
      setKmeansStep(3);
    }
  };

  const resetKmeans = () => {
    setPoints(INITIAL_POINTS);
    setKmeansStep(0);
  };

  // TIMELINE/COMMIT HISTORY DATA
  const COMMIT_HISTORY = [
    {
      phase: "Phase 0 — De-risk Spike",
      commit: "c6b042d",
      title: "Dependency Spike & Bun Compatibility Verification",
      desc: "Verified fastembed-js loading under standard node runtime. Mapped onnxruntime binary limitations inside bun build binaries and verified dims are determined at runtime. Created the companion specifications."
    },
    {
      phase: "Phase 1 — Semantic Retrieval",
      commit: "d45c04a",
      title: "Lazy ONNX Embedder & vector-store.ts Foundation",
      desc: "Implemented embedder.ts lazy loading to preserve startup performance. Designed packed f32 binary vector cache (`embeddings.bin`) with content-hash checking to avoid duplicate embeddings. Connected change listeners in `mem-store.ts`."
    },
    {
      phase: "Phase 2 — Graph + Cascade",
      commit: "4c35d85",
      title: "Knowledge Graph Structure & BFS Cascade",
      desc: "Designed builder.ts to extract RelatesTo edges from body [[wikilinks]] and HasTag from frontmatter metadata. Shipped BFS cascade walk traversing tag/memory relations, Decaying scores by 0.7 per hop. Excluded contradicts (weight 0)."
    },
    {
      phase: "Phase 3 — Clusters",
      commit: "ff99f06",
      title: "Deterministic K-Means Clustering",
      desc: "Added clusters.ts to periodically partition memories into semantic hubs. Pinned randomness using Mulberry32(42) generator and sorted input identifiers to prevent non-deterministic index rebuilding."
    },
    {
      phase: "Phase 4 — Async Pipeline",
      commit: "df3153d",
      title: "One-Turn-Behind & Lexical Topic Reset",
      desc: "Decoupled model turns from embedding latency by caching retrieved sets. Prefetching is computed asynchronously in background. Added Lexical token Jaccard similarity scorer to detect user topic shifts and reset stale memory sets."
    },
    {
      phase: "Phase 5 — Maintenance & Privacy",
      commit: "0132e06",
      title: "Secret Filters & CLI Management Interface",
      desc: "Added secret-filter regex blocks to prevent private SSH keys, password hashes, and environment parameters from being compiled into embeddings. Exposed `memory.graph.rebuild` and `memory.graph.stats` RPC/CLI endpoints."
    },
    {
      phase: "Hardening & Polish",
      commit: "fe56af2",
      title: "Memory Leak Disposal & Per-Session Cache",
      desc: "Implemented dispose hooks to clear daemon resources. Enhanced session safety: per-session cache prevents multiple concurrent terminals in the same project workspace from polluting each other's memory streams."
    }
  ];

  return (
    <div className={styles.container}>
      <div className={styles.intro}>
        <h2 className={styles.introTitle}>Memory Knowledge Graph</h2>
        <p className={styles.introText}>
          <strong>Before:</strong> memory retrieval ran on a blank query, so it just grabbed the
          &ldquo;first N files alphabetically&rdquo; — effectively random, and it didn&rsquo;t scale past a few dozen memories.
          <br />
          <strong>After:</strong> the Memory Knowledge Graph is a <strong>local semantic retrieval engine</strong>.
          It converts each memory into a vector, links them into a graph (tags, wikilinks, clusters), and at every turn
          fetches only the handful of facts relevant to what you&rsquo;re actually doing — plus their related neighbours.
          The result: fewer tokens, no added turn latency, and the model remembers the <em>right</em> things.
        </p>
      </div>

      <div className={styles.grid}>
        {/* CONCEPT 1: EMBEDDINGS & SIMILARITY SIMULATOR */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <Cpu className="text-primary w-5 h-5" />
            1. Vector Embeddings & Similarity
          </h3>
          <p className={styles.sectionSubtitle}>
            An <strong>embedding</strong> is a fixed-length vector (here <strong>384 numbers</strong>, from the local <code>all-MiniLM-L6-v2</code> model) representing the text&rsquo;s semantic meaning. Similar meanings point in similar directions, so relevance is a cheap <strong>dot product</strong> on L2-normalized vectors — this is what lets it match &ldquo;package manager&rdquo; to &ldquo;pnpm&rdquo; with no shared words.
          </p>

          <div className={styles.simulatorContainer}>
            <label className="text-xs text-muted-foreground font-semibold">Select User Prompt Context (Query):</label>
            <select
              value={selectedQueryId}
              onChange={(e) => setSelectedQueryId(e.target.value)}
              className={styles.querySelect}
            >
              {QUERY_PRESETS.map((q) => (
                <option key={q.id} value={q.id}>
                  &ldquo;{q.query}&rdquo;
                </option>
              ))}
            </select>

            {/* Vector space 2D projection box */}
            <svg className={styles.vectorSpaceSvg}>
              {/* Radial grids representing similarity thresholds */}
              <circle
                cx={activeQuery.x}
                cy={activeQuery.y}
                r="65"
                fill="none"
                stroke="rgba(99, 102, 241, 0.15)"
                strokeDasharray="4 4"
              />
              <circle
                cx={activeQuery.x}
                cy={activeQuery.y}
                r="135"
                fill="none"
                stroke="color-mix(in oklch, var(--foreground) 8%, transparent)"
                strokeDasharray="4 4"
              />
              <text
                x={activeQuery.x + 40}
                y={activeQuery.y - 45}
                fill="rgba(99, 102, 241, 0.5)"
                fontSize="10"
                fontFamily="monospace"
              >
                Top-k Seed Limit (&gt;=0.40)
              </text>

              {/* Connections to nodes */}
              {similarities.map((node) => (
                <line
                  key={node.id}
                  x1={activeQuery.x}
                  y1={activeQuery.y}
                  x2={node.x}
                  y2={node.y}
                  stroke={node.isSeed ? "rgba(99, 102, 241, 0.5)" : "color-mix(in oklch, var(--foreground) 10%, transparent)"}
                  strokeWidth={node.isSeed ? "1.5" : "1"}
                  strokeDasharray={node.isSeed ? "none" : "2 2"}
                />
              ))}

              {/* Memory nodes */}
              {similarities.map((node) => (
                <g key={node.id} className={styles.simItem}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.isSeed ? "9" : "7"}
                    fill={
                      node.category === "tooling"
                        ? "#6366f1"
                        : node.category === "editor"
                        ? "#a855f7"
                        : "#22c55e"
                    }
                    stroke="var(--background)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={node.x + 12}
                    y={node.y + 4}
                    fill={node.isSeed ? "var(--foreground)" : "var(--muted-foreground)"}
                    fontSize="11"
                    fontWeight={node.isSeed ? "700" : "500"}
                  >
                    Memory {node.id} ({node.sim})
                  </text>
                </g>
              ))}

              {/* Active Query node */}
              <circle
                cx={activeQuery.x}
                cy={activeQuery.y}
                r="10"
                fill="#f97316"
                stroke="var(--background)"
                strokeWidth="2"
              />
              <text
                x={activeQuery.x - 40}
                y={activeQuery.y - 15}
                fill="#f97316"
                fontSize="12"
                fontWeight="800"
              >
                Query Vector
              </text>
            </svg>

            {/* Legend info */}
            <div className={styles.legend}>
              <div className={styles.legendItem}>
                <div className={styles.legendColor} style={{ backgroundColor: "#f97316" }} />
                <span>Active Query</span>
              </div>
              <div className={styles.legendItem}>
                <div className={styles.legendColor} style={{ backgroundColor: "#6366f1" }} />
                <span>#tooling</span>
              </div>
              <div className={styles.legendItem}>
                <div className={styles.legendColor} style={{ backgroundColor: "#a855f7" }} />
                <span>#editor</span>
              </div>
              <div className={styles.legendItem}>
                <div className={styles.legendColor} style={{ backgroundColor: "#22c55e" }} />
                <span>#system</span>
              </div>
            </div>

            {/* Simulated memory list with similarity scores */}
            <div className={styles.cardGrid}>
              {similarities.slice(0, 3).map((node) => (
                <div
                  key={node.id}
                  className={`${styles.scoreCard} ${node.isSeed ? styles.activeHit : ""}`}
                >
                  <div className={styles.cardHeader}>
                    <span>Memory {node.id}</span>
                    <span className={node.isSeed ? styles.scoreVal : styles.scoreValMuted}>
                      {node.sim >= 0.4 ? "Seed Match" : "No Match"}
                    </span>
                  </div>
                  <span className={styles.cardTitle}>{node.text}</span>
                  <span className={styles.cardText}>
                    Cosine Sim: <strong>{node.sim}</strong>. Passed the initial threshold filter.
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CONCEPT 2: KNOWLEDGE GRAPH & CASCADE RETRIEVAL */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <Network className="text-primary w-5 h-5" />
            2. Knowledge Graph & Cascade (BFS)
          </h3>
          <p className={styles.sectionSubtitle}>
            Instead of querying vectors alone, FreeCode embeds nodes in an <strong>associative graph</strong>.
            <strong> Cascade Retrieval</strong> runs a 2-hop BFS starting at top-k vector seeds, applying a <strong>0.7 decay factor</strong> on every hop.
            <br />
            <em>Tag and Cluster nodes are traversed as relay hubs to connect memories — but only <strong>Memory</strong> nodes are ranked into the final injected set.</em>
          </p>

          <div className={styles.graphContainer}>
            <div className={styles.controlsRow}>
              <div className="flex gap-2">
                <button
                  onClick={() => setBfsStep(Math.max(0, bfsStep - 1))}
                  disabled={bfsStep === 0}
                  className={styles.btnSecondary}
                >
                  Back Step
                </button>
                <button
                  onClick={() => setBfsStep(Math.min(2, bfsStep + 1))}
                  disabled={bfsStep === 2}
                  className={styles.btnPrimary}
                >
                  <Play className="w-4 h-4 fill-current" />
                  Next Step ({bfsStep}/2)
                </button>
              </div>
              <button
                onClick={() => {
                  setBfsStep(0);
                  setBfsSeed(bfsSeed === "M1" ? "M3" : "M1");
                }}
                className={styles.btnSecondary}
              >
                Switch Seed ({bfsSeed === "M1" ? "M3" : "M1"})
              </button>
            </div>

            {/* BFS Explainer text */}
            <div className={styles.simExplanation}>
              {bfsStep === 0 && (
                <span>
                  <strong>Step 0: Seed Selection.</strong> The vector engine matched <strong>Memory {bfsSeed}</strong>. Starting node weight is <strong>1.0</strong>.
                </span>
              )}
              {bfsStep === 1 && (
                <span>
                  <strong>Step 1: First Hop.</strong> Traversed from the seed along its edges:
                  Tag relationships (<code>HasTag</code> w=0.8), semantic clustering (<code>InCluster</code> w=0.6) or manual links (<code>RelatesTo</code> w=0.7).
                  Score = <code>1.0 &times; Edge Weight &times; 0.7</code> — the 0.7 decay applies from the very first hop.
                  Note: <strong>the M1 &harr; M3 Contradiction edge is skipped (weight 0)</strong>.
                </span>
              )}
              {bfsStep === 2 && (
                <span>
                  <strong>Step 2: Second Hop (Compounding Decay).</strong> Traversed outward from Step 1 nodes.
                  Score = <code>Parent Score &times; Edge Weight &times; 0.7</code>, so a 2-hop memory carries <code>0.7&sup2;</code> of the decay. When two paths reach the same node, the <strong>higher</strong> score wins.
                </span>
              )}
            </div>

            {/* Graph Visual rendering */}
            <svg className={styles.graphSvg} viewBox="0 0 800 450">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
                </marker>
                <marker id="arrow-contradict" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
              </defs>

              {/* Edge Connections */}
              {GRAPH_EDGES.map((edge, i) => {
                const fromNode = GRAPH_NODES.find((n) => n.id === edge.from);
                const toNode = GRAPH_NODES.find((n) => n.id === edge.to);
                if (!fromNode || !toNode) return null;

                const isVisited = bfsStatus.visitedEdges.has(`${edge.from}-${edge.to}`) || bfsStatus.visitedEdges.has(`${edge.to}-${edge.from}`);
                const isContradiction = edge.kind === "Contradicts";

                return (
                  <g key={i}>
                    <line
                      x1={fromNode.x}
                      y1={fromNode.y}
                      x2={toNode.x}
                      y2={toNode.y}
                      stroke={
                        isContradiction
                          ? "#ef4444"
                          : isVisited
                          ? "#38bdf8"
                          : "color-mix(in oklch, var(--foreground) 8%, transparent)"
                      }
                      strokeWidth={isVisited ? "2.5" : "1.5"}
                      strokeDasharray={edge.kind === "InCluster" ? "4 4" : "none"}
                      markerEnd={isContradiction ? "url(#arrow-contradict)" : isVisited ? "url(#arrow)" : "none"}
                    />
                    {/* Weight badge near the center of line */}
                    {isVisited && (
                      <text
                        x={(fromNode.x + toNode.x) / 2}
                        y={(fromNode.y + toNode.y) / 2 - 6}
                        fill="#38bdf8"
                        fontSize="10"
                        fontFamily="monospace"
                        textAnchor="middle"
                      >
                        w:{edge.weight}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {GRAPH_NODES.map((node) => {
                const nodeScore = bfsStatus.scores[node.id];
                const isActive = nodeScore !== undefined;

                return (
                  <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                    <circle
                      r={node.type === "memory" ? "20" : "16"}
                      fill={
                        node.type === "memory"
                          ? isActive
                            ? "#3b82f6"
                            : "rgba(59, 130, 246, 0.15)"
                          : node.type === "tag"
                          ? isActive
                            ? "#10b981"
                            : "rgba(16, 185, 129, 0.15)"
                          : isActive
                          ? "#eab308"
                          : "rgba(234, 179, 8, 0.15)"
                      }
                      stroke={isActive ? "var(--foreground)" : "color-mix(in oklch, var(--foreground) 15%, transparent)"}
                      strokeWidth={isActive ? "2" : "1"}
                    />
                    <text
                      y="4"
                      fill={isActive ? "#fff" : "var(--foreground)"}
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {node.id}
                    </text>
                    <text
                      y={node.type === "memory" ? "32" : "28"}
                      fill={isActive ? "var(--foreground)" : "var(--muted-foreground)"}
                      fontSize="11"
                      textAnchor="middle"
                    >
                      {node.label}
                    </text>
                    {isActive && (
                      <g transform="translate(14, -14)">
                        <circle r="9" fill="#38bdf8" stroke="#000" strokeWidth="1" />
                        <text
                          y="3"
                          fill="#000"
                          fontSize="9"
                          fontFamily="monospace"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {nodeScore}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* CONCEPT 3: DETERMINISTIC CLUSTERING */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <Layers className="text-primary w-5 h-5" />
            3. Deterministic Clustering (K-Means)
          </h3>
          <p className={styles.sectionSubtitle}>
            Unlinked memories are grouped dynamically based on semantic similarity. To ensure that deleting the index sidecar gives identical edges upon rebuild, we use <strong>deterministic K-Means</strong> (fixed seed `mulberry32(42)` + sorted inputs).
          </p>

          <div className={styles.clusterContainer}>
            <div className="flex gap-2">
              <button onClick={runKmeansStep} className={styles.btnPrimary}>
                {kmeansStep === 0 ? "1. Select Centroids" : kmeansStep === 1 ? "2. Group Points" : "Clustered!"}
              </button>
              <button onClick={resetKmeans} className={styles.btnSecondary}>
                Reset
              </button>
            </div>

            <svg className={styles.vectorSpaceSvg} viewBox="0 0 650 300">
              {/* Centroid indicators */}
              {kmeansStep >= 1 && centers.map((c) => (
                <circle
                  key={c.id}
                  cx={c.x}
                  cy={c.y}
                  r={kmeansStep >= 2 ? "55" : "15"}
                  fill="none"
                  stroke={c.color}
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  style={{ transition: "all 0.5s ease" }}
                />
              ))}

              {/* Data points */}
              {points.map((p) => {
                let color = "var(--muted-foreground)";
                if (kmeansStep >= 2 && p.clusterId) {
                  const centerNode = centers.find((c) => c.id === p.clusterId);
                  color = centerNode ? centerNode.color : color;
                }
                return (
                  <circle
                    key={p.id}
                    cx={p.x}
                    cy={p.y}
                    r="5"
                    fill={color}
                    style={{ transition: "fill 0.5s ease" }}
                  />
                );
              })}

              {/* Labels */}
              <text x="30" y="270" fill="var(--muted-foreground)" fontSize="11" fontFamily="monospace">
                Step: {kmeansStep === 0 ? "Raw Memory Vectors" : kmeansStep === 1 ? "Initialize Centroids (Fixed Seed)" : "Partition Complete"}
              </text>
            </svg>
          </div>
        </div>

        {/* CONCEPT 4: ARCHITECTURAL INTEGRATION */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <Database className="text-primary w-5 h-5" />
            4. Integration & Performance
          </h3>
          <p className={styles.sectionSubtitle}>
            A senior developer priority: local neural net execution must never add latency to user interactions.
          </p>

          <div className={styles.simulatorContainer} style={{ padding: "0" }}>
            <table className={styles.infoTable}>
              <thead>
                <tr>
                  <th>Mechanism</th>
                  <th>Design Pattern</th>
                  <th>Key Detail</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>One-Turn-Behind</strong></td>
                  <td>Retrieval Caching</td>
                  <td>Retrieved memories are fetched asynchronously during turn N-1's background cycle, making turn N injection instantaneous (0ms block).</td>
                </tr>
                <tr>
                  <td><strong>Fire-and-Forget</strong></td>
                  <td>Write pipeline</td>
                  <td>Saving memory triggers a background <code>onChange</code> event. It does not await the ONNX model, guaranteeing immediate user-loop return.</td>
                </tr>
                <tr>
                  <td><strong>Graceful Degradation</strong></td>
                  <td>Fail-safe fallback</td>
                  <td>If ONNX runtime fails (e.g. inside compiled binaries), retrieval seamlessly degrades to a keyword search + graph walk. The agent never crashes.</td>
                </tr>
                <tr>
                  <td><strong>Secret Filtering</strong></td>
                  <td>Privacy guard</td>
                  <td>Regex filters scan memory text before embedding, blocking SSH keys, tokens, or <code>.env</code> secrets from ever entering the local vector index. Everything stays on-device — nothing leaves your machine.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ARCHITECTURE — HOW THE PIECES FIT */}
        <div className={`${styles.section} ${styles.gridFullWidth}`}>
          <h3 className={styles.sectionTitle}>
            <Network className="text-primary w-5 h-5" />
            How the Pieces Fit
          </h3>
          <p className={styles.sectionSubtitle}>
            Everything lives in <code>apps/core/src/memory/graph/</code>. The markdown files stay the
            source of truth; the vectors + graph are a <strong>derived sidecar</strong> you can delete and
            rebuild at any time. One turn flows left to right:
          </p>

          <svg className={styles.archSvg} viewBox="0 0 760 320">
            <defs>
              <marker id="archArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
              </marker>
            </defs>

            {(() => {
              // Each box: [x, y, w, h, primary-tinted?]
              const box = (
                x: number, y: number, w: number, h: number,
                title: string, sub: string, accent = false
              ) => (
                <g>
                  <rect
                    x={x} y={y} width={w} height={h} rx="8"
                    fill={accent
                      ? "color-mix(in oklch, var(--primary) 10%, transparent)"
                      : "color-mix(in oklch, var(--foreground) 4%, transparent)"}
                    stroke={accent
                      ? "color-mix(in oklch, var(--primary) 35%, transparent)"
                      : "color-mix(in oklch, var(--foreground) 12%, transparent)"}
                    strokeWidth="1"
                  />
                  <text x={x + w / 2} y={y + (sub ? 20 : h / 2 + 4)} textAnchor="middle"
                    fill="var(--foreground)" fontSize="12" fontWeight="600" fontFamily="var(--font-mono)">
                    {title}
                  </text>
                  {sub && (
                    <text x={x + w / 2} y={y + 36} textAnchor="middle"
                      fill="var(--muted-foreground)" fontSize="10">
                      {sub}
                    </text>
                  )}
                </g>
              );
              const line = (x1: number, y1: number, x2: number, y2: number, arrow = true) => (
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="var(--muted-foreground)" strokeWidth="1.2"
                  markerEnd={arrow ? "url(#archArrow)" : undefined} />
              );
              return (
                <>
                  {/* Top: loop → service */}
                  {box(30, 20, 150, 46, "agent/loop.ts", "one turn")}
                  {box(280, 20, 220, 46, "MemoryGraphService", "prepareMemories()", true)}
                  {line(180, 43, 278, 43)}

                  {/* Service fans out to the three stores */}
                  {line(390, 66, 390, 96, false)}
                  {line(105, 96, 390, 96, false)}
                  {line(660, 96, 390, 96, false)}
                  {line(105, 96, 105, 118)}
                  {line(390, 96, 390, 118)}
                  {line(660, 96, 660, 118)}

                  {box(30, 120, 150, 50, "embedder.ts", "text → 384-dim vec")}
                  {box(300, 120, 180, 50, "vector-store.ts", "cosine top-k seeds")}
                  {box(585, 120, 150, 50, "graph-store.ts", "graph.json")}

                  {/* cascade fed by vector seeds + graph edges */}
                  {box(300, 210, 180, 46, "cascade.ts", "BFS · 0.7 decay", true)}
                  {line(390, 170, 390, 210)}
                  {line(660, 170, 481, 233)}

                  {/* builder + clusters build the graph */}
                  {box(560, 210, 175, 46, "builder.ts / clusters.ts", "files → edges")}
                  {line(647, 210, 660, 172)}

                  {/* secret-filter gates the embedder */}
                  {box(30, 210, 150, 46, "secret-filter.ts", "never embed secrets")}
                  {line(105, 210, 105, 172)}
                </>
              );
            })()}

            {/* Source-of-truth vs derived-sidecar footer */}
            <text x="30" y="296" fill="var(--muted-foreground)" fontSize="11" fontFamily="var(--font-mono)">
              Source of truth: memory/&lt;type&gt;/*.md
            </text>
            <text x="420" y="296" fill="var(--muted-foreground)" fontSize="11" fontFamily="var(--font-mono)">
              Derived sidecar: memory/.graph/  (rebuildable)
            </text>
          </svg>

          <div className={styles.fileGrid}>
            {[
              { f: "embedder.ts", d: "Lazy ONNX singleton — turns text into a 384-dim vector. Loads the model on first use; on failure flips to unavailable so callers fall back to keyword search." },
              { f: "vector-store.ts", d: "Packed float32 vectors + meta sidecar. Cosine top-k for seeds; a content-hash cache skips re-embedding unchanged memories; atomic writes + checksum guard against torn files." },
              { f: "builder.ts", d: "Derives graph edges from the files, no model needed: [[wikilinks]] → RelatesTo, tags → HasTag, supersedes → Supersedes. Fully deterministic." },
              { f: "graph-store.ts", d: "Map-based adjacency (graph.json). Edges are traversed undirected, so a neighbour surfaces its linker too." },
              { f: "cascade.ts", d: "BFS from the seeds, 2 hops, 0.7 decay per hop. Skips Contradicts; only Memory nodes are ranked, tags/clusters just relay." },
              { f: "clusters.ts", d: "Deterministic k-means (fixed seed + sorted input) → InCluster edges, so semantically-similar memories relay even without an explicit link." },
              { f: "secret-filter.ts", d: "Runs before every embed — API keys, private keys and .env secrets never enter the vector index." },
              { f: "index.ts", d: "MemoryGraphService facade — the only thing the agent loop / IPC calls. Owns the per-session one-turn-behind cache, single-flight write queue and LRU eviction." }
            ].map(({ f, d }) => (
              <div key={f} className={styles.fileCard}>
                <code>{f}</code>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FEATURE HISTORY TIMELINE */}
        <div className={`${styles.section} ${styles.gridFullWidth}`}>
          <h3 className={styles.sectionTitle}>
            <GitBranch className="text-primary w-5 h-5" />
            Development Timeline (Phases & Commit History)
          </h3>
          <p className={styles.sectionSubtitle}>
            A breakdown of the last 10 commits showcasing how the Memory Graph feature was incrementally built, tested, and hardened.
          </p>

          <div className={styles.timeline}>
            {COMMIT_HISTORY.map((item, idx) => (
              <div key={idx} className={styles.timelineItem}>
                <div className={styles.timelineDot} />
                <div className={styles.timelineHeader}>
                  <span className={styles.timelinePhase}>{item.phase}</span>
                  <span className={styles.timelineCommit}>commit {item.commit}</span>
                </div>
                <h4 className={styles.timelineTitle}>{item.title}</h4>
                <p className={styles.timelineDesc}>{item.desc}</p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
