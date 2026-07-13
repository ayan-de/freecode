// =============================================================================
// SEA bundle config — esbuild options for the single-file TUI bundle (Phase 6)
// Consumed by scripts/build-sea.mjs. Node SEA requires a CommonJS entry, so
// the ESM TUI is bundled to CJS with an import.meta.url shim.
// =============================================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));

export const seaBundleConfig = {
  entryPoints: [resolve(root, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: resolve(root, "dist/tui.bundle.cjs"),
  minify: true,
  sourcemap: false,
  // CJS has no import.meta; recreate a working url for fileURLToPath callers.
  banner: {
    js: "const import_meta_url = require('url').pathToFileURL(__filename).href;",
  },
  define: {
    "import.meta.url": "import_meta_url",
    // package.json is not readable from inside a SEA binary — bake it in.
    "process.env.FREECODE_BUILD_VERSION": JSON.stringify(pkg.version),
  },
  logLevel: "info",
};

export const seaPaths = {
  bundle: resolve(root, "dist/tui.bundle.cjs"),
  blob: resolve(root, "dist/sea-prep.blob"),
  binary: resolve(root, "dist/freecode"),
  seaConfig: resolve(root, "dist/sea-config.json"),
};
