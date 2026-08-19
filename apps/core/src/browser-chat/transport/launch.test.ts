import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findBrowserBinary } from "./launch.js";

test("an explicit binary is used when it exists", () => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "fc-browser-")),
    "my-browser",
  );
  fs.writeFileSync(file, "");
  assert.equal(findBrowserBinary(file), file);
});

test("an explicit binary that does not exist is rejected, not guessed past", () => {
  // Silently falling back to a different browser than the user configured
  // would be a confusing way to fail.
  assert.equal(findBrowserBinary("/nope/does-not-exist"), null);
});

test("auto-detection finds a browser on PATH", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-path-"));
  fs.writeFileSync(path.join(dir, "chromium"), "");
  const originalPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    assert.equal(findBrowserBinary(), path.join(dir, "chromium"));
  } finally {
    process.env.PATH = originalPath;
  }
});

test("no browser anywhere yields null rather than throwing", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "fc-empty-"));
  const originalPath = process.env.PATH;
  process.env.PATH = empty;
  try {
    // May still find a macOS bundle path on a Mac; on CI/Linux this is null.
    const found = findBrowserBinary();
    assert.ok(found === null || found.startsWith("/Applications/"));
  } finally {
    process.env.PATH = originalPath;
  }
});
