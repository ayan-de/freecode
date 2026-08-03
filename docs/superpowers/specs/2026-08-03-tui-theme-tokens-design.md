# Centralised TUI Theme — Design Spec

**Date:** 2026-08-03
**Status:** Draft
**Supersedes:** the inline theme constants in `apps/tui/src/themes.ts` and
`apps/tui/src/components/resume-picker.tsx`
**Extends:** `2026-05-25-architecture-v4.md` (frontends are thin presentation
layers)
**Touches:** `apps/tui/src/themes.ts`, `apps/tui/src/components/resume-picker.tsx`,
`packages/ui/src/theme/`, `~/.freecode/config.json`

---

## Goal

Today the TUI's `/resume` modal hard-codes its own SGR colour codes at the top
of `resume-picker.tsx` (lines 33–66) with a comment that explicitly says *"every
TUI modal keeps its own tiny theme; no shared theme module."* That comment
describes the *current* state, not the desired one. Same story for the rest of
the TUI: `defaultMarkdownTheme`, `defaultSelectListTheme`, `defaultEditorTheme`,
`MODE_COLORS`, `STATUS_BAR_BG`, `MODE_BG_COLORS` are all individually hard-coded
in `apps/tui/src/themes.ts` with no way for the user to switch palette.

This spec introduces a **central theme system** for the TUI:

1. **Tokens in `packages/ui`.** Every colour is a named token. Three named
   palettes ship (`default`, `solarized-dark`, `monokai`).
2. **TUI apply layer.** A token → chalk/pi-tui adapter that turns a palette
   into the existing `MarkdownTheme` / `SelectListTheme` / `EditorTheme` /
   `MODE_COLORS` shapes. No new abstractions for pi-tui.
3. **Resume picker refactor.** `resume-picker.tsx` consumes a `ResumeColors`
   record instead of inline SGR codes. The picker's tests no longer hard-code
   cyan/dark-grey strings.
4. **User-facing switch.** A `/theme` slash command with `list`, `current`, and
   `set <name>` sub-commands. The choice persists in `~/.freecode/config.json`
   (`"theme": "<name>"`). Hot-reload on switch — no TUI restart.

The user's words: *"the resume modal make it use our theme check we have theme
means yellow variant etc we need to centralise the theme"*. The "yellow variant"
they're referring to is the `build` agent mode's bright yellow
(`#FFD700`); the underlying ask is "let me pick a palette and have the modal
follow it".

## Non-goals

- A paste-custom-json-palette flow. (Deliberate; user opted for "variants only"
  in brainstorming.)
- A full theming engine (per-component overrides, live reload from disk, theme
  export/import, JSON schema validation). YAGNI.
- Web-app / Web / VS Code targeting. The token shape *is* designed to be
  frontend-agnostic so a future frontend can reuse it, but only the TUI is
  wired in this spec.
- Removing the existing `apps/tui/src/themes.ts` exports. The module stays; it
  becomes a thin shim that exports the *applied* default palette. Existing
  importers (`tool-result-message.ts`, `info-box.ts`, `prompt-editor.ts`,
  `context-box.ts`, `status-header.ts`, `message-row.ts`, `diff-view.ts`,
  `todo-panel.ts`, `tool-progress-message.ts`) keep working without edits.
- Adding new tokens beyond the 20 v1 names. Adding a token is a one-line
  appending change; we'll leave that to the next person who needs it.

## User-facing behavior

### Slash command

```
/theme list                # shows palette names + one-line descriptions
/theme current             # shows the active palette
/theme set monokai         # switch + persist to ~/.freecode/config.json
/theme set default         # back to whatever was the default at build time
/theme set solarized-dark  # warm dark, blue accent
```

Unknown palette name → one-line error to the prompt history (e.g.
`Unknown theme: foo. Available: default, solarized-dark, monokai.`), no state
change.

### Config persistence

