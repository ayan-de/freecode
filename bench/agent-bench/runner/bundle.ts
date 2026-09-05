// =============================================================================
// The evidence bundle (spec §8/§10: published, not managed). One tar.gz per
// run — report.json, and per trial the prompt, exact argv, patch, agent
// stdout/stderr, proxy log, folded usage and isolation audit, plus any
// grading output. The proxy log carries paths and token counts only (no
// headers, no bodies), so the bundle is publishable as-is.
//
//   pnpm bench:bundle bench/agent-bench/results/<run>
//
// Writes <run>-evidence.tar.gz + .sha256 next to the run dir. The checksum
// is the claim: anyone holding the tarball can verify it is the one the
// numbers came from.
// =============================================================================

import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface Bundle {
  tarball: string;
  sha256: string;
}

export function bundleRun(resultsDir: string): Bundle {
  const dir = path.resolve(resultsDir);
  if (!fs.existsSync(path.join(dir, "report.json"))) {
    throw new Error(`${dir} has no report.json — not a finished run`);
  }
  const name = path.basename(dir);
  const tarball = path.join(path.dirname(dir), `${name}-evidence.tar.gz`);
  // --sort=name + owner/mtime pinning: the same evidence tars to the same
  // bytes, so the published sha256 is reproducible, not an accident of umask.
  const r = spawnSync(
    "tar",
    [
      "--sort=name", "--owner=0", "--group=0", "--numeric-owner",
      "--mtime=@0",
      "-czf", tarball,
      "-C", path.dirname(dir),
      name,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error(`tar exited ${r.status}`);

  const sha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(tarball))
    .digest("hex");
  fs.writeFileSync(`${tarball}.sha256`, `${sha256}  ${path.basename(tarball)}\n`);
  return { tarball, sha256 };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bundle.ts <results-dir>");
    process.exit(1);
  }
  const b = bundleRun(dir);
  console.log(`${b.tarball}\nsha256 ${b.sha256}`);
}
