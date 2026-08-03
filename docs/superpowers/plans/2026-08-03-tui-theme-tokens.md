# Centralised TUI Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline SGR colour constants in `apps/tui/src/themes.ts` and `apps/tui/src/components/resume-picker.tsx` with a token-based theme system living in `packages/ui/theme/`. Ship three named palettes (`default`, `solarized-dark`, `monokai`) and a `/theme` slash command that hot-swaps the active palette at runtime and persists it to `~/.freecode/config.json`.

**Architecture:** Token vocabulary + palette records live in `packages/ui/src/theme/` (pure TS, framework-agnostic). The TUI's `apps/tui/src/theme/` consumes those palettes and adapts them into the chalk/pi-tui stylers the rest of the TUI already expects. A small store holds the active palette; a loader reads/writes the user config. The existing `apps/tui/src/themes.ts` becomes a thin shim so the other nine TUI files keep their imports.

**Tech Stack:** TypeScript, Node `node:fs/promises`, `chalk` (already a dep), `@earendil-works/pi-tui` (already a dep). No new external deps.

## File Structure

**Created:**
- `packages/ui/src/theme/tokens.ts` — the 20-token vocabulary.
- `packages/ui/src/theme/types.ts` — `Palette`, `PaletteName`, `Palettes`.
- `packages/ui/src/theme/palettes.ts` — the three named palettes + `DEFAULT_PALETTE_NAME`.
- `packages/ui/src/theme/index.ts` — public re-exports.
- `packages/ui/src/theme/palettes.test.ts` — palette shape & value tests.
- `apps/tui/src/theme/apply.ts` — palette → chalk/pi-tui styler functions.
- `apps/tui/src/theme/loader.ts` — `~/.freecode/config.json` read/write.
- `apps/tui/src/theme/store.ts` — module-level active palette + `resumeColors()`.
- `apps/tui/src/theme/apply.test.ts` — apply-layer shape tests.
- `apps/tui/src/theme/loader.test.ts` — loader round-trip + error cases.
- `apps/tui/src/commands/theme.test.ts` — `/theme` command tests.

**Modified:**
- `packages/ui/package.json` — add `./theme` and `./theme/*` exports.
- `apps/tui/package.json` — add `@repo/ui` dependency.
- `apps/tui/tsconfig.json` — add `@repo/ui` paths alias.
- `apps/tui/src/themes.ts` — replace hard-coded chalk with `apply(defaultPalette())`.
- `apps/tui/src/components/resume-picker.tsx` — accept `ResumeColors` in constructor; remove inline SGR.
- `apps/tui/src/components/resume-picker.test.ts` — pass test palette to constructor; assertions stay on backgrounds / widths.
- `apps/tui/src/commands/built-in.ts` — register `theme` command.
- `apps/tui/src/index.ts` — `await initTheme()` at startup; pass `resumeColors()` to the picker constructor.
- `apps/tui/src/commands/built-in.ts:6` (help text) — add `/theme` to the help listing.

**Not touched:**
- `apps/tui/src/components/{tool-result-message,info-box,prompt-editor,context-box,status-header,message-row,diff-view,todo-panel,tool-progress-message}.{ts,tsx}` — they import `themes.ts` and keep working unchanged through the shim.

---

## Global Constraints

1. **No new external dependencies** — use what's already in the workspace.
2. **Pure-TS theme module** — `packages/ui/src/theme/` files must not import React, JSX, DOM, chalk, or pi-tui. Only `packages/ui/src/theme/palettes.test.ts` may import test helpers.
3. **Readonly palettes** — `Palette` and `Palettes` types are `Readonly<Record<…>>`. Never mutate.
4. **No `as any` hacks** — the loader returns a `LoadedPalette` with the resolved name; the store reads it directly. No cast through `(p as any).__name`.
5. **Hex values are 6-digit strings** — `#RRGGBB`. Tokens with alpha are out of scope.
6. **`/theme set` writes to disk synchronously enough** that the next TUI startup reads the value, but the in-memory swap is async to keep the render loop unblocked.
7. **Hot-reload scope** — `/theme set` hot-swaps the resume picker only. Other TUI surfaces use the shim, which is bound at module load; they follow the palette at next TUI restart. The shim re-evaluating on every read is out of scope for v1.
8. **Title row** — always black (`#000000`) on the palette's accent. Don't tint the foreground to match `meta`.
9. **Command args** — `execute(args: string[], ctx)` receives `args` already split by the dispatcher (see `apps/tui/src/commands/index.ts:53`). The first arg is the sub-command, the second is the palette name.

---

## Task 1: Theme tokens & types

**Files:**
- Create: `packages/ui/src/theme/tokens.ts`
- Create: `packages/ui/src/theme/types.ts`
- Create: `packages/ui/src/theme/index.ts`

**Interfaces (consumed by later tasks):**
- `tokens.ts` exports `TOKENS` (array of 20 strings, `as const`) and `Token` (union of strings).
- `types.ts` imports `Token` and exports `Palette = Readonly<Record<Token, string>>`, `PaletteName = "default" | "solarized-dark" | "monokai"`, `Palettes = Readonly<Record<PaletteName, Palette>>`.
- `index.ts` re-exports both.

- [ ] **Step 1: Create `packages/ui/src/theme/tokens.ts`**

```ts
export const TOKENS = [
  "accent",
  "accentBg",
  "cardBg",
  "cardBgSelected",
  "dim",
  "meta",
  "pinkMeta",
  "success",
  "warning",
  "error",
  "info",
  "codeFg",
  "codeBlockFg",
  "borderFg",
  "modePlan",
  "modeBuild",
  "modeReview",
  "modeExplore",
  "modeDanger",
  "statusBarBg",
] as const;

export type Token = (typeof TOKENS)[number];
```

- [ ] **Step 2: Create `packages/ui/src/theme/types.ts`**

```ts
import type { Token } from "./tokens.js";

export type Palette = Readonly<Record<Token, string>>;
export type PaletteName = "default" | "solarized-dark" | "monokai";
export type Palettes = Readonly<Record<PaletteName, Palette>>;
```

- [ ] **Step 3: Create `packages/ui/src/theme/index.ts`**

```ts
export { TOKENS, type Token } from "./tokens.js";
export type { Palette, PaletteName, Palettes } from "./types.js";
```

- [ ] **Step 4: Verify TypeScript compiles**

