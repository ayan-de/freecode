# Pi → FreeCode: Feature Gap Analysis

> **Date:** 2026-07-18
> **Source:** `~/Projects/githubProjects/pi` — Pi agent harness by Mario Zechner / Earendil (TypeScript monorepo, MIT)
> **Status:** Analysis / roadmap candidates — nothing here is committed work.
> **Companion docs:** grok-build, jcode, opencode, and claude-code gap analyses (same date).
> **Note:** FreeCode's TUI is already built on `pi-tui` — this project is upstream of ours.

Pi is the philosophical opposite of the others studied: deliberately
**minimal** (no permission system at all — containerize instead), radically
**self-extensible** (the agent writes its own extensions), and built as
**clean layered libraries** (`pi-ai` → `pi-agent-core` → `pi-coding-agent`)
rather than a monolithic product. Its best ideas are structural: session
*trees*, hot-reloadable in-process extensions with custom UI, serverless
session sharing, and adherence to cross-harness standards.

---

## Quick Reference

| # | Feature | Pi source | Effort | Value |
|---|---------|-----------|--------|-------|
| 1 | Session trees + branch summarization | `docs/sessions.md`, `docs/compaction.md` | Medium | High |
| 2 | Extensions: hot-reload, custom UI, custom rendering | `docs/extensions.md` | Medium | High |
| 3 | Self-extensibility as a product loop | docs headers, examples | Low | High |
| 4 | Serverless sharing: HTML export + gist `/share` | `docs/sessions.md` | Low | Medium–High |
| 5 | Agent Skills standard + shared skill dirs | `docs/skills.md`, agentskills.io | Low | Medium–High |
| 6 | Pi packages (npm/git bundles of resources) | `docs/packages.md` | Medium | Medium |
| 7 | pi-ai library design details | `packages/ai/README.md` | Medium | Medium |
| 8 | Prompt templates with argument hints | `docs/prompt-templates.md` | Low | Medium |
| 9 | Compaction mechanics (reserve tokens, file tracking) | `docs/compaction.md` | Low–Medium | Medium |
| 10 | Containerization patterns (Gondolin micro-VM) | `docs/containerization.md` | — (docs) | Medium |
| 11 | Supply-chain hardening | root README | Low–Medium | Medium |
| 12 | Public session datasets (Hugging Face) | README, pi-share-hf | Low | Low–Medium |

