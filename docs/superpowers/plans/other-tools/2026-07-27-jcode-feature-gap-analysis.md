# jcode Feature Gap Analysis

> Analysis of features to adopt from jcode (1jehuang/jcode) into FreeCode

## Overview

jcode is a Rust-based AI coding harness known for:
- **Best-in-class RAM efficiency** (27.8MB vs 386.6MB for Claude Code)
- **14ms time to first frame** (vs 3.4s for Claude Code)
- **Swarm/multi-agent collaboration**
- **Advanced semantic memory system**
- **11+ provider types**

---

## Features to Adopt

### 1. Swarm/Multi-Agent Collaboration ⭐⭐⭐⭐⭐

**Impact:** High | **Effort:** High | **Priority:** Phase 2

jcode's standout feature. Multiple agents can work in the same repo with:

- **Automatic conflict detection** — when agent A edits a file agent B has read, B gets notified
- **Agent messaging** — DM specific agents or broadcast to all
- **Autonomous swarm spawning** — agents can spawn teammates for parallel work
- **Hierarchical orchestration** — main agent becomes coordinator, spawned agents become workers

**Current FreeCode state:** Basic subagents exist in `agent/subagent.ts`

**Implementation approach:**
```
┌─────────────────────────────────────────────────────────────┐
│                      Swarm Manager                           │
├─────────────────────────────────────────────────────────────┤
│  Agent A (primary)                                          │
│    ├── spawns Agent B, C for parallel work                 │
│    ├── receives conflict notifications                     │
│    └── coordinates via message bus                          │
│                                                             │
│  Agent B (worker) ──▶ Agent C (worker)                    │
│    │                                                        │
│    └── file change ──▶ conflict check ──▶ notify A       │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. Semantic Memory System ⭐⭐⭐⭐⭐

**Impact:** High | **Effort:** Medium | **Priority:** Phase 1

jcode's memory is much more advanced than FreeCode's current basic memory:

- **Embeds every turn as a semantic vector** using local embeddings
- **Graph-based retrieval** with cosine similarity
- **Memory sideagent** that verifies relevance before injecting
- **Automatic consolidation** via ambient mode (checks staleness, conflicts)
- **Session search** for traditional RAG on previous sessions

**Current FreeCode state:**
- Basic memory in `memory/mem-store.ts`, `memory/mem-query.ts`
- Memory graph partially implemented in `memory/graph/`

**Implementation approach:**
```typescript
// Enhanced memory flow
1. Every turn → embed → store in vector DB
2. Query memory → cosine similarity search → top-k results
3. Memory sideagent → verify relevance → inject into context
4. Ambient mode → periodic consolidation, conflict detection
```

**Files to enhance:**
- `memory/mem-store.ts` — add embedding generation
- `memory/mem-query.ts` — add semantic search
- `memory/graph/` — extend with auto-consolidation
- Add `memory/ambient.ts` — background consolidation

---

### 3. Provider Diversity (Ollama/LM Studio) ⭐⭐⭐⭐

**Impact:** Medium | **Effort:** Low | **Priority:** Phase 1

jcode supports **11+ provider types**:
- Claude, OpenAI, Gemini, GitHub Copilot
- Azure OpenAI, Fireworks, MiniMax
- **Ollama, LM Studio** (local models)
- OpenAI-compatible endpoints

**Current FreeCode state:** 4 providers (Anthropic, OpenAI, Gemini, MiniMax)

**Implementation:**
```typescript
// apps/core/src/providers/ollama.ts (new)
interface OllamaProvider {
  listModels(): Promise<string[]>;
  generate(prompt: string, model: string): Promise<string>;
  embed(text: string): Promise<number[]>;
}
```

**Quick win:** Add Ollama provider using existing provider abstraction pattern.

---

### 4. Ambient Mode ⭐⭐⭐⭐

**Impact:** Medium | **Effort:** Medium | **Priority:** Phase 2

Background process that runs alongside main agent:
- **Periodic memory consolidation** — reorganizes, checks staleness
- **Conflict detection** — identifies conflicting memories
- **Non-blocking** — does work without interrupting the agent

**Implementation approach:**
```typescript
// Ambient mode runs in background
setInterval(async () => {
  await consolidateMemories();  // reorganize, dedupe
  await detectConflicts();       // find conflicting info
  await checkStaleness();       // remove old entries
}, INTERVAL);
```

---

### 5. Side Panel UI ⭐⭐⭐⭐

**Impact:** Medium | **Effort:** High | **Priority:** Phase 3

jcode's side panel features:
- Real-time file viewing
- Diff viewer
- Mermaid diagram rendering (inline)
- Info widgets (negative-space only)

**Current FreeCode state:** TUI exists, no side panel

**Implementation:** Add side panel component to TUI (requires significant work)

---

### 6. Performance Optimization ⭐⭐⭐⭐

**Impact:** High | **Effort:** High | **Ongoing**

jcode's benchmarks:
- **14ms time to first frame**
- **~10MB per extra session**
- Built in Rust for efficiency

**Current FreeCode state:** Node.js/Bun based

**Options:**
1. Optimize existing TypeScript code
2. Add Rust components for hot paths
3. Consider Rust TUI (existing `apps/tui-rs`)

---

## Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Ollama/LM Studio Support | Medium | Low | **Phase 1** |
| Semantic Memory Graph | High | Medium | **Phase 1** |
| Ambient Mode | Medium | Medium | Phase 2 |
| Swarm Collaboration | High | High | Phase 2 |
| Side Panel UI | Medium | High | Phase 3 |
| Performance Tuning | High | High | Ongoing |

---

## Competitive Comparison

| Feature | FreeCode | jcode | Gap |
|---------|----------|-------|-----|
| Local models (Ollama) | ❌ | ✅ | High |
| Semantic memory | Partial | ✅ | Medium |
| Swarm collaboration | ❌ | ✅ | High |
| MCP support | Partial | ✅ | Low |
| TUI | ✅ | ✅ | — |
| Provider count | 4 | 11+ | Medium |
| RAM efficiency | Unknown | Best | High |
| Time to first frame | Unknown | 14ms | High |

---

## Implementation Notes

### Quick Wins (1-2 days)

1. **Add Ollama provider** — follows existing pattern in `providers/`
2. **Enhance memory with embeddings** — extend existing `memory/graph/`

### Medium Effort (1-2 weeks)

3. **Memory sideagent** — create verification layer
4. **Ambient mode** — background consolidation service

### High Effort (1+ month)

5. **Swarm collaboration** — requires significant architecture changes
6. **Side panel UI** — major TUI redesign

---

## Reference

- jcode repo: https://github.com/1jehuang/jcode
- jcode benchmarks: https://jcode.sh/bench
- jcode memory system: Semantic embedding + graph retrieval

---

*Document generated: 2026-07-27*
*Analysis based on jcode README and codebase*