`~/.freecode/config.json` accepts a new top-level `theme` key:

```json
{ "theme": "monokai" }
```

Read at TUI startup. If the file is missing or the key is absent, `default` is
used. If the key is present but the value isn't a known palette name, `default`
is used and a one-line warning is emitted to stderr (the spec keeps the prompt
history clean — warnings that the user can't act on don't belong in the prompt).

`/theme set` writes to `~/.freecode/config.json` preserving all other keys. It
does not engage the core CLI's wider config machinery (e.g. migrated schemas);
it's a simple read-or-write of the `theme` field. The TUI owns the file
end-to-end for this key.

### Reload semantics

`/theme set monokai` updates the active palette **in the current session** on
the next render frame. The TUI does not require a restart. The choice persists
to `~/.freecode/config.json` so the next TUI startup uses it.

### What changes visually

For the user, the change is a single line: every TUI modal — `/resume` most
visibly — now uses the configured palette. Picking `monokai` swaps the borders
to pink, the card background to its monokai dark, the selected-row highlight
to its monokai blue, and the build-mode badge stays neon-green-yellow
(`#a6e22e`). The `/resume` modal is no longer "stuck" on cyan.

## Architecture

### Layering

```
┌──────────────────────────────────────────────────────────────────────┐
│ packages/ui/theme/                                                    │
│   tokens.ts    — Token union (the vocabulary)                        │
│   types.ts     — Palette = Record<Token, string>                      │
│   palettes.ts  — Record<PaletteName, Palette>  (default/solarized/…)  │
│   index.ts     — re-exports                                           │
│   Pure TS. No React. No chalk. No pi-tui.                             │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ apps/tui/src/theme/                                                   │
│   apply.ts   — Palette → MarkdownTheme / SelectListTheme / …          │
│   loader.ts  — reads ~/.freecode/config.json → resolves palette       │
│   store.ts   — tiny mutable holder for the active palette name        │
│   TUI-specific. Uses chalk + pi-tui types.                            │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ apps/tui/src/themes.ts (shim)                                         │
│   defaultMarkdownTheme, defaultSelectListTheme, …                     │
│   Now re-exports `apply(defaultPalette())` so existing                │
│   importers keep working without edits.                               │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ apps/tui/src/components/resume-picker.tsx                             │
│   Receives `ResumeColors` in constructor. No more inline SGR codes.   │
└──────────────────────────────────────────────────────────────────────┘
```

### Tokens (`packages/ui/src/theme/tokens.ts`)

```ts
export const TOKENS = [
  "accent", "accentBg",
  "cardBg", "cardBgSelected",
  "dim", "meta", "pinkMeta",
  "success", "warning", "error", "info",
  "codeFg", "codeBlockFg", "borderFg",
  "modePlan", "modeBuild", "modeReview", "modeExplore", "modeDanger",
  "statusBarBg",
] as const;

export type Token = typeof TOKENS[number];
```

20 tokens. Adding a token means appending to `TOKENS` and updating every
palette — TypeScript catches the missing key at compile time.

### Palette type (`packages/ui/src/theme/types.ts`)

```ts
import type { Token } from "./tokens";

export type Palette = Readonly<Record<Token, string>>;
export type PaletteName = "default" | "solarized-dark" | "monokai";
export type Palettes = Readonly<Record<PaletteName, Palette>>;
```

`Palette` is `Readonly` so no consumer can mutate a palette at runtime. The
TUI builds a new derived `MarkdownTheme` etc. from a palette read; it does not
edit the palette.

### Palettes (`packages/ui/src/theme/palettes.ts`)

