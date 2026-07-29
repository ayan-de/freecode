import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveVerifyCommand,
  runVerify,
  verifyFailureReminder,
} from "./verify.js";

async function tmpProject(pkg: unknown, files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "fc-verify-"));
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

test("resolveVerifyCommand returns undefined when no package.json", () => {
  assert.equal(resolveVerifyCommand("/nonexistent/path/xyz"), undefined);
});

test("resolveVerifyCommand returns undefined when no matching script", async () => {
  const dir = await tmpProject({ scripts: { start: "node ." } });
  try {
    assert.equal(resolveVerifyCommand(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveVerifyCommand prefers typecheck and detects pnpm", async () => {
  const dir = await tmpProject(
    { scripts: { build: "x", typecheck: "tsc --noEmit" } },
    { "pnpm-lock.yaml": "" },
  );
  try {
    assert.deepEqual(resolveVerifyCommand(dir), {
      command: "pnpm run typecheck",
      label: "typecheck",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveVerifyCommand falls back to build with npm default", async () => {
  const dir = await tmpProject({ scripts: { build: "tsc" } });
  try {
    assert.deepEqual(resolveVerifyCommand(dir), {
      command: "npm run build",
      label: "build",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runVerify reports ok on exit 0 and failure with output on non-zero", async () => {
  const signal = new AbortController().signal;
  const pass = await runVerify("exit 0", process.cwd(), signal);
  assert.equal(pass.ok, true);

  const fail = await runVerify("echo boom >&2; exit 1", process.cwd(), signal);
  assert.equal(fail.ok, false);
  assert.match(fail.output, /boom/);
});

test("verifyFailureReminder embeds label and output in a system-reminder", () => {
  const r = verifyFailureReminder("typecheck", "TS2322: nope");
  assert.match(r, /<system-reminder>/);
  assert.match(r, /typecheck/);
  assert.match(r, /TS2322: nope/);
});
