#!/usr/bin/env node
// =============================================================================
// build-bun.mjs — compile the TUI to a native binary via `bun build --compile`
// OUTPUT: apps/tui/dist/freecode-bun (~95 MB, boots in ~50 ms)
// Usage: node scripts/build-bun.mjs   (or: pnpm build:bun)
// Requires bun ≥1.3 on PATH or installed via mise.
// =============================================================================

import { execFileSync } from "child_process";
import { readFileSync, statSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { homedir } from "os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findBun() {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return "bun";
  } catch {
    // Not on PATH — look for a mise install.
    const miseDir = join(homedir(), ".local/share/mise/installs/bun");
    if (existsSync(miseDir)) {
      const latest = join(miseDir, "latest/bin/bun");
      if (existsSync(latest)) return latest;
    }
    throw new Error(
      "bun not found — install with `mise use bun` or https://bun.sh",
    );
  }
}

const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, "apps/tui/package.json"), "utf-8"),
);

// CI cross-compile: FREECODE_BUN_TARGET (e.g. bun-linux-x64) +
// FREECODE_BUN_OUTFILE select a specific platform artifact. Locally, neither is
// set and we produce a self-contained binary for the host platform.
const target = process.env.FREECODE_BUN_TARGET || "";
const outfile =
  process.env.FREECODE_BUN_OUTFILE ||
  resolve(repoRoot, "apps/tui/dist/freecode-bun");

const args = [
  "build",
  "--compile",
  "--minify",
  "--define",
  `process.env.FREECODE_BUILD_VERSION=${JSON.stringify(pkg.version)}`,
  // Baked so the TUI spawns its backend by re-exec'ing this binary (`__core`)
  // instead of looking for apps/core/dist/server.js on disk.
  "--define",
  `process.env.FREECODE_BUNDLED=${JSON.stringify("1")}`,
];
if (target) args.push("--target", target);
args.push("--outfile", outfile, resolve(repoRoot, "apps/tui/src/entry.ts"));

console.log(
  `[bun] compiling self-contained binary${target ? ` (${target})` : ""}...`,
);
execFileSync(findBun(), args, { stdio: "inherit", cwd: repoRoot });

const sizeMb = (statSync(outfile).size / 1024 / 1024).toFixed(1);
console.log(`[bun] done: ${outfile} (${sizeMb} MB)`);
console.log("[bun] self-contained: TUI + core bundled; runs from anywhere.");
