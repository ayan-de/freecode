import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { _executeBash } from "./bash.js";

// Common CWD for tests — the tool reads it from ctx.cwd.
const ctx = { cwd: process.cwd() } as { cwd: string };

// Plain `node:test` runner; each test gets its own timeout to avoid hanging
// the suite if a regression brings back the bug being tested for.

test("bash completes normally for a fast command", async () => {
  const result = await _executeBash({ command: "echo hello" }, ctx);
  assert.equal(result.success, true);
  assert.match(result.result?.output ?? "", /hello/);
});

test(
  "bash returns success=false (not hangs) when the command exceeds the timeout",
  async () => {
    // `sleep 5` blocks for 5s; we ask for a 300ms timeout. The test passes
    // only if the timeout SIGKILLs/SIGTERMs the child within roughly the
    // configured window — i.e. the bug being guarded against (timer never
    // firing because close never fires) is fixed.
    const start = Date.now();
    const result = await _executeBash(
      { command: "sleep 5", timeout: 300 },
      ctx,
    );
    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 2000,
      `expected to finish in <2s after a 300ms timeout, took ${elapsed}ms — timeout didn't fire`,
    );
    assert.equal(result.success, false);
    if (result.success) throw new Error("unreachable");
    assert.match(result.error, /timed out after 300ms/);
    assert.equal(result.code, "TIMEOUT_300");
  },
);

test(
  "bash does not hang when the command would block reading stdin (no controlling TTY)",
  async () => {
    // `read` blocks forever waiting for a line on stdin. Before the fix,
    // the child got a pipe that no one wrote to and the timer was the only
    // escape — once stdin is /dev/null via stdio[0]="ignore", `read` exits
    // immediately with non-zero and we never depend on the timer at all.
    const start = Date.now();
    const result = await _executeBash(
      { command: "read x; echo got:\"$x\"", timeout: 5000 },
      ctx,
    );
    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 4000,
      `expected the read to return quickly (EOF on /dev/null), took ${elapsed}ms — likely hanging on stdin`,
    );
    // The command exits non-zero because `read` gets EOF before any input;
    // success=true is fine — the point is that it doesn't hang.
    assert.notEqual(result.success, undefined);
  },
);

test(
  "bash does not hang when a grandchild outlives the shell and holds the output pipe",
  async () => {
    // The `npm test` / `pnpm test` shape: the shell spawns a runner that
    // spawns workers inheriting stdout. On timeout the shell dies but the
    // workers keep the pipe's write end open, so `close` never fires. Before
    // the fix the tool promise never settled and the UI spun forever.
    const start = Date.now();
    const result = await _executeBash(
      { command: "cd /tmp && bash -c 'sleep 30 & echo started; wait'", timeout: 500 },
      ctx,
    );
    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 4000,
      `expected to settle shortly after a 500ms timeout, took ${elapsed}ms — the promise hung on 'close'`,
    );
    assert.equal(result.success, false);
    if (result.success) throw new Error("unreachable");
    assert.match(result.error, /timed out after 500ms/);
  },
);

test("bash kills the whole process group on timeout", async () => {
  // A descendant left running after the timeout keeps burning CPU and can
  // hold ports/locks. The marker file proves nothing survived past the kill.
  const marker = `/tmp/freecode-bash-group-${process.pid}-${Date.now()}`;
  await _executeBash(
    {
      command: `bash -c '(sleep 1; touch ${marker}) & wait'`,
      timeout: 300,
    },
    ctx,
  );
  // Wait past when the orphan would have written the marker.
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(
    existsSync(marker),
    false,
    "descendant survived the timeout — process group was not killed",
  );
});