```ts
import type { Palettes } from "./types";

export const PALETTES: Palettes = {
  default: {
    accent:       "#00FFFF",
    accentBg:     "#00FFFF",
    cardBg:       "#303030",
    cardBgSelected: "#5F5FAF",
    dim:          "#808080",
    meta:         "#FFFFFF",
    pinkMeta:     "#FF55FF",
    success:      "#00FF00",
    warning:      "#FFFF00",
    error:        "#FF0000",
    info:         "#5B9BD5",
    codeFg:       "#FFFF00",
    codeBlockFg:  "#00FF00",
    borderFg:     "#FFFF00",
    modePlan:     "#5B9BD5",
    modeBuild:    "#FFD700",
    modeReview:   "#3CFB3C",
    modeExplore:  "#D92688",
    modeDanger:   "#FF4444",
    statusBarBg:  "#262626",
  },
  "solarized-dark": {
    accent:       "#268BD2",
    accentBg:     "#268BD2",
    cardBg:       "#002B36",
    cardBgSelected: "#073642",
    dim:          "#586E75",
    meta:         "#93A1A1",
    pinkMeta:     "#D33682",
    success:      "#859900",
    warning:      "#B58900",
    error:        "#DC322F",
    info:         "#268BD2",
    codeFg:       "#B58900",
    codeBlockFg:  "#859900",
    borderFg:     "#B58900",
    modePlan:     "#268BD2",
    modeBuild:    "#B58900",
    modeReview:   "#859900",
    modeExplore:  "#D33682",
    modeDanger:   "#DC322F",
    statusBarBg:  "#002B36",
  },
  monokai: {
    accent:       "#F92672",
    accentBg:     "#F92672",
    cardBg:       "#1E1E1E",
    cardBgSelected: "#3E3D32",
    dim:          "#75715E",
    meta:         "#F8F8F2",
    pinkMeta:     "#F92672",
    success:      "#A6E22E",
    warning:      "#E6DB74",
    error:        "#F92672",
    info:         "#66D9EF",
    codeFg:       "#FD971F",
    codeBlockFg:  "#A6E22E",
    borderFg:     "#E6DB74",
    modePlan:     "#66D9EF",
    modeBuild:    "#E6DB74",
    modeReview:   "#A6E22E",
    modeExplore:  "#AE81FF",
    modeDanger:   "#F92672",
    statusBarBg:  "#272822",
  },
};

export const DEFAULT_PALETTE_NAME: PaletteName = "default";
```

Sourcing the hex values: `default` mirrors the current TUI constants
(`#00FFFF` cyan, `#262626` status bar, the 5-mode colours from
`themes.ts`). `solarized-dark`/`monokai` are the canonical community palettes,
mapped onto the 20 tokens.

### Apply layer (`apps/tui/src/theme/apply.ts`)

