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
const outfile = resolve(repoRoot, "apps/tui/dist/freecode-bun");

console.log("[bun] compiling TUI to native binary...");
execFileSync(
  findBun(),
  [
    "build",
    "--compile",
    "--minify",
    "--define",
    `process.env.FREECODE_BUILD_VERSION=${JSON.stringify(pkg.version)}`,
    "--outfile",
    outfile,
    resolve(repoRoot, "apps/tui/src/index.ts"),
  ],
  { stdio: "inherit", cwd: repoRoot },
);

const sizeMb = (statSync(outfile).size / 1024 / 1024).toFixed(1);
console.log(`[bun] done: ${outfile} (${sizeMb} MB)`);
console.log("[bun] note: TUI shell only — spawns apps/core/dist/server.js,");
console.log("[bun] so run from the repo root or set FREECODE_ROOT.");