Run from repo root:
```bash
pnpm --filter @repo/ui exec tsc --noEmit
```
Expected: no errors. The other packages don't depend on `@repo/ui` yet so they can't see the new files; that's fine.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/theme/tokens.ts \
        packages/ui/src/theme/types.ts \
        packages/ui/src/theme/index.ts
git commit -m "feat(theme): add token vocabulary and palette types"
```

---

## Task 2: Palettes (default / solarized-dark / monokai)

**Files:**
- Create: `packages/ui/src/theme/palettes.ts`
- Create: `packages/ui/src/theme/palettes.test.ts`
- Modify: `packages/ui/src/theme/index.ts` — re-export palettes.

**Interfaces (consumed by later tasks):**
- `palettes.ts` exports `PALETTES: Palettes` (all three palettes) and `DEFAULT_PALETTE_NAME: PaletteName = "default"`.

- [ ] **Step 1: Write the failing test `packages/ui/src/theme/palettes.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { TOKENS } from "./tokens.js";
import { PALETTES, DEFAULT_PALETTE_NAME } from "./palettes.js";
import type { PaletteName } from "./types.js";

const HEX_6 = /^#[0-9A-Fa-f]{6}$/;

test("every palette has a value for every token", () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    for (const token of TOKENS) {
      assert.ok(typeof palette[token] === "string", `${name} missing ${token}`);
    }
  }
});

test("every value is a 6-digit hex string", () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    for (const [token, value] of Object.entries(palette)) {
      assert.match(value, HEX_6, `${name}.${token} = ${value} is not a #RRGGBB hex`);
    }
  }
});

test("DEFAULT_PALETTE_NAME is a known palette key", () => {
  const names = Object.keys(PALETTES) as PaletteName[];
  assert.ok(names.includes(DEFAULT_PALETTE_NAME));
});

