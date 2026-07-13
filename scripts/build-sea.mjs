#!/usr/bin/env node
// =============================================================================
// build-sea.mjs — produce a single-file `freecode` binary via Node SEA
// FLOW: esbuild bundle (ESM→CJS) → SEA prep blob → copy node binary →
//       postject blob injection → chmod + size report
// OUTPUT: apps/tui/dist/freecode
// Usage: node scripts/build-sea.mjs   (or: pnpm build:sea)
// =============================================================================

import { execFileSync } from "child_process";
import {
  writeFileSync,
  copyFileSync,
  chmodSync,
  readFileSync,
  statSync,
} from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// esbuild/postject are devDependencies of apps/tui — resolve from there.
const tuiRequire = createRequire(
  resolve(repoRoot, "apps/tui/package.json"),
);

const { seaBundleConfig, seaPaths } = await import(
  resolve(repoRoot, "apps/tui/build.config.mjs")
);

// 1. Bundle the TUI into one CJS file
console.log("[sea] bundling TUI with esbuild...");
const esbuild = tuiRequire("esbuild");
await esbuild.build(seaBundleConfig);

// 2. Generate the SEA preparation blob
console.log("[sea] generating SEA blob...");
writeFileSync(
  seaPaths.seaConfig,
  JSON.stringify(
    {
      main: seaPaths.bundle,
      output: seaPaths.blob,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ["--experimental-sea-config", seaPaths.seaConfig], {
  stdio: "inherit",
});

// 3. Copy the node binary and inject the blob
console.log("[sea] injecting blob into node binary...");
copyFileSync(process.execPath, seaPaths.binary);
chmodSync(seaPaths.binary, 0o755);

const { inject } = tuiRequire("postject");
await inject(seaPaths.binary, "NODE_SEA_BLOB", readFileSync(seaPaths.blob), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});

const sizeMb = (statSync(seaPaths.binary).size / 1024 / 1024).toFixed(1);
console.log(`[sea] done: ${seaPaths.binary} (${sizeMb} MB)`);
console.log("[sea] note: the binary is the TUI shell only — it still spawns");
console.log("[sea] apps/core/dist/server.js, so run it from the repo root");
console.log("[sea] (or set FREECODE_ROOT) until the core ships bundled too.");
