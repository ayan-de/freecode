# TUI Unix-Redesign — Qualities, Comparison, Recommendation

> Status: design exploration. **No code changes yet.** Goal of this doc is to capture what a "Unix-like" coding-agent TUI actually means, compare concrete behaviours across reference CLIs, and lay out the direction for FreeCode before we touch anything.

---

## 1. What "Unix-like" means in this context

"Unix-like coding agent" is shorthand for a small set of conventions shared by the shells people already live in (`bash`, `zsh`) and by the popular terminal coding CLIs that feel native to them — Claude Code, OpenCode, aider, Gemini CLI. They aren't full-screen TUIs in the vim/tig sense; they're **read-eval-print loops that respect terminal conventions**, not app-style layouts.

Six qualities show up across every one of them.

### 1.1 The prompt is a single line, prefixed, at the bottom

A persistent prompt character marks the input line — `❯`, `>`, `$`, `#`. The conversation scrolls above it; the prompt itself stays anchored to the bottom. No wrapping box, no shadow, no header chrome above the prompt. Claude Code uses `❯`, OpenCode uses `>`, aider uses a simple two-line input with `>`. The shape is the same: **one terminal-native glyph + a space + the editor**.

### 1.2 The first character of the line is a "verb"

- `/` opens a command — the verb is "do this REPL action".
- `!` opens a shell — the verb is "send this to the OS".
- `@` opens a reference — the verb is "include this as context".
- Anything else is the prompt itself — the verb is "do this work".

This is the same dispatch model `bash` uses with metacharacters (`|`, `>`, `<`, `&`), and it's the single biggest UX win over a UI that hides verbs behind dropdowns.

### 1.3 Composition over menus

Every action is also reachable as text. `/help`, `/model opus`, `:q`, `:e $file` — even when a picker modal is shown, there's a typed path to the same outcome. Bash users accept that this is how command lines work; users coming from chat UIs learn it within a session.

### 1.4 The terminal stays a terminal

- `Ctrl+C` cancels the current generation *and* clears the input. Same key, two consequences depending on state — a Unix idiom.
- `Ctrl+D` exits cleanly (EOF). Both Claude Code and the standard shell use this.
- `Ctrl+L` clears the screen without losing history.
- `Ctrl+R` reverse-searches the message history (readline).
- `Up`/`Down` walk through history; `Shift+Tab` cycles modes (Normal → Auto → Plan in Claude Code, with vim users getting `/vim`).

There is no "Are you sure?" modal. There is no application-level wrapper blocking the rest of the terminal. The agent owns one row at the bottom, not the whole pane.

### 1.5 Output is text, in order

Model output, tool calls, and tool results stream as ordinary lines that scroll upward. There is no collapse/expand tree by default — tools get inline representations (Claude Code, OpenCode both lean on streamed lines with light symbols like `●`, `✱`, `⎿`). aider's diff view is the only place it diverges, and even there it stays line-based.

### 1.6 Discoverability through `help`, not chrome

Instead of buttons, the help command (`/help`) is the front door — but it's expected to be terse, grouped, and skim-able. OpenCode's command reference and Claude Code's cheat-sheet style are both examples. The clig.dev guidance applies: lead with the few commands most people actually need, push the rest to a longer help text reachable from `-h`/`--help`.

### 1.7 What "Unix-like" is **not**

It's not vim. There's no mode indicator (`NORMAL`/`INSERT`). It's not tmux. There's no status line with battery, CPU, hostname. It's not lazy either — Claude Code and OpenCode still render rich tool-call cards inline. The "Unix-like" promise is just: **the prompt, the verbs, and the keybindings feel like a shell you already use**, not a chat widget that happens to live in a terminal.

---

## 2. Reference CLIs at a glance

