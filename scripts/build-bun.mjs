#!/usr/bin/env node
// =============================================================================
// build-bun.mjs — compile the TUI to a native binary via `bun build --compile`
// OUTPUT: apps/tui/dist/freecode-bun (~95 MB, boots in ~50 ms)
// Usage: node scripts/build-bun.mjs   (or: pnpm build:bun)
// Requires bun ≥1.3 on PATH or installed via mise.
// =============================================================================

import { execFileSync } from "child_process";
import { readFileSync, statSync, existsSync, readdirSync, copyFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { homedir } from "os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

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

// `bun build --compile` embeds onnxruntime_binding.node but not the shared
// library it dlopen()s at runtime (libonnxruntime.so.1 / .dylib / .dll) —
// the embedded addon's RPATH doesn't survive bundling, so the dlopen fails
// and the embedder silently falls back to keyword search (spec D6). Ship
// the real shared libs as loose files next to the binary instead: on Linux/
// macOS the embedder points LD_LIBRARY_PATH/DYLD_LIBRARY_PATH at the exe's
// own directory before importing fastembed; on Windows same-directory DLLs
// are found by the default search order with no env var needed.
copyOnnxSharedLibs(outfile, target);

function targetPlatformArch(bunTarget) {
  if (!bunTarget) return { platform: process.platform, arch: process.arch };
  const map = {
    "bun-linux-x64": ["linux", "x64"],
    "bun-linux-arm64": ["linux", "arm64"],
    "bun-darwin-x64": ["darwin", "x64"],
    "bun-darwin-arm64": ["darwin", "arm64"],
    "bun-windows-x64": ["win32", "x64"],
  };
  const hit = map[bunTarget];
  if (!hit) throw new Error(`unknown bun target: ${bunTarget}`);
  return { platform: hit[0], arch: hit[1] };
}

function copyOnnxSharedLibs(binOutfile, bunTarget) {
  const { platform, arch } = targetPlatformArch(bunTarget);
  // package.json exports blocks a direct package.json resolve; go through
  // fastembed's own resolution of its onnxruntime-node dependency instead.
  const fastembedMain = require.resolve("fastembed", {
    paths: [resolve(repoRoot, "apps/core")],
  });
  const onnxMain = require.resolve("onnxruntime-node", {
    paths: [dirname(fastembedMain)],
  });
  // onnxMain is .../onnxruntime-node/dist/index.js — walk up to the package root.
  const onnxRoot = dirname(dirname(onnxMain));
  const natDir = join(onnxRoot, "bin", "napi-v3", platform, arch);
  if (!existsSync(natDir)) {
    console.log(`[bun] no onnxruntime natives for ${platform}/${arch}, skipping`);
    return;
  }
  const destDir = dirname(binOutfile);
  const libs = readdirSync(natDir).filter((f) => !f.endsWith(".node"));
  for (const lib of libs) {
    copyFileSync(join(natDir, lib), join(destDir, lib));
  }
  console.log(`[bun] copied ${libs.length} onnxruntime shared lib(s) → ${destDir}`);
}
