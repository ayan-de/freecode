// =============================================================================
// rtk integration tests — pure helpers only (no network, no real downloads).
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { expectedHash, assetName } from "./rtk-installer.js";
import { rewriteCommand } from "./rtk-rewrite.js";

// --- checksums.txt parsing ---------------------------------------------------

const MANIFEST = [
  "3c3316cfc068e372432b415faeab73d46f8047750d488dd94d01d8d9f016a2a1  rtk-x86_64-unknown-linux-musl.tar.gz",
  "027e940d2e9928ea44290577163570bf2540b54c4698d23e3ba170bb34ffeffc  rtk-x86_64-apple-darwin.tar.gz",
  "",
].join("\n");

test("expectedHash extracts the hash for a known asset", () => {
  assert.equal(
    expectedHash(MANIFEST, "rtk-x86_64-unknown-linux-musl.tar.gz"),
    "3c3316cfc068e372432b415faeab73d46f8047750d488dd94d01d8d9f016a2a1",
  );
});

test("expectedHash returns null for an asset not in the manifest", () => {
  assert.equal(expectedHash(MANIFEST, "rtk-aarch64-apple-darwin.tar.gz"), null);
});

test("expectedHash does not partial-match asset names", () => {
  // "darwin.tar.gz" must not match "rtk-x86_64-apple-darwin.tar.gz".
  assert.equal(expectedHash(MANIFEST, "darwin.tar.gz"), null);
});

// --- platform → asset map ----------------------------------------------------

test("assetName returns a supported asset or null for the host", () => {
  const asset = assetName();
  if (asset !== null) {
    assert.match(asset, /^rtk-.+\.(tar\.gz|zip)$/);
  } else {
    assert.equal(asset, null); // unsupported target fails closed, not crashes
  }
});

// --- rewrite exit-code contract ----------------------------------------------
// Drive rewriteCommand against a fake "rtk" script so no real binary is needed.

import { mkdtempSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function fakeRtk(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rtk-fake-"));
  const bin = join(dir, "rtk");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

test("rewriteCommand returns stdout on exit 0", async () => {
  const bin = fakeRtk('#!/bin/sh\necho "rtk ls"\nexit 0\n');
  assert.equal(await rewriteCommand(bin, "ls"), "rtk ls");
});

test("rewriteCommand returns stdout on exit 3 (advisory)", async () => {
  const bin = fakeRtk('#!/bin/sh\necho "rtk git status"\nexit 3\n');
  assert.equal(await rewriteCommand(bin, "git status"), "rtk git status");
});

test("rewriteCommand returns null on exit 1 (no equivalent)", async () => {
  const bin = fakeRtk("#!/bin/sh\nexit 1\n");
  assert.equal(await rewriteCommand(bin, "echo hi"), null);
});

test("rewriteCommand returns null on empty stdout", async () => {
  const bin = fakeRtk("#!/bin/sh\nexit 0\n");
  assert.equal(await rewriteCommand(bin, "ls"), null);
});

test("rewriteCommand ignores stderr noise, reads stdout only", async () => {
  const bin = fakeRtk('#!/bin/sh\necho "nag" 1>&2\necho "rtk ls"\nexit 3\n');
  assert.equal(await rewriteCommand(bin, "ls"), "rtk ls");
});
