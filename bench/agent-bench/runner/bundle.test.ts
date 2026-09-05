import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { bundleRun } from "./bundle.js";

test("bundleRun tars the run dir and writes a matching, reproducible sha256", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  const run = path.join(root, "2026-09-06T00-00-00");
  fs.mkdirSync(path.join(run, "django__django-1", "trial-1", "freecode"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(run, "report.json"), "{}");
  fs.writeFileSync(
    path.join(run, "django__django-1", "trial-1", "freecode", "patch.diff"),
    "diff\n",
  );

  const a = bundleRun(run);
  assert.equal(fs.existsSync(a.tarball), true);
  const recomputed = crypto
    .createHash("sha256")
    .update(fs.readFileSync(a.tarball))
    .digest("hex");
  assert.equal(a.sha256, recomputed);
  assert.equal(
    fs.readFileSync(`${a.tarball}.sha256`, "utf-8").startsWith(a.sha256),
    true,
  );

  // Same content, same bytes — the published checksum must be reproducible.
  const b = bundleRun(run);
  assert.equal(b.sha256, a.sha256);

  assert.throws(() => bundleRun(root), /no report\.json/);
  fs.rmSync(root, { recursive: true, force: true });
});