```ts
import { Chalk } from "chalk";
import type {
  EditorTheme, MarkdownTheme, SelectListTheme,
} from "@earendil-works/pi-tui";
import type { Palette } from "@repo/ui/theme";
import { DEFAULT_PALETTE_NAME, PALETTES } from "@repo/ui/theme";

const chalk = new Chalk({ level: 3 });

// Stable chalk instance so reusing a styler across many calls is cheap.
const fg = (hex: string) => (s: string) => chalk.hex(hex)(s);
const bg = (hex: string) => (s: string) => chalk.bgHex(hex)(s);
const dim = (s: string) => chalk.dim(s);

export type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

export function applyMarkdownTheme(p: Palette): MarkdownTheme {
  return {
    heading:        fg(p.accent),
    link:           fg(p.accent),
    linkUrl:        dim,
    code:           fg(p.codeFg),
    codeBlock:      fg(p.codeBlockFg),
    codeBlockBorder: dim,
    quote:          dim,
    quoteBorder:    dim,
    hr:             dim,
    listBullet:     fg(p.accent),
    bold:           (s) => chalk.bold(s),
    italic:         (s) => chalk.italic(s),
    strikethrough:  (s) => chalk.strikethrough(s),
    underline:      (s) => chalk.underline(s),
  };
}

export function applySelectListTheme(p: Palette): SelectListTheme {
  return {
    selectedPrefix: fg(p.accent),
    selectedText:   (s) => chalk.bold(s),
    description:    dim,
    scrollInfo:     dim,
    noMatch:        dim,
  };
}

export function applyEditorTheme(p: Palette): EditorTheme {
  return { borderColor: fg(p.borderFg), selectList: applySelectListTheme(p) };
}

export function applyModeColors(p: Palette): Record<AgentMode, (s: string) => string> {
  return {
    plan:    fg(p.modePlan),
    build:   fg(p.modeBuild),
    review:  fg(p.modeReview),
    explore: fg(p.modeExplore),
    danger:  fg(p.modeDanger),
  };
}

export function applyModeBgColors(p: Palette): Record<AgentMode, (s: string) => string> {
  // MODE_BG_COLORS renders the mode *badge* (foreground = black, bg = mode colour).
  // The token already carries the mode colour; we keep the foreground as black.
  const black = (s: string) => chalk.hex("#000000")(s);
  return {
    plan:    (s) => black(bg(p.modePlan)(s)),
    build:   (s) => black(bg(p.modeBuild)(s)),
    review:  (s) => black(bg(p.modeReview)(s)),
    explore: (s) => black(bg(p.modeExplore)(s)),
    danger:  (s) => black(bg(p.modeDanger)(s)),
  };
}

export function applyStatusBarBg(p: Palette): (s: string) => string {
  return bg(p.statusBarBg);
}

export interface ResumeColors {
  accent:         (s: string) => string;
  cardBg:         (s: string) => string;
  cardBgSelected: (s: string) => string;
  pinkMeta:       (s: string) => string;
  dim:            (s: string) => string;
  metaBright:     (s: string) => string;
  metaDim:        (s: string) => string;
  // black-on-accent for the title row band. Foreground is fixed to #000000.
  titleFg:        (s: string) => string;
  titleBg:        (s: string) => string;
}

export function applyResumeColors(p: Palette): ResumeColors {
  const titleFg = (s: string) => chalk.hex("#000000")(s);
  return {
    accent:         fg(p.accent),
    cardBg:         bg(p.cardBg),
    cardBgSelected: bg(p.cardBgSelected),
    pinkMeta:       fg(p.pinkMeta),
    dim:            dim,
    metaBright:     fg(p.meta),
    metaDim:        dim,
    titleFg:        titleFg,
    titleBg:        (s) => bg(p.accent)(titleFg(s)),
  };
}

export function defaultPalette(): Palette {
  return PALETTES[DEFAULT_PALETTE_NAME];
}
```

`ResumeColors` is a flat record of stylers, not a nested palette lookup. The
resume picker passes `rc.accent("foo")` instead of `palette.accent` strings —
the picker never sees hex codes. The title row uses `titleFg` (always black)
on `titleBg` (the palette's accent) so the header is readable in every palette.

### Loader (`apps/tui/src/theme/loader.ts`)

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  PALETTES, DEFAULT_PALETTE_NAME,
  type Palette, type PaletteName,
} from "@repo/ui/theme";

const CONFIG_PATH = join(homedir(), ".freecode", "config.json");

export interface LoadedPalette {
  palette: Palette;
  name: PaletteName;            // resolved name (may differ from disk if invalid)
  /** True when `name` came from disk and matches a known palette. */
  fromConfig: boolean;
}

export async function loadPaletteFromConfig(): Promise<LoadedPalette> {
  let raw: string | undefined;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`freecode: could not read ${CONFIG_PATH}: ${err.message}`);
    }
    return { palette: PALETTES[DEFAULT_PALETTE_NAME], name: DEFAULT_PALETTE_NAME, fromConfig: false };
  }
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(`freecode: ${CONFIG_PATH} is not valid JSON; using default theme`);
    return { palette: PALETTES[DEFAULT_PALETTE_NAME], name: DEFAULT_PALETTE_NAME, fromConfig: false };
  }
  const name = json?.theme;
  if (typeof name === "string" && name in PALETTES) {
    return { palette: PALETTES[name as PaletteName], name: name as PaletteName, fromConfig: true };
  }
  if (typeof name === "string") {
    console.warn(`freecode: unknown theme "${name}", falling back to default`);
  }
  return { palette: PALETTES[DEFAULT_PALETTE_NAME], name: DEFAULT_PALETTE_NAME, fromConfig: false };
}

