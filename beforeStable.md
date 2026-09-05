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

> **Status:** all six are done (2026-09-05).

### 1. ~~SSE replay lies after a full disconnect~~ — DONE 2026-09-05

`tearDownIfEmpty` (`web/stream-subscribers.ts`) disposed the ring buffer when
the last subscriber left — the normal single-browser case. A reconnect carrying
`Last-Event-ID` then hit `if (!rec) return { gap: false, events: [] }` and was
told nothing was missed, losing every event produced while away. Not even a
`stream_gap` marker. Strictly worse than eviction, which at least reports a gap.

**Fixed.** Record lifetime is decoupled from subscriber count: the last leave
starts a 5-minute TTL (`emptySince`) enforced by the reaper that already runs,
and a reconnect inside the window clears it and replays for real. Events emitted
while nobody is attached keep being buffered, as they already were.

`replayForSubscriber` also stops lying when the record is genuinely gone: a
client that claims to have seen events but finds no buffer gets a **gap**, since
we cannot know what it missed. That was the same lie in the other branch.

Tests: 4 in `web/stream-subscribers.test.ts` (replay across a full disconnect, a
gap once reaped, survival of a partial disconnect, a reconnect clearing the
TTL). `runReaperForTests(now?)` is the seam — a five-minute TTL is not
assertable against a 15s unref'd interval.

### 2. ~~Compaction summarizes the original task away~~ — DONE 2026-09-05

`selectForCompaction` preserved only the tail and took `messages.slice(0,
firstPreservedIndex)` for the summary. No head carve-out, so the founding
instruction was compacted first and, on the next compaction, the summary of it
was re-summarized. Lossy compounding on the oldest content — the plausible
mechanism behind long-session drift off the brief.

**Fixed.** The first user message is carved out and preserved verbatim,
prepended *after* the tail-trimming loop so trimming can never evict it. A head
over `maxPreserveHeadTokens` (2k) is a pasted document rather than an
instruction and is summarized as before — the carve-out is for a brief, not for
anything that happens to be first.

Tests: 2 in `selector.test.ts` — the brief survives two consecutive
compactions (the second is where the old code re-summarized the summary of it),
and an oversized head is not pinned.

### 3. ~~Compaction summaries never see tool activity~~ — DONE 2026-09-05

`MemoryService` recorded only user prompts and assistant text; a tool-calling
turn was stored as the stub `[Executed N tools]`. The transcript handed to the
summarizer contained none of the edits, commands or errors that were the actual
work, and it left `summarizer.ts`'s `extractToolCalls`/`extractFiles` matching
nothing — two paths that could not fire.

**Fixed.** `compaction/tool-transcript.ts` renders one bounded line per call
(`Tool <name>: <args> -> <outcome>`, in the format the summarizer already greps
for), and `MemoryService.addToolTurn` records it in place of the stub.

The turn budget moved with it. `normalizeContent` is gone: it clipped the *tail*
of a long message, i.e. the most recent tools. The transcript drops the **oldest**
calls and says how many, which is the right end to lose.
`maxToolOutputChars` is now that per-turn budget (4k) rather than a per-output
one — it was sized for a single raw output and would have kept about four calls.

Tests: 6 in `tool-transcript.test.ts`, one of which pins the line format against
the summarizer's own regexes so the two cannot silently part ways again.

### 4. ~~`METHODS` declares 24 of 49 implemented IPC methods~~ — DONE 2026-09-05

