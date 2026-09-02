#!/usr/bin/env node
// =============================================================================
// build-bun.mjs — compile the TUI to a native binary via `bun build --compile`
// OUTPUT: apps/tui/dist/freecode-bun (~95 MB, boots in ~50 ms)
// Usage: node scripts/build-bun.mjs   (or: pnpm build:bun)
// Requires bun ≥1.3 on PATH or installed via mise.
// =============================================================================

import { execFileSync } from "child_process";
import {
  readFileSync,
  statSync,
  existsSync,
  readdirSync,
  copyFileSync,
  cpSync,
} from "fs";
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
  // playwright-core's Electron/BiDi transports are optional requires the
  // legacy browser/ path never exercises, but bun's bundler still tries to
  // statically resolve them and fails since neither is a dependency.
  "--external",
  "electron",
  "--external",
  "chromium-bidi/*",
  // Same shape, different package: @anush008/tokenizers (via fastembed) has a
  // platform-specific optionalDependency per OS, and pnpm installs only the
  // one matching this machine — the other two are dangling symlinks. bun's
  // bundler statically resolves all three branches of the package's platform
  // switch and fails on the missing ones, which is why `pnpm build:bun` has
  // been failing outright. Externalize every platform but the one being built.
  ...foreignTokenizerExternals(target),
  "--define",
  `process.env.FREECODE_BUILD_VERSION=${JSON.stringify(pkg.version)}`,
  // Baked so the TUI spawns its backend by re-exec'ing this binary (`__core`)
  // instead of looking for apps/core/dist/server.js on disk.
  "--define",
  `process.env.FREECODE_BUNDLED=${JSON.stringify("1")}`,
];
if (target) args.push("--target", target);
args.push("--outfile", outfile, resolve(repoRoot, "apps/tui/src/entry.ts"));

// Preflight before the (slow) compile: refuse to package without the SPA.
assertWebUiBuilt();
assertCoreBuilt();

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

// `bun build --compile` bundles JS, not static assets, so the web SPA has to
// travel as loose files beside the binary — same treatment as the onnx libs
// above. web-server.ts looks for `web-ui/` next to process.execPath.
//
// Without this the binary starts fine and /api answers normally, but `/`
// 404s. That is invisible on a desktop (the TUI never loads the SPA) and
// fatal on a phone, whose client has no UI of its own and renders this
// bundle in a WebView. Hence the hard failure rather than a warning.
copyWebUi(outfile);

/**
 * `--external` flags for the @anush008/tokenizers bindings that do NOT match
 * the build target.
 *
 * The target's own binding stays bundled — `bun build --compile` embeds .node
 * addons, which is how onnxruntime_binding.node already travels. Only the
 * other platforms' packages need excluding, and they are never loaded at
 * runtime anyway: the package picks one by `process.platform`.
 */
function foreignTokenizerExternals(buildTarget) {
  const platform = buildTarget
    ? buildTarget.includes("windows")
      ? "win32"
      : buildTarget.includes("darwin")
        ? "darwin"
        : "linux"
    : process.platform;

  const byPlatform = {
    win32: "@anush008/tokenizers-win32-x64-msvc",
    darwin: "@anush008/tokenizers-darwin-universal",
    linux: "@anush008/tokenizers-linux-x64-gnu",
  };
  const keep = byPlatform[platform] ?? byPlatform.linux;
  return Object.values(byPlatform)
    .filter((pkg) => pkg !== keep)
    .flatMap((pkg) => ["--external", pkg]);
}

/**
 * The TUI depends on `@thisisayande/freecode-core` as a workspace package, so
 * bun bundles apps/core/**dist**, not apps/core/src. A stale dist produces a
 * binary that compiles, runs, and quietly behaves like whenever core was last
 * built — no error anywhere. The release workflow builds core first
 * (.github/workflows/release.yml), so this is aimed at local packaging, where
 * `node scripts/build-bun.mjs` on its own looks like it should be enough.
 *
 * Compares mtimes rather than trying to typecheck: the question is only
 * "is dist older than src", which is exactly the failure.
 */
function assertCoreBuilt() {
  const dist = resolve(repoRoot, "apps/core/dist/server.js");
  if (!existsSync(dist)) {
    throw new Error(
      "apps/core/dist/server.js missing — run `pnpm --filter " +
        "@thisisayande/freecode-core build` first. bun bundles core's dist, " +
        "not its src.",
    );
  }
  const distTime = statSync(dist).mtimeMs;
  const newest = newestMtime(resolve(repoRoot, "apps/core/src"));
  if (newest > distTime) {
    throw new Error(
      "apps/core/dist is older than apps/core/src — run `pnpm --filter " +
        "@thisisayande/freecode-core build` first. bun bundles core's dist, " +
        "so packaging now would silently ship the previous build.",
    );
  }
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

function webUiSrc() {
  return resolve(repoRoot, "apps/web-app/dist");
}

function assertWebUiBuilt() {
  if (existsSync(join(webUiSrc(), "index.html"))) return;
  throw new Error(
    "apps/web-app/dist/index.html missing — run `pnpm --filter web-app " +
      "build` before packaging. Shipping without it produces a binary whose " +
      "web UI 404s: a blank screen for `freecode web` and for every phone " +
      "client, with no error on either side.",
  );
}

function copyWebUi(binOutfile) {
  const src = webUiSrc();
  const dest = join(dirname(binOutfile), "web-ui");
  cpSync(src, dest, { recursive: true });
  console.log(`[bun] copied web UI → ${dest}`);
}

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