export async function writePaletteToConfig(name: PaletteName): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    existing = JSON.parse(raw);
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  existing.theme = name;
  await writeFile(CONFIG_PATH, JSON.stringify(existing, null, 2) + "\n", "utf8");
}
```

The loader is **async** because the rest of the TUI's startup is async
already (the IPC client connects async). The single read at startup is
microseconds. `LoadedPalette` returns the resolved name alongside the palette
so the store doesn't need to remember which name it picked up.

### Store (`apps/tui/src/theme/store.ts`)

```ts
import { applyResumeColors, defaultPalette, type ResumeColors } from "./apply";
import { loadPaletteFromConfig, writePaletteToConfig } from "./loader";
import {
  PALETTES, DEFAULT_PALETTE_NAME,
  type Palette, type PaletteName,
} from "@repo/ui/theme";

let activePaletteName: PaletteName = DEFAULT_PALETTE_NAME;
let resumeColorsCached: ResumeColors = applyResumeColors(defaultPalette());

export async function initTheme(): Promise<void> {
  const loaded = await loadPaletteFromConfig();
  activePaletteName = loaded.name;
  resumeColorsCached = applyResumeColors(loaded.palette);
}

export function resumeColors(): ResumeColors {
  return resumeColorsCached;
}

export async function setActivePalette(name: PaletteName): Promise<void> {
  const p: Palette = PALETTES[name];
  resumeColorsCached = applyResumeColors(p);
  activePaletteName = name;
  await writePaletteToConfig(name);
}

export function activePaletteName(): PaletteName {
  return activePaletteName;
}
```

The store is a tiny module-level holder. The TUI's `index.ts` calls
`initTheme()` once at startup before constructing the picker. The picker's
constructor receives `resumeColors()` as a plain argument — no module-level
singleton for the picker, so unit tests can inject a test palette.

### `apps/tui/src/themes.ts` shim

The existing module exports change from "hard-coded chalk" to "default palette
applied":

```ts
import { defaultPalette } from "@repo/ui/theme";
import {
  applyEditorTheme, applyMarkdownTheme, applyModeBgColors, applyModeColors,
  applySelectListTheme, applyStatusBarBg,
} from "./theme/apply";

const p = defaultPalette();

export const defaultMarkdownTheme   = applyMarkdownTheme(p);
export const defaultSelectListTheme = applySelectListTheme(p);
export const defaultEditorTheme     = applyEditorTheme(p);
export const MODE_COLORS            = applyModeColors(p);
export const MODE_BG_COLORS         = applyModeBgColors(p);
export const STATUS_BAR_BG          = applyStatusBarBg(p);
```

Existing importers (`tool-result-message.ts`, `info-box.ts`, `prompt-editor.ts`,
`context-box.ts`, `status-header.ts`, `message-row.ts`, `diff-view.ts`,
`todo-panel.ts`, `tool-progress-message.ts`) keep working without any edits —
they receive the same `MarkdownTheme` / `SelectListTheme` / `EditorTheme`
shapes, just sourced from a palette instead of inlined chalk.

**Hot-reload caveat.** Because the shim is evaluated at module load time, the
shim's exports are bound to the *default* palette. The `/theme set` switch
re-evaluates `resumeColorsCached` in the store, but does **not** rebuild the
shim's exports. That's acceptable for v1: only the `/resume` modal's
`ResumeColors` is hot-swapped; the rest of the TUI's colours follow the theme
at next TUI startup. This keeps the shim simple and avoids the alternative
of making every importer a function call.

### Startup integration

The TUI's entry point already calls async init steps (IPC client connect,
loading the resume picker sessions). `initTheme()` slots into the same
top-level `await` chain before the ResumePicker is constructed:

```ts
// apps/tui/src/index.ts (excerpt)
import { initTheme, resumeColors } from "./theme/store";
import { ResumePicker } from "./components/resume-picker";