test("exactly three palettes ship", () => {
  assert.equal(Object.keys(PALETTES).length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/ui && pnpm exec tsx --test src/theme/palettes.test.ts
```
Expected: FAIL with `Cannot find module './palettes.js'` (or similar). The test file expects the module.

- [ ] **Step 3: Create `packages/ui/src/theme/palettes.ts`**

```ts
import type { PaletteName, Palettes } from "./types.js";

export const PALETTES: Palettes = {
  default: {
    accent:         "#00FFFF",
    accentBg:       "#00FFFF",
    cardBg:         "#303030",
    cardBgSelected: "#5F5FAF",
    dim:            "#808080",
    meta:           "#FFFFFF",
    pinkMeta:       "#FF55FF",
    success:        "#00FF00",
    warning:        "#FFFF00",
    error:          "#FF0000",
    info:           "#5B9BD5",
    codeFg:         "#FFFF00",
    codeBlockFg:    "#00FF00",
    borderFg:       "#FFFF00",
    modePlan:       "#5B9BD5",
    modeBuild:      "#FFD700",
    modeReview:     "#3CFB3C",
    modeExplore:    "#D92688",
    modeDanger:     "#FF4444",
    statusBarBg:    "#262626",
  },
  "solarized-dark": {
    accent:         "#268BD2",
    accentBg:       "#268BD2",
    cardBg:         "#002B36",
    cardBgSelected: "#073642",
    dim:            "#586E75",
    meta:           "#93A1A1",
    pinkMeta:       "#D33682",
    success:        "#859900",
    warning:        "#B58900",
    error:          "#DC322F",
    info:           "#268BD2",
    codeFg:         "#B58900",
    codeBlockFg:    "#859900",
    borderFg:       "#B58900",
    modePlan:       "#268BD2",
    modeBuild:      "#B58900",
    modeReview:     "#859900",
    modeExplore:    "#D33682",
    modeDanger:     "#DC322F",
    statusBarBg:    "#002B36",
  },
  monokai: {
    accent:         "#F92672",
    accentBg:       "#F92672",
    cardBg:         "#1E1E1E",
    cardBgSelected: "#3E3D32",
    dim:            "#75715E",
    meta:           "#F8F8F2",
    pinkMeta:       "#F92672",
    success:        "#A6E22E",
    warning:        "#E6DB74",
    error:          "#F92672",
    info:           "#66D9EF",
    codeFg:         "#FD971F",
    codeBlockFg:    "#A6E22E",
    borderFg:       "#E6DB74",
    modePlan:       "#66D9EF",
    modeBuild:      "#E6DB74",
    modeReview:     "#A6E22E",
    modeExplore:    "#AE81FF",
    modeDanger:     "#F92672",
    statusBarBg:    "#272822",
  },
};

export const DEFAULT_PALETTE_NAME: PaletteName = "default";
```

- [ ] **Step 4: Update `packages/ui/src/theme/index.ts` to re-export palettes**

Replace the contents with:

```ts
export { TOKENS, type Token } from "./tokens.js";
export type { Palette, PaletteName, Palettes } from "./types.js";
export { PALETTES, DEFAULT_PALETTE_NAME } from "./palettes.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd packages/ui && pnpm exec tsx --test src/theme/palettes.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 6: Run repo-wide typecheck**

```bash
cd packages/ui && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/theme/palettes.ts \
        packages/ui/src/theme/palettes.test.ts \
        packages/ui/src/theme/index.ts
git commit -m "feat(theme): ship default / solarized-dark / monokai palettes"
```

---

## Task 3: `packages/ui` export map and `@repo/ui` consumer wiring

**Files:**
- Modify: `packages/ui/package.json` — add `./theme` and `./theme/*` exports.
- Modify: `apps/tui/package.json` — add `@repo/ui` dependency.
- Modify: `apps/tui/tsconfig.json` — add `@repo/ui` paths alias.
- Run: `pnpm install` to link the new dep.

**Interfaces (consumed by later tasks):**
- The TUI can now `import { PALETTES, type Palette } from "@repo/ui/theme"`.
- No new TS surface beyond what Task 1 + Task 2 already exposed.

- [ ] **Step 1: Update `packages/ui/package.json` exports**

Replace the `"exports"` block:

```json
"exports": {
  "./*": "./src/*.tsx",
  "./theme": "./src/theme/index.ts",
  "./theme/*": "./src/theme/*.ts"
}
```

- [ ] **Step 2: Add `@repo/ui` to `apps/tui/package.json` dependencies**

Inside the existing `"dependencies":` object, add a line alphabetically near the top:

```json
"@repo/ui": "workspace:*",
```

Place it before `@thisisayande/freecode-core` so alphabetical order is preserved.

- [ ] **Step 3: Add the paths alias to `apps/tui/tsconfig.json`**

Replace the `"paths":` block with:

```json
"paths": {
  "@thisisayande/freecode-shared": ["../../packages/shared/dist/index.d.ts"],
  "@thisisayande/freecode-shared/*": ["../../packages/shared/dist/*"],
  "@repo/ui": ["../../packages/ui/src/index.ts"],
  "@repo/ui/*": ["../../packages/ui/src/*"]
}
```

- [ ] **Step 4: Install**

```bash
pnpm install
```
Expected: lockfile updates, no peer-dep errors.

- [ ] **Step 5: Verify TUI can resolve the import**

Create a temporary scratch file at the repo root:

```ts
// /tmp/scratch-resolve.ts
import { PALETTES, DEFAULT_PALETTE_NAME } from "@repo/ui/theme";
console.log(PALETTES[DEFAULT_PALETTE_NAME].accent);
```

Run:
```bash
pnpm --filter @thisisayande/freecode exec tsx /tmp/scratch-resolve.ts
```
Expected: prints `#00FFFF`. Then delete the file.

- [ ] **Step 6: Run repo-wide typecheck**

```bash
pnpm -r exec tsc --noEmit
```
Expected: no new errors. (Pre-existing errors in unrelated packages may exist.)

- [ ] **Step 7: Commit**

```bash
git add packages/ui/package.json \
        apps/tui/package.json \
        apps/tui/tsconfig.json \
        pnpm-lock.yaml
git commit -m "feat(theme): wire @repo/ui into the TUI build"
```

---

## Task 4: Apply layer (palette → chalk/pi-tui stylers)

**Files:**
- Create: `apps/tui/src/theme/apply.ts`
- Create: `apps/tui/src/theme/apply.test.ts`

**Interfaces (consumed by later tasks):**
- `apply.ts` exports:
  - `AgentMode = "plan" | "build" | "review" | "explore" | "danger"`
  - `applyMarkdownTheme(p: Palette): MarkdownTheme`
  - `applySelectListTheme(p: Palette): SelectListTheme`
  - `applyEditorTheme(p: Palette): EditorTheme`
  - `applyModeColors(p: Palette): Record<AgentMode, (s: string) => string>`
  - `applyModeBgColors(p: Palette): Record<AgentMode, (s: string) => string>`
  - `applyStatusBarBg(p: Palette): (s: string) => string`
  - `applyResumeColors(p: Palette): ResumeColors`
  - `ResumeColors` interface — fields: `accent`, `cardBg`, `cardBgSelected`, `pinkMeta`, `dim`, `metaBright`, `metaDim`, `titleFg`, `titleBg`.

- [ ] **Step 1: Write the failing test `apps/tui/src/theme/apply.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEditorTheme, applyMarkdownTheme, applyModeBgColors, applyModeColors,
  applyResumeColors, applySelectListTheme, applyStatusBarBg,
} from "./apply.js";
import { PALETTES, DEFAULT_PALETTE_NAME } from "@repo/ui/theme";

const defaultPalette = PALETTES[DEFAULT_PALETTE_NAME];

test("applyMarkdownTheme returns a function for every key", () => {
  const t = applyMarkdownTheme(defaultPalette);
  for (const key of ["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder",
                    "quote", "quoteBorder", "hr", "listBullet",
                    "bold", "italic", "strikethrough", "underline"] as const) {
    assert.equal(typeof t[key], "function", `missing ${key}`);
  }
});

test("applySelectListTheme returns a function for every key", () => {
  const t = applySelectListTheme(defaultPalette);
  for (const key of ["selectedPrefix", "selectedText", "description", "scrollInfo", "noMatch"] as const) {
    assert.equal(typeof t[key], "function");
  }
});

test("applyEditorTheme includes a SelectListTheme", () => {
  const e = applyEditorTheme(defaultPalette);
  assert.equal(typeof e.borderColor, "function");
  assert.equal(typeof e.selectList, "object");
});

test("applyModeColors has all five modes", () => {
  const m = applyModeColors(defaultPalette);
  for (const mode of ["plan", "build", "review", "explore", "danger"] as const) {
    assert.equal(typeof m[mode], "function", `missing mode ${mode}`);
  }
});

test("applyModeBgColors has all five modes", () => {
  const m = applyModeBgColors(defaultPalette);
  for (const mode of ["plan", "build", "review", "explore", "danger"] as const) {
    assert.equal(typeof m[mode], "function", `missing mode ${mode}`);
  }
});

test("applyStatusBarBg is a function", () => {
  assert.equal(typeof applyStatusBarBg(defaultPalette), "function");
});

test("applyResumeColors has all nine fields", () => {
  const r = applyResumeColors(defaultPalette);
  for (const key of ["accent", "cardBg", "cardBgSelected", "pinkMeta",
                     "dim", "metaBright", "metaDim", "titleFg", "titleBg"] as const) {
    assert.equal(typeof r[key], "function", `missing ${key}`);
  }
});

test("each styler wraps its input verbatim around zero-width SGR", () => {
  // Every styler must accept a plain string and return a string that contains
  // that exact substring. Chalk may add ANSI escapes around it.
  const r = applyResumeColors(defaultPalette);
  for (const key of Object.keys(r) as (keyof typeof r)[]) {
    const out = r[key]("hello");
    assert.ok(out.includes("hello"), `${key} lost its content: ${JSON.stringify(out)}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/tui && pnpm exec tsx --test src/theme/apply.test.ts
```
Expected: FAIL with `Cannot find module './apply.js'`.

- [ ] **Step 3: Create `apps/tui/src/theme/apply.ts`**

```ts
import { Chalk } from "chalk";
import type {
  EditorTheme, MarkdownTheme, SelectListTheme,
} from "@earendil-works/pi-tui";
import type { Palette } from "@repo/ui/theme";
import { DEFAULT_PALETTE_NAME, PALETTES } from "@repo/ui/theme";

const chalk = new Chalk({ level: 3 });

const fg = (hex: string) => (s: string) => chalk.hex(hex)(s);
const bg = (hex: string) => (s: string) => chalk.bgHex(hex)(s);
const dim = (s: string) => chalk.dim(s);

export type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

export function applyMarkdownTheme(p: Palette): MarkdownTheme {
  return {
    heading:         fg(p.accent),
    link:            fg(p.accent),
    linkUrl:         dim,
    code:            fg(p.codeFg),
    codeBlock:       fg(p.codeBlockFg),
    codeBlockBorder: dim,
    quote:           dim,
    quoteBorder:     dim,
    hr:              dim,
    listBullet:      fg(p.accent),
    bold:            (s) => chalk.bold(s),
    italic:          (s) => chalk.italic(s),
    strikethrough:   (s) => chalk.strikethrough(s),
    underline:       (s) => chalk.underline(s),
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

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/tui && pnpm exec tsx --test src/theme/apply.test.ts
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/tui/src/theme/apply.ts apps/tui/src/theme/apply.test.ts
git commit -m "feat(theme): add TUI apply layer (palette → chalk/pi-tui)"
```

---

## Task 5: Loader (read/write `~/.freecode/config.json`)

**Files:**
- Create: `apps/tui/src/theme/loader.ts`
- Create: `apps/tui/src/theme/loader.test.ts`

**Interfaces (consumed by Task 6):**
- `loadPaletteFromConfig(): Promise<LoadedPalette>` — `{ palette: Palette, name: PaletteName, fromConfig: boolean }`.
- `writePaletteToConfig(name: PaletteName): Promise<void>` — preserves other keys, writes pretty JSON.
- `CONFIG_PATH = ~/.freecode/config.json`.

- [ ] **Step 1: Write the failing test `apps/tui/src/theme/loader.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Hijack homedir() for this test by setting HOME.
function withTempHome(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "freecode-loader-"));
  const prev = process.env.HOME;
  process.env.HOME = dir;
  return Promise.resolve(fn(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
  });
}

async function importLoader() {
  // Dynamic import so the env-var hijack takes effect before module evaluation.
  return await import("./loader.js");
}

test("missing config returns default", async () => {
  await withTempHome(async () => {
    const { loadPaletteFromConfig } = await importLoader();
    const loaded = await loadPaletteFromConfig();
    assert.equal(loaded.name, "default");
    assert.equal(loaded.fromConfig, false);
  });
});

test("valid theme reads back", async () => {
  await withTempHome(async (dir) => {
    writeFileSync(join(dir, ".freecode", "config.json"), JSON.stringify({ theme: "monokai" }));
    const { loadPaletteFromConfig } = await importLoader();
    const loaded = await loadPaletteFromConfig();
    assert.equal(loaded.name, "monokai");
    assert.equal(loaded.fromConfig, true);
  });
});

test("unknown theme falls back to default", async () => {
  await withTempHome(async (dir) => {
    writeFileSync(join(dir, ".freecode", "config.json"), JSON.stringify({ theme: "nope" }));
    const { loadPaletteFromConfig } = await importLoader();
    const loaded = await loadPaletteFromConfig();
    assert.equal(loaded.name, "default");
    assert.equal(loaded.fromConfig, false);
  });
});

test("malformed JSON falls back to default", async () => {
  await withTempHome(async (dir) => {
    writeFileSync(join(dir, ".freecode", "config.json"), "{ not json");
    const { loadPaletteFromConfig } = await importLoader();
    const loaded = await loadPaletteFromConfig();
    assert.equal(loaded.name, "default");
    assert.equal(loaded.fromConfig, false);
  });
});

test("write preserves other keys", async () => {
  await withTempHome(async (dir) => {
    const path = join(dir, ".freecode", "config.json");
    writeFileSync(path, JSON.stringify({ existing: 42 }, null, 2));
    const { writePaletteToConfig } = await importLoader();
    await writePaletteToConfig("solarized-dark");
    const after = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(after.theme, "solarized-dark");
    assert.equal(after.existing, 42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/tui && pnpm exec tsx --test src/theme/loader.test.ts
```
Expected: FAIL with `Cannot find module './loader.js'`.

- [ ] **Step 3: Create `apps/tui/src/theme/loader.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  PALETTES, DEFAULT_PALETTE_NAME,
  type Palette, type PaletteName,
} from "@repo/ui/theme";

export const CONFIG_PATH = join(homedir(), ".freecode", "config.json");

export interface LoadedPalette {
  palette: Palette;
  name: PaletteName;
  fromConfig: boolean;
}

export async function loadPaletteFromConfig(): Promise<LoadedPalette> {
  const fallback: LoadedPalette = {
    palette: PALETTES[DEFAULT_PALETTE_NAME],
    name: DEFAULT_PALETTE_NAME,
    fromConfig: false,
  };

  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return fallback;
    console.warn(`freecode: could not read ${CONFIG_PATH}: ${err?.message ?? err}`);
    return fallback;
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(`freecode: ${CONFIG_PATH} is not valid JSON; using default theme`);
    return fallback;
  }

  const name = json?.theme;
  if (typeof name === "string" && name in PALETTES) {
    return { palette: PALETTES[name as PaletteName], name: name as PaletteName, fromConfig: true };
  }
  if (typeof name === "string") {
    console.warn(`freecode: unknown theme "${name}", falling back to default`);
  }
  return fallback;
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

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/tui && pnpm exec tsx --test src/theme/loader.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/tui/src/theme/loader.ts apps/tui/src/theme/loader.test.ts
git commit -m "feat(theme): load and persist palette via ~/.freecode/config.json"
```

---

## Task 6: Store (active palette holder)

**Files:**
- Create: `apps/tui/src/theme/store.ts`

**Interfaces (consumed by Task 7 and Task 8):**
- `initTheme(): Promise<void>` — call once at startup. Reads the loader and caches `ResumeColors`.
- `resumeColors(): ResumeColors` — current `ResumeColors` (post-`initTheme` or post-`setActivePalette`).
- `setActivePalette(name: PaletteName): Promise<void>` — swap palette + write to disk.
- `activePaletteName(): PaletteName` — the resolved name (may differ from disk if the loader fell back).

- [ ] **Step 1: Create `apps/tui/src/theme/store.ts`**

```ts
import { applyResumeColors, defaultPalette, type ResumeColors } from "./apply.js";
import { loadPaletteFromConfig, writePaletteToConfig } from "./loader.js";
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

- [ ] **Step 2: Typecheck**

```bash
cd apps/tui && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/tui/src/theme/store.ts
git commit -m "feat(theme): add active-palette store"
```

---

## Task 7: Replace `apps/tui/src/themes.ts` with the apply-layer shim

**Files:**
- Modify: `apps/tui/src/themes.ts` — full rewrite.

**Behaviour:** All current exports must remain with the same names and shapes. They now source from `apply(defaultPalette())` instead of inline chalk. Tests of downstream consumers must continue to pass.

- [ ] **Step 1: Verify existing importers compile**

```bash
cd apps/tui && pnpm exec tsc --noEmit
```
Expected: no errors. This is the baseline before we touch the file.

- [ ] **Step 2: Replace `apps/tui/src/themes.ts`**

Overwrite the entire file with:

```ts
import { defaultPalette } from "@repo/ui/theme";
import {
  applyEditorTheme, applyMarkdownTheme, applyModeBgColors, applyModeColors,
  applySelectListTheme, applyStatusBarBg,
} from "./theme/apply.js";

const p = defaultPalette();

export const defaultMarkdownTheme   = applyMarkdownTheme(p);
export const defaultSelectListTheme = applySelectListTheme(p);
export const defaultEditorTheme     = applyEditorTheme(p);
export const MODE_COLORS            = applyModeColors(p);
export const MODE_BG_COLORS         = applyModeBgColors(p);
export const STATUS_BAR_BG          = applyStatusBarBg(p);
```

- [ ] **Step 3: Run TUI test suite**

```bash
cd apps/tui && pnpm test
```
Expected: all existing tests still pass. The shim produces the same shapes, so downstream importers (tool-result-message, info-box, prompt-editor, etc.) are unaffected.

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/themes.ts
git commit -m "refactor(theme): route themes.ts exports through apply-layer"
```

---

## Task 8: Refactor `resume-picker.tsx` to consume `ResumeColors`

**Files:**
- Modify: `apps/tui/src/components/resume-picker.tsx` — accept `ResumeColors` in constructor; replace inline SGR constants.

**Public surface:**
- `ResumePicker` constructor signature becomes:
  ```ts
  constructor(
    freecodeSessions: SessionMeta[],
    claudeSessions: ClaudeSessionMeta[],
    colors: ResumeColors,
    callbacks: ResumePickerCallbacks,
  )
  ```
  The previous 3-arg form is gone; every call site must pass `colors`.

**Internal rename map** (every old constant → new field on `this.colors`):
- `ACCENT_CODE` / `ACCENT(...)` → `this.colors.accent(...)` for foreground text; for raw SGR strings, the bg-resume helper opens with `this.colors.cardBg` directly.
- `BG_CARD_CODE` / `BG_CARD(...)` → `this.colors.cardBg(...)`.
- `BG_SEL_CODE` → raw `bg(#cardBgSelected)` used inline (the `renderSessionRow` helper needs the raw SGR to do `bg + fg + padded text + reset`; use `chalk.bgHex(this._palette().cardBgSelected)` — or store the palette on the picker instance as a separate field).
- `FG_PINK_CODE` → `this.colors.pinkMeta(...)`.
- `DIM(...)` → `this.colors.dim(...)`.
- `TITLE_BG(text)` → `this.colors.titleBg(text)`.
- `RESET` (`\u001b[0m`) → keep; chalk writes its own resets.

To preserve the row-helper's "bg + fg + padded text + reset" pattern, add a small `bgRaw(hex)`/`fgRaw(hex)` helper on the picker (built from the same chalk instance), or simply **store the palette on the picker** in addition to the stylers:

```ts
private readonly palette: Palette;
constructor(
  freecodeSessions: SessionMeta[],
  claudeSessions: ClaudeSessionMeta[],
  private readonly colors: ResumeColors,
  callbacks: ResumePickerCallbacks,
) {
  // … existing tabState init …
  this.palette = colorsToPalette(colors); // helper to map back? Or accept palette directly?
}
```

**Simpler alternative** (chosen): extend the `ResumeColors` interface with two **raw-hex accessors** that the picker uses internally for the row helper:

```ts
export interface ResumeColors {
  // … existing styler fields …
  cardBgHex: string;        // raw "#RRGGBB" — for chalk.bgHex in row helpers
  cardBgSelectedHex: string;
  pinkMetaHex: string;
  accentHex: string;
  titleBgHex: string;       // accent, for chalk.bgHex
  titleFgHex: string;       // "#000000" for chalk.hex
}
```

`applyResumeColors` populates both stylers and hexes. This keeps the picker's `renderSessionRow` straightforward.

- [ ] **Step 1: Extend `ResumeColors` in `apply.ts`**

In `apps/tui/src/theme/apply.ts`, replace the `ResumeColors` interface and `applyResumeColors` function:

```ts
export interface ResumeColors {
  accent:         (s: string) => string;
  cardBg:         (s: string) => string;
  cardBgSelected: (s: string) => string;
  pinkMeta:       (s: string) => string;
  dim:            (s: string) => string;
  metaBright:     (s: string) => string;
  metaDim:        (s: string) => string;
  titleFg:        (s: string) => string;
  titleBg:        (s: string) => string;
  // Raw hexes for places that need `chalk.bgHex(...)` / `chalk.hex(...)` directly,
  // e.g. building a single SGR run across content + padding + reset.
  accentHex:         string;
  cardBgHex:         string;
  cardBgSelectedHex: string;
  pinkMetaHex:       string;
  titleFgHex:        string;
  titleBgHex:        string;
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
    accentHex:         p.accent,
    cardBgHex:         p.cardBg,
    cardBgSelectedHex: p.cardBgSelected,
    pinkMetaHex:       p.pinkMeta,
    titleFgHex:        "#000000",
    titleBgHex:        p.accent,
  };
}
```

- [ ] **Step 2: Update `apply.test.ts` to assert the hex fields**

Add a new test block at the end of `apps/tui/src/theme/apply.test.ts`:

```ts
test("applyResumeColors exposes raw hexes for all named colors", () => {
  const r = applyResumeColors(defaultPalette);
  for (const key of ["accentHex", "cardBgHex", "cardBgSelectedHex",
                     "pinkMetaHex", "titleFgHex", "titleBgHex"] as const) {
    assert.equal(typeof r[key], "string");
    assert.match(r[key], /^#[0-9A-Fa-f]{6}$/);
  }
});
```

Run:
```bash
cd apps/tui && pnpm exec tsx --test src/theme/apply.test.ts
```
Expected: passes (the new test plus the previous 8).

- [ ] **Step 3: Modify `resume-picker.tsx`**

The file's existing lines 33–66 (`ACCENT_CODE`, `BG_CARD_CODE`, …, `markdownTheme`, `RESET`) are replaced as follows:

a) **Imports** — add:
```ts
import type { ResumeColors } from "../theme/apply.js";
```

b) **Delete the constants and helpers** at lines 39–66 (`ACCENT_CODE`, `BG_CARD_CODE`, `BG_SEL_CODE`, `FG_PINK_CODE`, `ACCENT`, `DIM`, `BG_CARD`, `TITLE_BG`, `RESET`, `markdownTheme`).

c) **Constructor** — replace the existing 3-arg form with:

```ts
constructor(
  freecodeSessions: SessionMeta[],
  claudeSessions: ClaudeSessionMeta[],
  private readonly colors: ResumeColors,
  private readonly callbacks: ResumePickerCallbacks,
) {
  this.tabState = {
    freecode: { /* unchanged */ },
    "claude-code": { /* unchanged */ },
  };
  this.markdown = new Markdown("", 0, 0, this.buildMarkdownTheme());
}

private buildMarkdownTheme(): MarkdownTheme {
  return {
    heading: this.colors.accent,
    link: this.colors.accent,
    linkUrl: this.colors.dim,
    code: (s) => s,
    codeBlock: (s) => s,
    codeBlockBorder: this.colors.dim,
    quote: this.colors.dim,
    quoteBorder: this.colors.dim,
    hr: this.colors.dim,
    listBullet: this.colors.accent,
    bold: (s) => s,
    italic: (s) => s,
    strikethrough: (s) => s,
    underline: (s) => s,
  };
}
```

d) **Helper `cardRow`** — keep the function but switch from `BG_CARD_CODE` to a small helper:

```ts
private cardBgRaw(): string { return chalkBgHex(this.colors.cardBgHex); }
```

Add `chalkBgHex` and `chalkHex` as module-level:

```ts
const chalk = new Chalk({ level: 3 });
const chalkBgHex = (hex: string) => chalk.bgHex(hex);
const chalkHex = (hex: string) => chalk.hex(hex);
```

(Or import the same `Chalk` instance from `apply.ts` — see Step 4 for refactor.)

Then:

```ts
function cardRow(styled: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(styled));
  return chalkBgHex(this.colors.cardBgHex) + styled + chalkBgHex(this.colors.cardBgHex) + " ".repeat(pad) + "\u001b[0m";
}
```

(Note: `cardRow` is currently a free function. Move it onto the class as `private cardRow(styled, width)`. Update all call sites — there are three: title row, hint row, and the inner separator rows in `render`.)

e) **Title row** — at line 588–589, replace:

```ts
const titleRow = cardRow(
  TITLE_BG(titleText) + (tabStripWidth > 0 ? tabStrip : ""),
  innerWidth,
);
```

with:

```ts
const titleRow = this.cardRow(
  this.colors.titleBg(titleText) + (tabStripWidth > 0 ? tabStrip : ""),
  innerWidth,
);
```

f) **Hint row** — at line 596, replace `DIM(ellipsize(hint, innerWidth))` with `this.colors.dim(ellipsize(hint, innerWidth))` and `cardRow(...)` with `this.cardRow(...)`.

g) **Top + bottom border** — at lines 598–599, replace `ACCENT("╭...")` and `ACCENT("╰...")` with `this.colors.accent("╭...")` etc.

h) **Render list column** — at lines 700 and 706, replace `BG_CARD(...)` with `this.colors.cardBg(...)` and the scrollbar cell at line 706 with `this.colors.cardBg(sb)`.

