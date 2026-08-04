# Memory Knowledge Graph Explorer — Design Spec

**Date:** 2026-08-04
**Status:** Draft
**Extends:** `2026-07-26-memory-knowledge-graph.md` (the graph itself — this
spec adds a UI on top, no changes to retrieval/build/cluster logic)
**Touches:** `apps/core/src/graph-explorer/` (new), `apps/core/src/server.ts`,
`apps/core/src/cli/commands/memory/`, `apps/core/src/cli/commands/web.ts`,
`packages/shared/src/ipc/protocol.ts`, `apps/tui/src/commands/built-in.ts`,
`.github/workflows/release.yml`

---

## Goal

The memory knowledge graph (tags, wikilinks, clusters, cascade retrieval) is
implemented and works, but it's invisible — the only way to see it today is
`freecode memory graph stats` (four numbers) or reading raw `graph.json`. This
is explicitly an **educational** feature: let a user type `/graph`, get a
local browser page showing their project's actual memory graph as a
node-link diagram, type a prompt into a search box, and watch the *real*
retrieval pipeline (seed match → cascade BFS → decayed scores) highlight
which memories it would surface and why.

**Non-goals:** editing memories from the UI, cross-project graphs, live
push updates while the page is open (a manual refresh is enough), and any
change to the graph/retrieval logic itself — this is a read-only viewer over
the existing `MemoryGraphService`.

## Distribution: optional addon, not baked into the binary

The core design constraint: **users who don't want this shouldn't pay for it
in binary size.** The graph UI's static assets — `index.html`, `graph.js`,
`graph.css`, and a vendored `d3.min.js` (D3's prebuilt browser bundle,
providing `d3-force`/`d3-zoom`/`d3-drag` — chosen over hand-rolled canvas
physics per explicit request, and vendored as a static file rather than a new
npm dependency so it needs no bundler) — live in the repo under
`apps/core/src/graph-explorer/page/`, but `scripts/build-bun.mjs` never
touches them and they are never embedded in the compiled `freecode` binary.

Instead:

- `.github/workflows/release.yml` tars `apps/core/src/graph-explorer/page/`
  into `graph-ui.tar.gz` and attaches it to the same GitHub release as the
  platform binaries (same mechanism as the platform archives added for the
  onnxruntime fix — one more asset on the same release).
- `freecode memory ui-install` downloads `graph-ui.tar.gz` matching the
  running `freecode --version`, extracts it to `~/.freecode/addons/graph-ui/`.
- `freecode memory ui-uninstall` does `rm -rf ~/.freecode/addons/graph-ui/`.
  Fully reversible, no other state anywhere references this directory.
- The server checks for `~/.freecode/addons/graph-ui/index.html` **at request
  time**, not at startup — so no restart is needed after installing.

## Architecture

```
/graph (TUI)
   │  IPC: graph.explore
   ▼
apps/core/src/server.ts
   │  delegates to
   ▼
apps/core/src/graph-explorer/server.ts
   │  1. checks ~/.freecode/addons/graph-ui/ exists (else: "run ui-install")
   │  2. starts (or reuses) a small http server on 127.0.0.1:4097
   │  3. opens the browser
   ▼
http://127.0.0.1:4097/
   │  GET /              → ~/.freecode/addons/graph-ui/index.html (static)
   │  GET /graph.js, /graph.css, /d3.min.js → same dir, static
   │  GET /api/graph      → MemoryGraphService graph dump (JSON)
   │  GET /api/search?q=  → MemoryGraphService.retrieve(q) (JSON)
```

The API endpoints (`/api/graph`, `/api/search`) are plain Node `http`
handlers in core — they exist and are testable regardless of whether the UI
addon is installed; only the static-file serving depends on it.

## Components

- **`graph-explorer/server.ts`** — the HTTP server. Plain `http`, no
  Express, matching `web-server.ts`'s existing style. Module-level singleton
  per port so a second `/graph` call in the same session reuses the running
  server instead of erroring on `EADDRINUSE`.