await initTheme();
// … other init …
const picker = new ResumePicker(freecodeSessions, claudeSessions, resumeColors(), callbacks);
```

If `initTheme()` rejects (e.g. permission denied on the config file), the TUI
catches, logs the error, and falls back to in-memory `default` — the same
fallback `loadPaletteFromConfig` uses internally. We never block startup on
config-file failures.

### Resume picker refactor

`apps/tui/src/components/resume-picker.tsx` replaces its inline SGR constants
with `ResumeColors`:

```ts
// before
const ACCENT_CODE = "\u001b[36m";
const BG_CARD_CODE = "\u001b[48;5;236m";
const BG_SEL_CODE  = "\u001b[48;5;60m";
const FG_PINK_CODE = "\u001b[38;5;205m";
function ACCENT(text: string) { return `${ACCENT_CODE}${text}\u001b[0m`; }
function BG_CARD(text: string) { return `${BG_CARD_CODE}${text}\u001b[0m`; }

// after
constructor(
  freecodeSessions: SessionMeta[],
  claudeSessions: ClaudeSessionMeta[],
  private readonly colors: ResumeColors,           // injected
  private readonly callbacks: ResumePickerCallbacks,
) { /* … */ }
```

The picker's eight call sites that used `ACCENT_CODE`, `BG_CARD_CODE`,
`BG_SEL_CODE`, `FG_PINK_CODE`, `DIM`, `TITLE_BG`, `RESET` are rewritten to use
`this.colors.cardBg`, `this.colors.cardBgSelected`, `this.colors.pinkMeta`,
`this.colors.accent`, `this.colors.dim`, `this.colors.titleBg`, etc.
`TITLE_BG` becomes `this.colors.titleBg(...)` — black-on-accent, where the
foreground is fixed to `#000000` and the background is `palette.accent`. The
helper `cardRow` switches to `bg + fg + padded text + reset` so the palette's
hex codes are the only colour source.

The picker's tests (in `resume-picker.test.ts`) are updated to assert on
**the configured palette's tokens**, not on literal `\u001b[36m` strings. E.g.
instead of "the title row contains `\u001b[36m`", the test asserts "the title
row contains the accent colour from the test palette". The test palette is
itself a `Palette = { … }` literal passed in via the constructor.

### `/theme` slash command

A new entry in `apps/tui/src/commands/built-in.ts`:

```ts
{
  name: "theme",
  description: "Switch or list the active palette",
  execute: async (args, ctx) => {
    const [sub, name] = args.split(/\s+/);
    if (sub === "list")   return ctx.printList("default, solarized-dark, monokai");
    if (sub === "current") return ctx.printCurrent();
    if (sub === "set") {
      if (!name) return ctx.printError("Usage: /theme set <name>");
      if (!isPaletteName(name)) return ctx.printError(`Unknown theme: ${name}.`);
      await setActivePalette(name);
      ctx.printOk(`Theme set to ${name}.`);
    }
    return ctx.printError("Usage: /theme list|current|set <name>");
  },
}
```

The exact command handler shape follows what's already in `built-in.ts`; the
implementation plugs into the existing command dispatcher.

### `packages/ui` package wiring

`packages/ui/package.json` gets additional exports:

```json
"exports": {
  "./*": "./src/*.tsx",
  "./theme": "./src/theme/index.ts",
  "./theme/*": "./src/theme/*.ts"
}
```

