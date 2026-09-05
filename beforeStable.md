# Before Stable (v1.0)

Release-readiness audit, 2026-09-05, against `main` at `360d1e5` (version `0.29.0`).

## Health: green

| Check                | Result                                              |
| -------------------- | --------------------------------------------------- |
| `pnpm check-types`   | clean across all workspaces                          |
| `pnpm test`          | **1206 pass / 0 fail**, 30 suites, ~30s              |
| CI (`ci.yml`)        | lint + typecheck + build + test on every PR          |
| Eval gate (`v0.27.1`)| all three suites opened the gate                     |

The engine is stable. What's left for v1 is **the front door and the headless
path**, not correctness.

---

## P0 — real v1 blockers

> **Status:** all five are done (2026-09-05).

### 1. ~~`README.md` describes a different product~~ — DONE 2026-09-05

It pitches FreeCode as a tool that "drives AI coding assistants via browser
automation" using a "two-phase approach: the AI first returns which files it
needs, then receives those files". That is the legacy Playwright path that
`CLAUDE.md` explicitly marks as **not wired into the primary path**. The actual
product is a ~198-provider API agent loop with a single agentic tool-use loop.

Anyone landing on the repo for v1 reads a stale pitch for a legacy subsystem.

**Fixed.** `README.md` was rewritten against what ships: the real installer, all
16 tools, the command list, the four-frontend architecture, and the ~198-provider
driver. The browser path is kept as a blockquote noting it exists and is not the
default execution path. Three claims were corrected against source while writing
it — `freecode session` is list + delete only, `freecode memory` is graph
stats/rebuild/UI, and `freecode update` is injected by the TUI
(`apps/tui/src/entry.ts:194`), not registered in `create-cli.ts`.

### 2. ~~Headless `freecode run` is broken in three ways~~ — DONE 2026-09-05

`apps/core/src/cli/commands/run.ts`

- **No hooks.** `HookSettingsManager` + `registerRtkHook()` are constructed only
  in `startServer()` (`server.ts:1260-1263`), so a headless run loads no
  `settings.json` hooks. The formatter that fires after every edit interactively
  silently does not fire in CI — same repo, two behaviours. Fix: move both into a
  shared bootstrap the `run` handler also calls.
- **`build` mode denies every write.** `askPermission` rejects immediately when
  no frontend is listening (`bus/index.ts:413`) and `promptForPermission` maps
  that to deny, while `build`'s default for mutating tools is `ask`. So
  `freecode run "fix the test"` reads fine and is denied every edit. Needs a
  `--yes` / `--allow <rule>` flag, or at minimum a one-time explanation on the
  first headless denial.
- **`--agent` is an unchecked cast** (`run.ts:146`). `--agent buld` falls through
  `modeDefault`'s `default` branch and runs with **build** semantics. Add yargs
  `.choices()`, as `mcp add`'s `type` already has.

If v1 is meant to be scriptable at all, these three are the difference between
"works" and "works interactively only".

**Fixed.**

- Hooks moved into `apps/core/src/hooks/bootstrap.ts` (`initHooks`), called by
  both `startServer()` and the `run` handler. Only `serve` passes `watch: true`;
  a one-shot run exits before a settings edit could apply, and would otherwise
  hold an fs watcher open past its last turn.
- `--yes` (`-y`) answers the **ask** tier with allow, and repeatable
  `--allow <rule>` adds in-memory session grants. Both ride into the loop on new
  `AgentLoopConfig.autoApproveAsks` / `.sessionGrants` fields. Scoped to the ask
  tier deliberately: a deny rule and a read-only mode still refuse, because those
  are decisions someone already made, not questions waiting for an answer.
- `--agent` gained yargs `.choices()`, so `--agent buld` exits with a usage error
  instead of running as `build`. The cast at the read site stays — it matches
  `mcp add`'s house style and is now backed by a real runtime check.

Tests: `agent/headless-permission.test.ts` (5 cases — the first asserts the
unattended default is still deny, two cover `--yes` and `--allow` landing a real
write on disk, two assert `--yes` does not beat a deny rule or plan mode) and
`hooks/bootstrap.test.ts` (2). Full suite: **1213 pass / 0 fail**.

Docs updated: `/reference/cli` (flag table, a three-option scripting section,
and the incorrect "there is no `--max-turns`" line), `/reference/settings`,
`/reference/hook-events`, and the three matching `TODO.md` entries.