| Behaviour                | Claude Code                | OpenCode                   | aider                  | FreeCode (current)                                |
| ------------------------ | -------------------------- | -------------------------- | ---------------------- | ------------------------------------------------- |
| Prompt character         | `❯`                        | `>`                        | `>`                    | `❯` (pi-tui Editor + `PromptEditor` prefix)       |
| Command prefix           | `/`                        | `/`                        | `/`                    | `/`                                               |
| Shell escape             | `!cmd`                     | `!cmd`                     | `!cmd` (alias `/run`)  | none — `bash` tool only                           |
| File ref                 | `@path`                    | `@path`                    | `/add path`            | `@path` (`at-mention-provider.ts`)                |
| External editor          | none built-in              | `/editor` (`$EDITOR`)      | `/editor`              | none                                              |
| Modes                    | Shift+Tab cycles           | none                       | `/code`, `/ask`, `/architect` | `permission/mode-policy.ts` (plan/build/review/explore/danger) |
| Vim mode                 | `/vim` toggle              | none                       | `--vim` flag           | none                                              |
| History                  | Up/Down, Ctrl+R            | Up/Down                    | Up/Down, Ctrl+R        | Up/Down; Ctrl+R **not wired** (pi-tui default)    |
| Ctrl+C                   | cancel gen **or** clear    | cancel gen / clear         | interrupt              | interrupt (pi-tui)                                |
| Ctrl+D                   | exit                       | (n/a)                      | exit                   | not bound (would exit the process raw)            |
| Ctrl+L                   | clear screen               | clear screen               | clear screen           | not bound                                         |
| Background               | Ctrl+B                     | none                       | none                   | none                                              |
| Rewind / undo            | Esc, Esc → checkpoint      | `/undo` (git-based)        | `/undo` (git-based)    | none                                              |
| Header / logo            | none — clean launch        | none                       | ASCII banner once      | ASCII logo + tips box (`info-box.ts`, `logo-header.ts`) |
| Status line              | thin model/mode indicator  | command palette            | none                   | `status-header.ts`, `mode-line.ts`                |
| Slash popup              | ghost suggestions above prompt | inline completions     | none (text help)       | floating autocomplete (`AutocompleteItem`)       |
| Themes                   | `/theme`                   | `/themes`, `tui.json`      | `--theme`              | `themes.ts` (no runtime switch)                   |

Sources: Claude Code docs (wil.dev guide, codeguides), OpenCode `docs/tui/`, aider `docs/usage/commands.html`, clig.dev (philosophy), FreeCode source at `apps/tui/src/`.

---

## 3. Concrete gaps between FreeCode and the Unix-like baseline

Each item is a behaviour the reference CLIs share and FreeCode currently doesn't, or does differently. File pointers are FreeCode paths.

### 3.1 Header / logo

- **Baseline:** Claude Code and OpenCode both launch into a clean prompt with no logo. aider shows a one-time banner at session start, then disappears.
- **FreeCode now:** ASCII logo + tips box always rendered above the conversation (`apps/tui/src/components/info-box.ts`, `logo-header.ts`, instantiated in `index.ts:236` per the `tui-header-component-location` memory).
- **Gap:** the logo eats the first viewport of every fresh session — exactly the space a status line would use.

### 3.2 Shell escape (`!cmd`)

- **Baseline:** all three reference CLIs treat `!` as a literal "send to `$SHELL`" escape. Output is added to the conversation as a tool result.
- **FreeCode now:** no escape. The only way to run shell commands is the `bash` tool, which goes through the model and permission system — useful, but different intent.
- **Gap:** a user who wants to `! git status` between turns has to round-trip through the model.

### 3.3 History search (`Ctrl+R`)

- **Baseline:** readline's reverse-i-search. Type a fragment, walk through matches.
- **FreeCode now:** only plain Up/Down through `historyIndex` (see `prompt-editor.ts:274` and `formatHistoryIndicator`). Ctrl+R is not bound.
- **Gap:** long sessions become hard to navigate.

### 3.4 Clear screen (`Ctrl+L`)

- **Baseline:** universal. Wipes the visible viewport without touching history.
- **FreeCode now:** not bound. Clearing means re-running the session or scrolling.
- **Gap:** standard muscle memory does nothing.

### 3.5 Clean exit (`Ctrl+D`)

- **Baseline:** EOF. Claude Code exits on Ctrl+D; shells exit on Ctrl+D when the line is empty.
- **FreeCode now:** no binding. `Ctrl+D` on an empty TTY would close stdin raw, with no restoreScreen.
- **Gap:** users coming from shells hit it, get unexpected behaviour, learn to use `/exit`.

### 3.6 Vim mode

- **Baseline:** Claude Code ships `/vim` (and an emacs binding). OpenCode skips it; aider exposes `--vim` as a Python `prompt-toolkit` feature.
- **FreeCode now:** no binding. pi-tui's editor exposes keybindings via `getKeybindings()` (used in `prompt-editor.ts:1`), so this is reachable — just not wired.
- **Gap:** optional but cheap. Worth a follow-up, not a blocker.

### 3.7 External editor (`/editor`)

- **Baseline:** OpenCode and aider both pipe the next prompt through `$EDITOR`. Big ergonomic win on long prompts.
- **FreeCode now:** no command.
- **Gap:** typing long prompts in a TUI is genuinely painful.