**Recommended first three:** session trees (#1) — the one genuinely novel
data model in all five analyses; HTML export + gist share (#4) — sharing
with zero hosting; Agent Skills standard compliance (#5) — near-free interop.

---

## Tier 1 — Structural ideas worth adopting

### 1. Session trees + branch summarization

Pi sessions are JSONL files with a **tree structure**, not a linear log:

- `/tree` navigates the session tree interactively; `/fork` branches from
  any earlier user message; `/clone` duplicates the active branch into a new
  session; `pi --fork <id>` forks at startup.
- **Branch summarization**: when you switch branches mid-session, the
  abandoned branch is summarized (same structured format as compaction, with
  cumulative file-operation tracking) so its learnings aren't lost.
- Compaction and branching share one summary format and one entry type in
  the session file.

**Gap in FreeCode:** `session.fork` creates a *new session*; there's no
in-session tree, no branch navigation, and no branch summaries. Rollout
event sourcing could support this — the storage model is close.

**Fit:** represent branches in `rollout/` (parent-entry pointers), add
`/tree` navigation to the TUI, and reuse `compaction/summarizer.ts` for
branch summaries. This is the most interesting data-model idea in all five
repos studied: it makes "try approach A, rewind, try B, keep notes from A"
a first-class workflow.

### 2. Extensions: hot-reload, custom UI, custom rendering

Pi extensions are TypeScript modules (global `~/.pi/agent/extensions/`,
project `.pi/extensions/`) that go further than OpenCode's plugins in three
ways worth copying:

- **Hot reload**: `/reload` picks up extension changes without restarting
  the session — essential for the self-extensibility loop (#3).
- **Custom TUI components**: `ctx.ui.custom()` gives extensions full
  interactive components with keyboard input (dialogs, wizards, even games),
  plus simple `select`/`confirm`/`input`/`notify` prompts.
- **Custom rendering**: extensions control how their tools' calls/results
  display in the TUI.
- Also: event interception (block/modify tool calls), custom compaction,
  `pi.appendEntry()` for state that persists into the session file, and
  `pi.registerCommand()` for slash commands.

Documented example use cases are telling: permission gates and path
protection are *extensions*, not core features.

**Fit:** FreeCode already uses pi-tui, so the custom-UI surface maps
naturally. Fold these three capabilities into the plugin API recommended in
the OpenCode doc (#1 there) — hot reload especially.

### 3. Self-extensibility as a product loop

Every Pi doc page opens with "> pi can create extensions/skills/templates.
Ask it to build one for your use case." The docs are written to be read *by
the agent*; users extend Pi by asking Pi. Combined with hot reload, the
loop is: describe → agent writes extension → `/reload` → use it, all in one
session.

**Fit:** this is nearly free for FreeCode — it's documentation style plus a
skill/context entry teaching the agent FreeCode's own extension API. High
leverage: it turns every user into an extension author. (jcode's "self-dev"
is the maximalist version of this; Pi's extension-scoped version is the
practical one.)

### 4. Serverless sharing: HTML export + gist share

- `/export [file]` renders the session to a **standalone HTML file**.
- `/share` uploads that HTML as a **private GitHub gist** and returns a
  shareable viewer link.

**Fit:** contrast with OpenCode's share (#8 there), which requires their
hosted service. Pi's approach needs *no infrastructure* — FreeCode has
`session.export` already; adding an HTML renderer (the web frontend's
message components could be reused for static rendering) and a gist
uploader gets shareable sessions with zero hosting cost. Do this before —
or instead of — a hosted share service.

### 5. Agent Skills standard + shared skill directories

Pi implements the [Agent Skills standard](https://agentskills.io/specification)
(lenient mode) and loads skills from **cross-harness shared locations**:
`~/.agents/skills/` and `.agents/skills/` in ancestor directories, alongside
its own dirs. Users' skills work across every compliant harness.

**Fit:** FreeCode's `skills/loader.ts` should read the same standard format
and the shared `~/.agents/skills/` / `.agents/skills/` locations. Near-zero
cost, instant compatibility with the growing shared-skill ecosystem
(Claude Code skills are the same SKILL.md family).

---

## Tier 2 — Distribution, library design, practices

### 6. Pi packages

Bundles of extensions + skills + prompt templates + themes, installable
from npm, git, URLs, or local paths (`pi install npm:@foo/bar@1.0.0`,
`pi install git:github.com/user/repo@v1`), declared via a `pi` key in
`package.json` or conventional directories, with per-resource
enable/disable and scope deduplication.

**Fit:** same feature family as grok-build plugins (#13) and OpenCode npm
plugins (#1). Pi's contribution is the **source flexibility** (git/URL/path,
not just npm) and resource filtering. Fold into one FreeCode plugin/package
design.

### 7. pi-ai library design details

FreeCode uses the Vercel AI SDK, so this is not about switching — but
pi-ai has ideas worth mirroring in `providers/`:

- **Tool-calling-only catalog**: the model catalog *only* includes models
  that support tool calling — no footgun models in the picker.
- **Generated model catalog** with static reads + dynamic providers, cost
  metadata, and a publish pipeline (`generate:models`, catalog diffing).
- **Mid-session model handoff**: context persistence designed so a session
  can switch provider/model mid-conversation (FreeCode's loop supports
  provider swap; the explicit "handoff" framing with context translation
  is worth testing).
- **Auth resolution chain** (credential store → env vars → OAuth) and
  request-header transforms.
- **Partial-JSON streaming of tool arguments** — args stream into the UI
  while the model is still emitting them (nice TUI touch FreeCode can adopt
  in `providers/streaming.ts` + tool renderer).
- Model pattern syntax: `--model provider/id:<thinking-level>`.

### 8. Prompt templates with argument hints

Markdown files that become `/commands` (filename = command), with
`description` and `argument-hint` frontmatter surfaced in autocomplete;
loaded from global/project/package/settings/CLI locations. Same family as
Claude Code custom commands (claude-code doc, Tier 2 overlap) — Pi's
autocomplete `argument-hint` is a small UX detail worth keeping.

### 9. Compaction mechanics

Concrete details FreeCode's `compaction/` can borrow:

- Trigger rule: `contextTokens > contextWindow - reserveTokens`, with
  `reserveTokens` (default 16 384) user-configurable per project or global.
- **Cumulative file-operation tracking** across summaries: which files were
  read/edited persists through repeated compactions, so the agent never
  loses track of what it touched.
- Compaction is an **extension point** — extensions can replace the
  summarizer.
- `/compact [prompt]` accepts a custom steering prompt.

### 10. Containerization patterns (instead of permissions)

Pi ships **no permission system** and says so loudly; the documented answer
is isolation: **Gondolin** (an extension routing built-in tools and shell
into a local Linux micro-VM while auth stays on the host), plain Docker, or
OpenShell. FreeCode should keep its permission profiles (Pi's stance is a
philosophy, not a gap to copy) — but the *containerization docs* pattern is
worth adopting: document supported isolation recipes, and note the
micro-VM-via-extension approach as an alternative to grok-build-style kernel
sandboxing (#6 there) that needs no kernel-specific code in core.

### 11. Supply-chain hardening

Practices worth copying wholesale into FreeCode's repo hygiene:

- All direct deps pinned exact; `save-exact=true` + `min-release-age=2`
  in `.npmrc` (no same-day releases).
- Published CLI ships a generated `npm-shrinkwrap.json` pinning transitive
  deps for end users; lifecycle scripts allowlisted — new script-running
  deps fail CI until reviewed.
- Installs use `--ignore-scripts` everywhere (CI, docs, self-update).
- Scheduled `npm audit` + `npm audit signatures` workflow.
- Release smoke tests: build, pack, and install into isolated npm/Bun
  environments outside the repo before tagging.

### 12. Public session datasets

`pi-share-hf` publishes real OSS work sessions to Hugging Face datasets;
the maintainer publishes his own sessions building Pi. A community/data
flywheel idea: real agent sessions (tool use, failures, fixes) as open
training/eval data. Optional for FreeCode, but the session-format export
work (#4) makes it almost free to support.

---

## Overlaps with the other four analyses (no new writeup)

| Pi feature | Already covered in |
|------------|--------------------|
| RPC mode (JSONL over stdio) + embeddable `AgentSession` | OpenCode #2 (SDK), grok-build #1 (headless) |
| Prompt templates as slash commands | claude-code #11 family (custom commands) |
| Themes, keybindings, tmux/termux docs | claude-code #9 (terminal polish) |
| Orchestrator package (experimental multi-agent) | jcode #4 (swarm/task DAG) |
| Cost/token tracking per session (`/session`) | claude-code #3 (/cost) |
| Local models (llama.cpp doc), custom providers | jcode #5 / OpenCode #7 (provider breadth) |

## Already at parity (no action)

Tool loop with streaming, multi-provider support, sessions with
resume/fork, compaction, skills, JSONL session persistence, headless/RPC
operation, TUI (literally the same library). FreeCode's hooks, memory,
permission profiles, and MCP client have no Pi-core equivalent — Pi
delegates all of those to extensions or containers by design.