Plus `dependencies` gain nothing — the package is pure TS. The `tsconfig.json`
already allows plain `.ts` next to `.tsx`. All new files are framework-agnostic:
no React, no JSX, no DOM.

## Data flow

### Startup

```
TUI index.ts
   │
   ▼
await initTheme()                  ← loads ~/.freecode/config.json (or default)
   │
   ▼
resumeColors() returns ResumeColors
   │
   ▼
ResumePicker(sessions, …, resumeColors(), callbacks)
       │
       ▼
   render() uses this.colors.cardBg / .accent / etc.
```

### `/theme set monokai`

```
User types: /theme set monokai
   │
   ▼
setActivePalette("monokai")
   │
   ├──> PALETTES["monokai"] → apply → resumeColorsCached (in-memory)
   │
   └──> writePaletteToConfig("monokai") → ~/.freecode/config.json
   │
   ▼
TUI re-renders → resume picker uses new colours on the next frame.
       (Other TUI surfaces keep their pre-switch colours until restart.)
```

### Conflict / error cases

- **Config file missing.** `loadPaletteFromConfig` swallows `ENOENT` and
  returns `defaultPalette()`. No warning.
- **Config file present but malformed JSON.** `JSON.parse` throws; the
  loader catches, emits a one-line stderr warning, and returns `defaultPalette()`.
- **Config file with unknown theme name.** Loader emits a one-line stderr
  warning (`freecode: unknown theme "foo", falling back to default`) and
  returns `defaultPalette()`. The malformed key is NOT erased — the user can
  fix it via `/theme set` or by editing the file directly.
- **`/theme set foo` with unknown name.** Pushed into the prompt history as
  an error message. State unchanged.

## Testing

### Unit tests

- `packages/ui/src/theme/palettes.test.ts` — each palette has a value for every
  token; hex values are valid 6-digit hex; `default` is byte-equal to the
  pre-shim hard-coded values.
- `apps/tui/src/theme/apply.test.ts` — `applyMarkdownTheme(defaultPalette())`
  produces the same `MarkdownTheme` shape as the pre-shim `defaultMarkdownTheme`
  (i.e. we don't accidentally rewire heading vs link).
- `apps/tui/src/theme/loader.test.ts` — happy path, missing file, malformed
  JSON, unknown theme name, write-then-read round-trip.
- `apps/tui/src/components/resume-picker.test.ts` — updated to assert on
  token-derived values via a test palette (`{ accent: "#FFFFFF", … }`).
- `apps/tui/src/commands/built-in.test.ts` (or equivalent) — `/theme list`,
  `/theme current`, `/theme set <good>`, `/theme set <bad>`.

### Manual verification

- TUI launches with no `~/.freecode/config.json` → resume picker uses cyan
  borders (default).
- `/theme set monokai` → resume picker re-renders with pink borders. Status
  bar and other modals still default until restart.
- TUI restart after `monokai` → resume picker still uses pink at first render.
- `/theme set foo` → error message no state change.

## Risks

1. **Hex-code regression.** The `default` palette is *byte-equal* to the
   pre-shim hard-coded values. Drift would change every TUI render
   immediately. Mitigated by an `apply.test.ts` snapshot.
2. **Test churn.** `resume-picker.test.ts` asserts on SGR codes today. Updating
   those to token-derived assertions is a step of the implementation plan;
   it's not a risk, just work.
3. **Misnamed `/theme` command.** We reuse the name `/theme` for the slash
   command; if a user has a custom command with the same name it would
   collide. The existing command dispatcher treats this as a registration
   conflict (it doesn't allow duplicates today). Low risk.
4. **TUI restart required for non-resume surfaces.** Hot-reload only applies
   to the resume picker. Users who want their *entire* TUI to follow the
   palette must restart. Acceptable for v1; a future version can rebuild the
   shim on `/theme set` if it matters.

## Open questions

None at design time. (User has confirmed tokens, palettes, location, and
slash command shape through brainstorming.)