### 3.8 Checkpoints / undo

- **Baseline:** Claude Code has automatic checkpoints (Esc, Esc). OpenCode and aider use git to back `/undo` and `/redo`.
- **FreeCode now:** no rewind. The rollout is recorded (`apps/core/src/rollout/`) but there's no surface in the TUI.
- **Gap:** a real Unix-like tool lets you recover from a bad turn cheaply. This is the largest functional gap, but it's also the deepest — it touches core, not just TUI.

### 3.9 Status line vs. logo

- **Baseline:** Claude Code shows a thin status indicator with mode + model at the bottom. OpenCode uses a command palette model. aider has nothing.
- **FreeCode now:** `status-header.ts` and `mode-line.ts` exist. The header above the conversation shows logo + tips; the mode line lives somewhere else (per the existing component split).
- **Gap:** status information competes with the logo for the same viewport. One has to go.

### 3.10 Slash-command popup style

- **Baseline:** OpenCode shows completions inline at the prompt; Claude Code shows a small hint line above it. Both are unobtrusive.
- **FreeCode now:** pi-tui's autocomplete renders as a floating overlay (see `AutocompleteItem` in `commands/index.ts:2` and `getAutocompleteItems()`). It's larger and more boxy than the reference CLIs.
- **Gap:** feels like an IDE dropdown, not a shell completion. Subjective, but it pulls against the Unix feel.

### 3.11 Theme switch at runtime

- **Baseline:** Claude Code `/theme`, OpenCode `/themes` + `tui.json`. Power-user expectation.
- **FreeCode now:** `themes.ts` ships themes but no command switches them. The TUI is built around one theme at startup.
- **Gap:** small. Reach goal.

### 3.12 Verb-first dispatch

- **Baseline:** `/` and `!` and `@` are the three first-character verbs.
- **FreeCode now:** `/` and `@` only. No `!` escape.
- **Gap:** minor — adding `!` is the only piece here, and it's worth bundling with 3.2.

---

## 4. Things FreeCode already does right

Not everything needs to change. The agentic loop, streaming, permission profiles, multi-provider support, and `@`-mention highlighting are all on the right side of the line. Specifically:

- **`❯` prompt prefix** — already correct. Claude Code uses the same glyph.
- **`@`-mention** — `apps/tui/src/utils/at-mention-provider.ts` does fuzzy file search and highlights the chip in yellow (`prompt-editor.ts:72`). This matches the reference CLIs and should be kept.
- **Image paste as `[Image #N]` chips** — Claude Code invented this shape; FreeCode's `PromptEditor` (`prompt-editor.ts:103`, `insertImageAtCursor`) copies it well.
- **Permission profiles in read-only modes** — `permission/mode-policy.ts` is a real differentiator; the reference CLIs only have plan/auto-accept, FreeCode has plan/build/review/explore/danger. Keep, don't regress.
- **Slash command registry** — `commands/index.ts` is already a clean `Map<name, Command>`, so wiring new commands (`/editor`, `/theme`, `!`) is local.
- **History indicator** — `[N/total]` in the bottom border when paging through history (`buildHistoryBorder`, `prompt-editor.ts:34`) is a nice touch the reference CLIs don't bother with.

---

## 5. Recommendation

A pragmatic, incremental move toward the Unix feel. **Two phases**, ordered so each phase is independently shippable.

### Phase 1 — "Drop the chrome, add the verbs" (TUI-only)

Goal: make the prompt feel like a shell, without changing the agent loop, IPC, or core.

1. **Remove the logo header by default.**
   - Keep `info-box.ts` and `logo-header.ts` as code, but stop rendering them above the conversation in `index.ts:236`. A `--logo` flag can re-enable for people who want it.
   - The freed space becomes a thin status strip showing: model, mode, cwd, git branch.

2. **Add `!` shell escape.**
   - `!cmd` runs in a subshell, output captured, appended to the next user message as a tool result (the same way OpenCode does it).
   - Implementation: new `ShellEscapeCommand` in `commands/built-in.ts` that bypasses `Command.execute` (it doesn't fit the registry's strict "first char `/`" contract), or extend the registry to accept `!` as a verb.
   - Permission: read-only by default; with `danger` mode it can mutate.