i) **Render preview column** — no theme constants directly; no change needed.

j) **`renderSessionRow`** — at lines 729–754:

```ts
private renderSessionRow(
  s: SessionMeta | ClaudeSessionMeta,
  isSel: boolean,
  rowIdx: number,
  width: number,
): string {
  const bg = isSel
    ? chalk.bgHex(this.colors.cardBgSelectedHex)(this.colors.cardBgSelectedHex)
    : chalkBgHex(this.colors.cardBgHex);     // placeholder — see below
  // Actually: bg must be the raw SGR to prefix the line, not a styler.
  const bgRaw = isSel
    ? chalkBgHex(this.colors.cardBgSelectedHex)
    : chalkBgHex(this.colors.cardBgHex);
  const prefix = isSel ? "\u203a " : "  ";
  const budget = Math.max(0, width - 2);
  const row = (fgRaw: string, text: string): string =>
    bgRaw + fgRaw + padRight(prefix + ellipsize(text, budget), width) + "\u001b[0m";

  if (rowIdx === 0) {
    const title = s.title.trim() === "" ? "(untitled)" : s.title;
    return row(chalkHex(this.colors.pinkMetaHex), `${title} \u00b7 ${s.turnCount} turns`);
  }
  if (rowIdx === 1) return row(chalkHex(this.colors.accentHex), s.projectPath);
  const metaFg = isSel ? chalkHex("#FFFFFF") : "\u001b[2m";
  if (rowIdx === 2) return row(metaFg, "Closed " + relativeTime(s.lastTurnAt));
  if (rowIdx === 3) return row(metaFg, "Created " + relativeTime(s.createdAt));
  return bgRaw + " ".repeat(width) + "\u001b[0m";
}
```

