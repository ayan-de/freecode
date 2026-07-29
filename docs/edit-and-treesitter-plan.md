# Edit Tool + Tree-sitter Repo Map — Implementation Plan

Status: planning only, not implemented. Written 2026-07-29.

## 1. Edit tool — current state (no work needed)

`apps/core/src/tools/edit.ts` already implements the anchor-text
SEARCH/REPLACE pattern (`oldString`/`newString`, no line numbers), with a
9-strategy fuzzy fallback chain (`simpleReplacer` → `lineTrimmedReplacer` →
`blockAnchorReplacer` → ... → `contextAwareReplacer`) plus Levenshtein
similarity scoring for near-miss blocks. This already matches/exceeds Claude
Code's edit tool and aider's SEARCH/REPLACE format. **No changes planned
here** — noting it so the tree-sitter plan below doesn't duplicate it.

Gap actually worth closing: there is no repo-wide map. `context/tree-cache.ts`
only lists top-level directory entries (📁/📄), not symbols. A model editing
an unfamiliar file has to `read` it in full or `grep` blindly — this is the
piece aider's tree-sitter repo map solves and freecode doesn't have yet.

## 2. Goal

Give the agent a compact, always-available map of the project's symbols
(function/class/interface signatures per file) so it can locate relevant code
without reading full files, cutting input tokens on large repos — the same
role aider's `repomap.py` plays.

## 3. Proposed placement

New module: `apps/core/src/context/repo-map.ts`, wired into
`context/compiler.ts` as an additional `SystemBlock` (same pattern as
`instructions.ts`), cached/invalidated the same way `tree-cache.ts` already
does (git HEAD + TTL + invalidate-on-destructive-tool).

## 4. Dependencies

- `web-tree-sitter` (WASM build — no native compilation step, works across
  platforms without prebuilt binaries) or `tree-sitter` + per-language
  `tree-sitter-<lang>` npm packages (native, faster, needs build toolchain).
  Recommendation: start with `web-tree-sitter` for zero-install-friction;
  revisit native bindings only if parse latency becomes a measured problem.
- Per-language grammars needed at minimum: TypeScript/TSX, JavaScript,
  Python, Go, Rust (matches freecode's own stack: `apps/*`, `tui-rs`).

## 5. Algorithm (mirrors aider's repomap.py approach)

1. Walk project files (respect `.gitignore`, existing ignore-pattern logic in
   `tree-cache.ts`).
2. Parse each file with the matching tree-sitter grammar.
3. Extract top-level definitions only: function/method signatures, class
   names, exported consts/types/interfaces — via tree-sitter **tag queries**
   (`.scm` query files, one per language, defining which node types count as
   "definitions" vs "references"). Aider ships these under
   `aider/queries/*.scm`; can vendor/adapt equivalents.
4. Rank files by relevance if map exceeds token budget — simplest starting
   heuristic: recently-edited files (via git) and files referenced in the
   current conversation get priority; skip aider's PageRank-based ranking
   initially (ponytail: overkill until map size is actually a problem).
5. Render as compact text: `path/to/file.ts: functionName(args), ClassName`.
6. Truncate to a configurable token budget (e.g. 1-2k tokens) before
   inserting as a `SystemBlock`.

## 6. Incremental updates

Reuse the existing invalidation hook pattern from `tree-cache.ts`
(invalidate per-file entry after any `isDestructive` tool completes on that
file, not the whole map) — avoids re-parsing the entire repo on every edit.

## 7. Out of scope for v1

- Cross-file reference graph / PageRank ranking (aider has this; adds real
  complexity for marginal gain until the flat map proves insufficient).
- Editing via tree-sitter (i.e. AST-based structural edits instead of
  text-anchor edits) — the current `edit.ts` approach is good; don't conflate
  "map for context" with "edit strategy," they're separate concerns.

## 8. Rough task breakdown (for later execution)

1. Add `web-tree-sitter` + grammar packages, load WASM grammars lazily per
   language on first use.
2. Write/vendor tag-query `.scm` files per supported language.
3. `repo-map.ts`: walk + parse + extract signatures + render text block.
4. Wire into `compiler.ts` as a new `SystemBlock`, gated by a token budget.
5. Cache + invalidate per-file, following `tree-cache.ts`'s existing pattern.
6. One test file (`repo-map.test.ts`) with a small fixture project verifying
   signatures extracted match expected output for each supported language.