3. **Wire the readline keys.**
   - `Ctrl+R` reverse-i-search through `history` (pi-tui's editor already stores history; we just need a keybinding).
   - `Ctrl+L` clear viewport (re-emit scrollback state without nuking the message store).
   - `Ctrl+D` on empty input → `/exit` (after `restoreScreen()`).
   - These three land in `index.ts` alongside the existing pi-tui keymap.

4. **Tighten the slash popup.**
   - Replace the floating autocomplete with an inline hint line above the prompt (single line, no border), matching OpenCode. pi-tui's `AutocompleteItem` is still the source — we just render its top result inline.

5. **Add `/theme` and `/vim`.**
   - `/theme` cycles the theme map in `themes.ts`. Persist choice via the same path `status-header.ts` already uses for any user pref (none today — add a small `~/.freecode/tui-prefs.json`).
   - `/vim` flips pi-tui's `Editor` into vim mode if it's exposed; otherwise leave as a stub.

Phase 1 is a single frontend change. No IPC changes, no core changes. Reversible.

### Phase 2 — "Make recovery cheap" (TUI + core)

Goal: parity with Claude Code's Esc-Esc rewind and aider's `/undo`.

6. **`/undo` and `/redo` via git.**
   - Mirror aider's approach: after each turn that touches files, `git stash` the diff (if the repo is a git repo; otherwise no-op with a notice). `/undo` pops the stash; `/redo` re-applies.
   - Implementation: a new tool in `apps/core/src/tools/undo.ts` (read+write to git index, gated by build mode only), surfaced as `/undo` and `/redo` in the TUI.
   - This is a non-trivial tool — it touches permission profiles, hooks, and the rollout recorder. **Do this as a separate piece of work**, not part of Phase 1.

7. **Checkpoint surfacing for non-git projects.**
   - For projects that aren't git repos, fall back to "snapshot files the agent touched this turn, restore on rewind". Optional; can ship without it.

### Phase 3 (later, optional)

8. **`/editor` external editor for long prompts.**
9. **`Ctrl+B` background tasks** (matches Claude Code). Needs core support for detaching a turn.
10. **Vim mode polish** beyond the toggle.
11. **Header/status redesign** with a `tui.json`-style config file (OpenCode's pattern), letting users pick what their status line shows.

### Explicitly out of scope

- Changing pi-tui as the input library. pi-tui is the right level of abstraction; the changes above are about *what we render on top of it*, not the primitives themselves.
- Adopting `tmux`/`less` shortcuts inside the agent's output. The reference CLIs don't.
- Replacing `@`-mention with a different syntax. It's already correct.
- Making the logo the only visible thing on launch. That's the opposite of Unix feel.

---

## 6. Tradeoffs and risks

- **Removing the logo is visible.** First-impression aesthetics matter; some users like the FreeCode brand on launch. Mitigation: keep the code path, gate behind `--logo`. Document the trade in CHANGELOG.
- **`!cmd` is a security surface.** A user typing `! rm -rf ~` shouldn't get a permission prompt per letter, but shouldn't be able to do it accidentally either. Recommendation: `!` requires `build` or `danger` mode; in `plan`/`review`/`explore` it errors out. Document explicitly.
- **`/undo` via git only works in git repos.** aider has the same constraint and accepts it. FreeCode should do the same, with a one-line notice for non-git directories.
- **Tighter popup reduces discoverability.** Inline hints are less prominent than a floating list. Acceptable because `Tab` (pi-tui's existing autocomplete) still surfaces the full list; the inline line is the default path.
- **Keybindings can collide with terminal multiplexers.** tmux uses `Ctrl+B` for its own leader. Claude Code solved this by making `Ctrl+B` configurable; if we add it (Phase 3), make it configurable too.

---

## 7. Open questions for the user before any code change

1. **Header:** remove by default, or make it opt-in via `--logo`? (Recommendation: opt-in.)
2. **Command prefix:** keep `/`, or switch to `:` for the ex-style feel? (Recommendation: keep `/`; switching is a breaking change for muscle memory and for any docs that reference commands. The `:` rename is a nice-to-have, not a Unix necessity.)
3. **`!` escape:** ship in Phase 1, or wait for Phase 2 with the git-backed `/undo`? (Recommendation: Phase 1, since it's a frontend-only change.)
4. **Status line:** what four fields should the new top-of-screen strip show — model, mode, cwd, git branch? Same set as Claude Code, or do we want cost/context in there too?
5. **Theme switch (`/theme`):** worth the persistence plumbing in Phase 1, or push to Phase 3?

Once these are answered, Phase 1 is roughly a one-day change in `apps/tui/src/`. Phase 2 is its own design — see the tools/undo.ts note in §5.