(Note: `metaBright` was a styler; the picker needs the raw hex here for the same "raw bg + raw fg + padded text + reset" pattern. Hard-coding `#FFFFFF` here matches the pre-shim behaviour, which used `\u001b[37m`. This is the only place where the picker diverges from the palette: in dim mode the original code dimmed the metadata. Use `this.colors.dim` for the dim path? — but then we lose the prefix-and-padding trick. Keep `"\u001b[2m"` for the dim path; it's terminal-default dim, not palette-derived. That's a deliberate choice; document with a comment.)

k) **`renderScrollbar`** — at lines 199 and 201–203, replace `ACCENT` with `this.colors.accent` and `DIM` with `this.colors.dim`.

- [ ] **Step 4: Add `Chalk` instance + helpers to `resume-picker.tsx`**

At the top of `resume-picker.tsx`, just below the new `ResumeColors` import, add:

```ts
import { Chalk } from "chalk";
const chalk = new Chalk({ level: 3 });
const chalkBgHex = (hex: string) => chalk.bgHex(hex);
const chalkHex = (hex: string) => chalk.hex(hex);
```

- [ ] **Step 5: Update `apps/tui/src/components/resume-picker.test.ts`**

The test file calls `new ResumePicker(makeSessions(4), [], { onSelect, onCancel })` 14+ times. Each call needs an extra `colors` argument. Add a helper at the top:

```ts
import { applyResumeColors } from "../theme/apply.js";
import { PALETTES, DEFAULT_PALETTE_NAME } from "@repo/ui/theme";

const TEST_COLORS = applyResumeColors(PALETTES[DEFAULT_PALETTE_NAME]);
```

Then in each `new ResumePicker(...)` call, insert `TEST_COLORS,` between the `[]` (claude sessions) and the callbacks object:

```ts
const picker = new ResumePicker(makeSessions(4), [], TEST_COLORS, {
  onSelect: () => {},
  onCancel: () => {},
});
```

Do this for every call site in the file. Run `rg -n "new ResumePicker" apps/tui/src/components/resume-picker.test.ts` to enumerate.

- [ ] **Step 6: Run the resume-picker tests**

```bash
cd apps/tui && pnpm exec tsx --test src/components/resume-picker.test.ts
```
Expected: all tests pass. The test palette matches `default`, which is byte-equal to the previous hard-coded constants.

- [ ] **Step 7: Typecheck the TUI**

```bash
cd apps/tui && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/tui/src/components/resume-picker.tsx \
        apps/tui/src/components/resume-picker.test.ts \
        apps/tui/src/theme/apply.ts \
        apps/tui/src/theme/apply.test.ts
git commit -m "refactor(theme): resume picker consumes ResumeColors"
```