- **`graph-explorer/api.ts`** — the two handlers, unit-testable in isolation
  against a `MemoryGraphService` fixture:
  - `GET /api/graph` → `{ nodes, edges, clusters, embedderAvailable }`
  - `GET /api/search?q=...` → the existing `retrieve()` result (memory ids +
    scores), reusing `graph/cascade.ts` and `graph/index.ts`'s scoring
    verbatim — **no change to what gets retrieved or how it's scored.**
    `cascadeRetrieve()` today only returns `{id, score}` per result, not the
    path taken to reach it, so showing *which edge* carried each hop's score
    (the highlight the UI needs) requires one small additive change: each
    `Frontier` entry also records `via: { from, edgeKind } | null` (`null`
    for seeds), and that's threaded into the returned `RetrievalResult`. This
    only adds a field to what's returned — the BFS order, decay, and final
    scores are byte-for-byte unchanged, so this can't alter live retrieval
    behavior, only what the debug/UI endpoint exposes.
- **`graph-explorer/page/`** (the addon payload) — `index.html`, `graph.css`,
  `graph.js`, vendored `d3.min.js`. `graph.js` fetches `/api/graph` on load,
  lays out nodes with `d3-force`, colors by `kind` (Memory / Tag / Cluster),
  styles edges by `kind` (HasTag / RelatesTo / Supersedes / InCluster), and
  supports pan/zoom/drag via `d3-zoom`/`d3-drag`. The search box debounces
  input, calls `/api/search`, then dims non-matching nodes and highlights the
  walked path with each hop's decayed score labeled on the edge — this is the
  actual teaching surface of the feature.
- **`cli/commands/memory/ui.ts`** (new) — `ui-install` / `ui-uninstall`
  yargs subcommands under `freecode memory`, alongside the existing
  `graph rebuild` / `graph stats`.
- **`server.ts`** — registers `graph.explore` as a new IPC method (added to
  `packages/shared/src/ipc/protocol.ts`'s `METHODS`), delegating to
  `graph-explorer/server.ts`. Returns `{ url }` on success, or
  `{ error: "not-installed" }` if the addon isn't present.
- **`apps/tui/src/commands/built-in.ts`** — new `graphCommand`. Calls the IPC
  method, shows the returned URL or the "run ui-install" message. Non-blocking
  — unlike `/usage`'s alt-screen takeover, this doesn't touch the terminal at
  all; the browser is a separate window and the TUI keeps working normally.
- **`cli/commands/web.ts`** — its `openBrowser()` helper is promoted to a
  shared util (e.g. `utils/open-browser.ts`) so `graph-explorer/server.ts`
  reuses it instead of duplicating the platform-detection `exec` call.

## Data flow

1. User runs `freecode memory ui-install` once (downloads ~100KB).
2. User types `/graph` in the TUI.
3. TUI calls `graph.explore` over IPC.
4. Core checks the addon dir, starts the server if not already running for
   this session, opens the browser via `openBrowser()`, returns the URL.
5. TUI shows `Graph explorer running at http://127.0.0.1:4097/`.
6. Browser loads the static page, fetches `/api/graph`, renders.
7. User types a query in the search box → debounced fetch to
   `/api/search?q=...` → highlight.

## Error handling

- **Addon not installed** → `/graph` shows the install instructions instead
  of starting a server at all.
- **Empty graph** (no memories yet) → the page renders with a
  "no memories found — nothing to show" empty state instead of a blank
  canvas, matching the CLI's existing `stats` behavior for an empty project.
- **Port already bound by something else** (not our own prior instance) →
  the server falls back to the next port (4098, 4099, ...) and reports the
  actual URL used, rather than crashing the whole `/graph` call.
- **Embedder unavailable** (keyword fallback, per the existing D6 design) →
  search still works via the keyword path; the API response includes which
  mode was used (`"seedMode": "vector" | "keyword"`) and the UI shows a small
  badge — this is itself educational, not an error state.

## Testing

- `node:test` for `graph-explorer/api.ts`'s two handlers against a
  `MemoryGraphService` fixture with known nodes/edges/tags — assert JSON
  shape and values, not rendering.
- `node:test` for the addon-presence check (installed vs not) and the
  port-fallback logic.
- No automated test for the D3 rendering itself, matching the project's
  existing convention of not testing UI rendering — verified manually
  instead: start the server, confirm the browser opens, confirm a real
  search highlights the correct path against a real project's memories.
- `ui-install`/`ui-uninstall` verified manually against a real (or
  locally-served, for dev) release asset — download, extract, confirm
  `/graph` picks it up without a restart; uninstall, confirm `/graph` reports
  "not installed" again.