### 3. ~~`config.get` returns API keys verbatim~~ — DONE 2026-09-05

`server.ts` — `"config.get"` returned `readConfig()` with no redaction. The full
JSON-RPC surface is reachable over `web-server.ts`'s `POST /api`. It is
token-gated and loopback by default, but `host` is a parameter
(`web-server.ts:108`), so one `--host 0.0.0.0` turned a debug convenience into
key exfiltration.

**Fixed.** `redactConfig()` in `providers/config.ts` builds the safe view and
`config.get` returns that: `{ hasApiKey, model?, authMode? }` per provider entry,
`{ hasCredential }` per `web` entry, with `current`, `lastAgentMode` and
`recovery` passed through. It is an **allowlist assembled field by field**, not a
blocklist of known secret names — `WebCredentials` has grown a secret-bearing
field twice, and a blocklist is wrong the day it grows a third.

No consumer lost anything: the only reader of the raw shape was the TUI's
unused `getConfig()` wrapper, whose `ConfigInfo` type now matches. Every other
"is a provider set up" question already went through `providers.list`'s
`hasApiKey`, which never carried the key.

Tests: `providers/config-redaction.test.ts` (4 — one asserts no secret from any
block survives serialization, one pins the exact kept shape, one that an
anonymous web session reads as `hasCredential: false` rather than a missing
block, one that an empty config stays empty). Full suite: **1217 pass / 0 fail**.

Docs updated: `/reference/ipc-methods` (result column, the redaction paragraph
that replaced the "API keys included" warning, and the matching Known-gaps
bullet) and the `TODO.md` entry.

### 4. ~~`freecode uninstall` deletes user data on one `y`~~ — DONE 2026-09-05

Removed all of `~/.freecode` — sessions, rollout logs, memory, history, usage —
and the prompt did not say so. No `--keep-data`, no backup.

**Fixed.** `scripts/uninstall.sh` already drew the right line (`--purge` for a
full wipe, data kept otherwise); the CLI command was the copy that got it wrong,
so the fix was to make them agree rather than invent a third behaviour. The
default now takes the launcher and `~/.freecode/builds` — the program — and
leaves everything else. `--purge` takes the directory, and the line it prints
names what is in it rather than the path alone. `--dry-run` was added, and
`--force` gained `-y`/`--yes` so the two entry points accept the same flags.

`--keep-data` was not added: keeping data is now the default, and a flag for the
default reads like the other behaviour is still lurking.

Two smaller things fell out. A non-TTY stdin resolved `readline.question` at once
with an empty answer, which the old code read as "no" — correct by accident, and
silent; it is now an error naming `--force`. And the handler no longer branches
on `isDirectory()` before choosing `rmSync` vs `unlinkSync`, since `rmSync` with
`recursive` handles both.

Tests: `cli/commands/uninstall.test.ts` (5, against a pure `planUninstall()` so
the safety rule is asserted without deleting anything — the default plan excludes
the data dir, `--purge` includes it *and* labels it with "sessions"/"memory",
purge does not double-list `builds`, an absent launcher is not listed, and an
uninstalled machine plans nothing in either mode). Full suite: **1222 pass / 0
fail**.

Docs updated: `/reference/cli` (flag table + rewritten section), the
`/getting-started/installation` uninstall block, and the `~/.freecode` note on
`/reference`. The **separate** gap that `uninstall` ignores `FREECODE_HOME` /
`FREECODE_INSTALL_DIR` and misses the Windows launcher path is untouched and
still tracked (`TODO.md:578`); it is a completeness bug, not a data-loss one.

### 5. ~~Anthropic OAuth ToS risk is unresolved~~ — DONE 2026-09-05

§0.1 of the OAuth spec was the risk section and had no resolution. A v1 that
ships subscription auth as a headline feature needs an explicit, user-visible
stance — not a spec paragraph.

**Resolved: ship it, state the risk plainly, do not euphemize.** Written into
the spec as §0.2 and, more importantly, published:

- **`/getting-started/anthropic-subscription`** — a new page whose second
  section is the risk, before any instructions. It says FreeCode presents itself
  to Anthropic *as Claude Code*, that Anthropic reserves subscription inference
  for its own surfaces and has acted against tools doing this, and that the
  account at risk is the user's. Then: the three opt-ins and the narrow fourth
  (no key configured + a freecode login — an imported Claude Code login
  deliberately does not count), the login flow, `status`/`logout`, the
  org-forbidden 403 latch and API-key fallback, and why cost is stamped on the
  call.
- **`/reference/cli`** gained a `freecode auth` section — the command was
  undocumented entirely.
- **`/reference/env`** gained `FREECODE_ANTHROPIC_AUTH`, flagged as an opt-in
  rather than a neutral switch.
- **`README.md`** — a warning callout beside `freecode auth login anthropic`,
  and the pitch line up top now says opt-in and links down to it.

The code needed nothing: `auth.ts` already printed the §0.1 disclosure on login
and the identity block was already quarantined to the OAuth path with a test.
The gap was that a user could only read any of this *after* deciding to run the
command. The three §0.1 constraints (opt-in never default, identity block
quarantined, first-run disclosure) stay invariants.

Not adopted: a y/N confirmation on login. §0.1 chose "print once, no repeated
nagging" deliberately, and a prompt in front of a command the user just typed by
name buys nothing the paragraph above it does not already say.

---

## P1 — should fix, will not sink the release

- **SSE replay lies after a full disconnect.** `tearDownIfEmpty`
  (`web/stream-subscribers.ts:265`) disposes the ring buffer when the last
  subscriber leaves — the normal single-browser case. A reconnect carrying
  `Last-Event-ID` then hits `if (!rec) return { gap: false, events: [] }`
  (`:175`) and is told nothing was missed, losing every event produced while
  away. Not even a `stream_gap` marker. Strictly worse than eviction, which at
  least reports a gap. Fix: decouple record lifetime from subscriber count (TTL
  after the last leaves).
- **Compaction summarizes the original task away.** `selectForCompaction`
  preserves only the tail and takes `messages.slice(0, firstPreservedIndex)` for
  the summary (`compaction/selector.ts:54`). No head carve-out, so the founding
  instruction is compacted first and, on the next compaction, the summary of it
  is re-summarized. Lossy compounding on the oldest content — the plausible
  mechanism behind long-session drift off the brief.
- **Compaction summaries never see tool activity.** `MemoryService` records only
  user prompts and assistant text; a tool-calling turn is stored as the stub
  `[Executed N tools]` (`loop.ts:1567`). The transcript handed to the summarizer
  contains none of the edits, commands, or errors that were the actual work.
  Also makes two heuristic-summarizer paths dead code
  (`summarizer.ts:106`, `service.ts:63`).
- **`METHODS` declares 24 of 49 implemented IPC methods**, and
  `METHODS["session.send"]` declares the wrong result type. `CLAUDE.md` calls
  that map the source of truth; it is not one yet. All of `memory.*`, `config.*`,
  `models.*` and 8 session ops get zero compile-time checking in frontends.
- **No `-32602` invalid-params validation.** Every handler does `params as {…}`
  with no runtime check, so a missing or mistyped field becomes `undefined` deep
  inside and surfaces as a confusing `-32603`.
- **No JSON Schema for `settings.json`, and unknown keys are silently ignored.**
  `"permission"` for `"permissions"` is indistinguishable from the outside from
  the feature being broken — in a security-relevant, hand-edited file.

---

## Explicitly not blockers

These are v1.1 features, not "v1 is broken without them" — **provided the README
and docs do not promise them**:

- `autonomous/` — Phase 0 only (types, budget, storage). Nothing executes.
- MCP server (expose). The client side is done.
- Checkpoints / rewind.
- User-defined slash commands and subagents.
- Multimodal input beyond what already landed.

---

## Suggested path to 1.0

1. ~~Rewrite `README.md` against what actually ships.~~
2. ~~Fix the three `run.ts` issues — shared hook bootstrap, `--yes`, `.choices()`.~~
3. ~~Redact `config.get`~~; ~~make `uninstall` keep data by default~~.
4. ~~Write the OAuth ToS stance into user-facing docs.~~
5. `pnpm eval:gate` (needs `FREECODE_JUDGE_PROVIDER`), then tag.

**Steps 1–4 are done (2026-09-05).** What remains before the tag is step 5:
`pnpm eval:gate` with `FREECODE_JUDGE_PROVIDER` set, then tag.