25 of 50, in the end. `CLAUDE.md` calls that map the source of truth; it was
not one. All of `memory.*`, `config.*`, `models.*` and eight session ops got
zero compile-time checking in frontends, and `METHODS["session.send"]` declared
`StreamResponse` as its result — a shape it has never returned (the handler
resolves with the loop's result; per-token output goes over the stream channel).
Its params were missing `model`, `effort` and `agentMode` too.

**Fixed.** All 25 are declared, `session.send` is corrected, and
`ipc/methods-coverage.test.ts` asserts the two sets are equal **in both
directions** — adding a handler without declaring it now fails the suite. That
assertion, not the entries, is what makes the source-of-truth claim true.

Six result shapes needed wire types, since `packages/shared` cannot import from
an app: `MemoryEntry`/`MemoryType`, `MemoryGraphStats`, `RedactedConfig`,
`TurnResult`, `ExportedSession`, `ModelInfo`. They follow the existing
`SessionMeta`/`SerializedMessage` mirror pattern, and `ipc/wire-shapes.test.ts`
pins each with a type-level assignability assertion, so drift is a
`check-types` failure rather than a field that quietly stops reaching
frontends.

Two deliberate narrowings: `TurnResult` omits `LoopResult.finalState` (the
loop's internal state machine — no frontend reads it), and there is no wire type
for the raw config, only the redacted one. Adding one would undo P0 #3.

### 5. ~~No `-32602` invalid-params validation~~ — DONE 2026-09-05

Every handler read its params through `params as { … }`, a cast that checks
nothing, so a missing or mistyped field became `undefined` deep inside and
surfaced as `-32603` — an internal error, which tells the caller the server is
broken when in fact the request was.

**Fixed.** `REQUIRED_PARAMS` in `packages/shared` declares, per method, the
params a handler genuinely cannot proceed without and their JSON types.
`handleRequest` checks it before dispatch and answers `-32602` naming the field
and both types, so a bad call is fixable from the error alone. The table is
typed `Record<MethodName, …>`, so a new method without an entry is a **compile**
error — there is no path to adding a method that skips validation.

Scope is deliberately narrow: presence and type of the *required* params, not a
schema validator. Optional params stay the handler's business (they have
defaults), `null` counts as missing because that is how a JSON caller usually
spells "nothing" and it fails identically, and unknown params are ignored so a
newer frontend still talks to an older core.

The rule for what goes in the table is **what the handler actually needs, not
what `METHODS` types**: `commands.list` types `projectPath` as required but
falls back to cwd, so requiring it would have rejected calls the handler would
have served. Validation that is stricter than the handler is a new bug, not a
fix.

Tests: 9 in `ipc/validate-params.test.ts`, including the point of the exercise
(`handleRequest` returning `-32602` rather than `-32603`) and one asserting an
unknown method is still `-32601`.

### 6. ~~No JSON Schema for `settings.json`, and unknown keys are silently ignored~~ — DONE 2026-09-05

**Fixed, in two halves.**

`settings/known-keys.ts` is the one place that knows the whole shape, so it can
say "unknown key" and, for a near miss, which key was meant —
`"permission"` → *did you mean "permissions"?*. `settings/validate.ts` runs it
over both scopes once per process from the **shared hook bootstrap**, because a
second call site is exactly how `serve` and `run` diverged last time (P0 #2).

Deliberately a *name* check, not a schema validator. Values stay each reader's
business — they already validate and default their own, and a second copy of
those rules diverges. Hook event names are left to `hooks/settings.ts`, which
already reports an unknown one with the full valid list: one good message beats
two in different words. And it warns rather than refuses, since a file with a
stray key is still a usable file.

`schemas/settings.schema.json` is the editor half, wired up with `$schema` —
the one key FreeCode ignores on purpose. Two descriptions of the same file drift
the moment a key lands in only one, so a test asserts the schema's key set
matches `KNOWN_SETTINGS` section by section.

Tests: 9 in `settings/known-keys.test.ts`, including the motivating typo, a
section-level typo, both deliberate non-warnings, and the drift guard.

Docs: `/reference/settings` gained the `$schema` section, `redirect` in the
top-level table (reachable but undocumented there), and the four `memory` keys
the page never listed — `retrievalJudge`, `autoConsolidate`,
`consolidateMinHours`, `consolidateMinSessions`. Two Known-gaps bullets and
their `TODO.md` entries are closed.

**Not adopted:** a shared settings loader. The three-loaders/three-merge-rules
gap (`TODO.md:242`) is real and still open, but collapsing four readers into one
is a refactor with its own risk surface, and it is not what made a typo
invisible. The name check fixes that without touching a single merge rule.

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
5. ~~Clear P1: SSE replay, compaction (brief + tool activity), `METHODS`,
   `-32602`, settings schema.~~
6. `pnpm eval:gate` (needs `FREECODE_JUDGE_PROVIDER`), then tag.

**Steps 1–5 are done (2026-09-05).** All P0 and all P1 items are closed; the
suite is **1255 pass / 0 fail** and `check-types` is clean across all five
workspaces. What remains before the tag is step 6: `pnpm eval:gate` with
`FREECODE_JUDGE_PROVIDER` set, then tag.

Note that P1 #2 and #3 both change what the model sees after a compaction, which
is a behaviour change in the sense `CLAUDE.md`'s eval-driven-development section
means. The gate run in step 6 is the measurement; if the judged suite moves,
those two are the first place to look.