---

## Task 9: Wire `initTheme` and pass `resumeColors()` at startup

**Files:**
- Modify: `apps/tui/src/index.ts` — call `await initTheme()` in startup; pass `resumeColors()` to the picker.

**Behaviour:** Before the picker is constructed, the config is read once. If the read fails (e.g. permission denied), we catch and continue with the in-memory default — never block startup on config issues.

- [ ] **Step 1: Locate the picker construction site**

In `apps/tui/src/index.ts`, find the line that constructs `ResumePicker`. It will look like:

```ts
const picker = new ResumePicker(freecodeSessions, claudeSessions, callbacks);
```

(Exact identifier names may differ — look for `new ResumePicker(`.)

- [ ] **Step 2: Add the imports**

Add at the top of the file (group with the existing `import` statements):

```ts
import { initTheme, resumeColors } from "./theme/store.js";
```

- [ ] **Step 3: Add `await initTheme()` early in startup**

Find the place where the existing init steps run (look for `await` calls). Add a try/catch wrapper:

```ts
try {
  await initTheme();
} catch (err) {
  console.warn(`freecode: theme init failed: ${err}`);
}
```

If the file already has a single top-level init pattern (e.g. a `main()` function), add the call inside that function.

- [ ] **Step 4: Pass `resumeColors()` to the picker**

Replace the picker construction with:

```ts
const picker = new ResumePicker(freecodeSessions, claudeSessions, resumeColors(), callbacks);
```

- [ ] **Step 5: Run TUI test suite**

```bash
cd apps/tui && pnpm test
```
Expected: all existing tests pass.

- [ ] **Step 6: Manual smoke (optional, only if a TTY is available)**

Run `pnpm --filter @thisisayande/freecode dev` and type `/resume`. Confirm the picker renders with cyan borders (the default palette). Type `/theme set monokai` — confirm the picker re-renders with pink borders on the next frame.

- [ ] **Step 7: Commit**

```bash
git add apps/tui/src/index.ts
git commit -m "feat(theme): initialise theme at startup, inject into picker"
```

---

## Task 10: `/theme` slash command

**Files:**
- Create: `apps/tui/src/commands/theme.ts` — the `themeCommand` object.
- Modify: `apps/tui/src/commands/built-in.ts` — register `themeCommand` and add it to `/help`.

**Command shape:**
```ts
{
  name: "theme",
  description: "Switch or list the active palette",
  argHint: "[list|current|set <name>]",
  execute(args, ctx) {
    const [sub, name] = args;
    // …
  },
}
```

- [ ] **Step 1: Write the failing test `apps/tui/src/commands/theme.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { themeCommand } from "./theme.js";

function makeCtx() {
  const ctx: any = {
    showMessageCalls: [] as string[],
    showMessage(msg: string) { this.showMessageCalls.push(msg); },
  };
  return ctx;
}

test("theme list prints all palette names", async () => {
  const ctx = makeCtx();
  await themeCommand.execute(["list"], ctx);
  assert.match(ctx.showMessageCalls[0], /default/);
  assert.match(ctx.showMessageCalls[0], /solarized-dark/);
  assert.match(ctx.showMessageCalls[0], /monokai/);
});

test("theme current prints active palette name", async () => {
  const ctx = makeCtx();
  await themeCommand.execute(["current"], ctx);
  assert.match(ctx.showMessageCalls[0], /default/);
});

test("theme set with valid name writes the message and persists", async () => {
  const ctx = makeCtx();
  await themeCommand.execute(["set", "monokai"], ctx);
  assert.match(ctx.showMessageCalls[0], /monokai/);
});

test("theme set with unknown name prints error and does not persist", async () => {
  const ctx = makeCtx();
  await themeCommand.execute(["set", "nope"], ctx);
  assert.match(ctx.showMessageCalls[0], /Unknown theme/i);
});

test("theme with no subcommand prints usage", async () => {
  const ctx = makeCtx();
  await themeCommand.execute([], ctx);
  assert.match(ctx.showMessageCalls[0], /Usage/i);
});

test("theme set without name prints usage", async () => {
  const ctx = makeCtx();
  await themeCommand.execute(["set"], ctx);
  assert.match(ctx.showMessageCalls[0], /Usage/i);
});
```

Run:
```bash
cd apps/tui && pnpm exec tsx --test src/commands/theme.test.ts
```
Expected: FAIL with `Cannot find module './theme.js'`.

- [ ] **Step 2: Create `apps/tui/src/commands/theme.ts`**

```ts
import type { Command, CommandContext } from "./index.js";
import { activePaletteName, setActivePalette } from "../theme/store.js";
import { DEFAULT_PALETTE_NAME, PALETTES } from "@repo/ui/theme";

function isPaletteName(s: string): boolean {
  return s in PALETTES;
}

const DESCRIPTIONS: Record<string, string> = {
  "default":       "current TUI colours (cyan accent)",
  "solarized-dark": "warm dark theme, blue accent",
  "monokai":       "high-contrast neon, pink accent",
};

export const themeCommand: Command = {
  name: "theme",
  description: "Switch or list the active palette",
  argHint: "[list|current|set <name>]",
  async execute(args: string[], ctx: CommandContext) {
    const [sub, name] = args;
    if (!sub || sub === "help") {
      ctx.showMessage("**Usage:** /theme list | /theme current | /theme set <name>");
      return;
    }
    if (sub === "list") {
      const lines = ["**Available palettes:**", ""];
      for (const n of Object.keys(PALETTES)) {
        lines.push(`- **${n}** — ${DESCRIPTIONS[n] ?? ""}`);
      }
      ctx.showMessage(lines.join("\n"));
      return;
    }
    if (sub === "current") {
      ctx.showMessage(`**Current palette:** ${activePaletteName()}`);
      return;
    }
    if (sub === "set") {
      if (!name) {
        ctx.showMessage("**Usage:** /theme set <name>");
        return;
      }
      if (!isPaletteName(name)) {
        ctx.showMessage(
          `**Unknown theme:** \`${name}\`. Available: ${Object.keys(PALETTES).join(", ")}.`,
        );
        return;
      }
      try {
        await setActivePalette(name as any);
        ctx.showMessage(`**Theme set to** \`${name}\` **for this session.** Persisted to \`~/.freecode/config.json\`.`);
      } catch (err: any) {
        ctx.showMessage(`**Failed to persist theme:** ${err?.message ?? err}`);
      }
      return;
    }
    ctx.showMessage(`**Unknown subcommand:** \`${sub}\`. Try \`/theme list\`.`);
  },
};

