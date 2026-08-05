#!/usr/bin/env node
// =============================================================================
// copy-assets.mjs — copy runtime (non-TS) assets into dist after `tsc`.
//
// tsc emits only .js/.d.ts, so anything read from disk at runtime relative to
// __dirname silently disappears from a built core. `session/prompt/system.md`
// did exactly that: loadSystemPrompt() fell through to its 71-character
// EMBEDDED_FALLBACK, so every `node dist/server.js` run — which is what the TUI
// spawns in preference to tsx — drove the agent with essentially no system
// prompt. It degrades quality invisibly rather than failing, which is why it
// went unnoticed.
//
// The bun release binary is unaffected: it bakes the prompt in via the text
// import in prompt.ts. This only ever hit the dist/node path.
// =============================================================================

import { copyFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Explicit list rather than a glob: only files the runtime actually reads
// belong here. The *-implementation.md files next to their modules are
// documentation and are deliberately not copied.
const ASSETS = ["session/prompt/system.md"];

let copied = 0;
for (const relative of ASSETS) {
  const from = join(root, "src", relative);
  const to = join(root, "dist", relative);
  if (!existsSync(from)) {
    console.error(`[copy-assets] missing source asset: ${from}`);
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}

console.log(`[copy-assets] copied ${copied} runtime asset(s) into dist`);