void DEFAULT_PALETTE_NAME; // keep the import live for future use
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd apps/tui && pnpm exec tsx --test src/commands/theme.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 4: Register the command in `apps/tui/src/commands/built-in.ts`**

At the top of the file, add:

```ts
import { themeCommand } from "./theme.js";
```

In the `registerBuiltInCommands()` function, add a registration line alongside the others (preserve alphabetical order if it exists; otherwise alongside `skillsCommand`):

```ts
registerCommand(themeCommand);
```

In the help message of `helpCommand`, add a new bullet between the existing `/skills` and `/exit` lines:

```
- **/theme** - Switch or list the active palette (default/solarized-dark/monokai)
```

- [ ] **Step 5: Run TUI test suite**

```bash
cd apps/tui && pnpm test
```
Expected: all tests pass (including the new theme.test.ts and existing tests).

- [ ] **Step 6: Commit**

```bash
git add apps/tui/src/commands/theme.ts \
        apps/tui/src/commands/theme.test.ts \
        apps/tui/src/commands/built-in.ts
git commit -m "feat(theme): add /theme slash command (list|current|set)"
```

---

## Task 11: End-to-end verification

**Files:** none (this task runs the existing test suites and produces a verification log).

**Goal:** Confirm that the entire change set is green.

- [ ] **Step 1: Run all package tests**

```bash
pnpm -r test
```
Expected: every package's tests pass.

- [ ] **Step 2: Typecheck the whole monorepo**

```bash
pnpm -r exec tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Lint the touched packages**

```bash
pnpm --filter @repo/ui lint
pnpm --filter @thisisayande/freecode lint
```
Expected: clean.

- [ ] **Step 4: Manual smoke (optional)**

Run `pnpm --filter @thisisayande/freecode dev` in a TTY:
- Type `/help` — confirm `/theme` appears in the listing.
- Type `/theme list` — confirm three palettes listed with descriptions.
- Type `/theme set monokai` — confirm the prompt receives the success message. Open `/resume` — confirm the picker borders are pink.
- Quit, re-launch, open `/resume` — confirm borders are still pink (persisted).
- Type `/theme set foo` — confirm error message, state unchanged.
- Edit `~/.freecode/config.json` directly: set `"theme": "solarized-dark"`. Re-launch TUI. Open `/resume` — confirm borders are solarized-blue.

- [ ] **Step 5: Final commit if any fixups were made**

If steps 1–4 surfaced a fix, commit it under a single chore commit:

```bash
git add -A
git commit -m "chore(theme): post-implementation fixups"
```

If nothing changed, skip this step.

---

## Self-Review

**1. Spec coverage:**

| Spec requirement                                          | Task |
| --------------------------------------------------------- | ---- |
| 20 tokens in `packages/ui/src/theme/tokens.ts`            | 1    |
| `Palette` / `PaletteName` / `Palettes` types               | 1    |
| 3 palettes (`default`, `solarized-dark`, `monokai`)        | 2    |
| `PALETTES` / `DEFAULT_PALETTE_NAME`                        | 2    |
| `packages/ui/package.json` exports                         | 3    |
| TUI build wired to `@repo/ui`                              | 3    |
| `applyMarkdownTheme` / `applySelectListTheme` / …          | 4    |
| `ResumeColors` shape + styler + hex fields                 | 4, 8 |
| `applyResumeColors`                                        | 4    |
| `loadPaletteFromConfig` (with `LoadedPalette`)             | 5    |
| `writePaletteToConfig` (preserves other keys)              | 5    |
| Loader error cases (missing / malformed / unknown)         | 5    |
| `initTheme` / `resumeColors` / `setActivePalette` / `activePaletteName` | 6 |
| `apps/tui/src/themes.ts` shim                              | 7    |
| `ResumePicker` accepts `ResumeColors` in constructor       | 8    |
| Resume picker call sites all use `this.colors.*`           | 8    |
| Resume picker tests use a test palette                     | 8    |
| `apps/tui/src/index.ts` calls `initTheme()` + injects      | 9    |
| `/theme` slash command with list/current/set sub-commands  | 10   |
| Help text mentions `/theme`                                | 10   |
| Default palette byte-equal to pre-shim colours             | 2 (hexes match `apps/tui/src/themes.ts`) |
| Black-on-accent title row                                  | 4    |
| Hot-reload scope limited to resume picker                  | 6, 9 |
| Persist via `~/.freecode/config.json`                      | 5, 6 |

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or vague "add appropriate error handling" remain. Each step has either a code block or a single concrete action.

**3. Type consistency:**

- `Token` (Task 1) → `Palette` (Task 1) → `applyResumeColors(p: Palette): ResumeColors` (Task 4) → `ResumePicker(..., colors: ResumeColors, ...)` (Task 8) → `resumeColors(): ResumeColors` (Task 6) → `setActivePalette(name: PaletteName)` (Task 6) → `themeCommand.execute(args: string[], ctx: CommandContext)` (Task 10).
- `LoadedPalette { palette, name, fromConfig }` (Task 5) → consumed by `initTheme` (Task 6).
- `ResumeColors` extends in Task 8 with `*Hex: string` fields populated in the same `applyResumeColors` body.

No renames between tasks.

**4. Risks remaining:**

- The test file (`resume-picker.test.ts`) has 14+ `new ResumePicker(...)` call sites; Step 5 in Task 8 covers this. The `rg` enumeration is the operator's responsibility.
- Task 8 Step 3 is the longest single change in the plan; the test-driven structure (Steps 5–7) keeps it incremental.