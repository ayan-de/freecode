import test from "node:test";
import assert from "node:assert/strict";
import { _executeBash } from "./bash.js";
import { BashOutputTool } from "./bashoutput.js";
import { KillBashTool } from "./killbash.js";
import { disposeShellRegistry, peekShellRegistry } from "./shells/index.js";

const ctx = (sessionId: string) => ({
  cwd: process.cwd(),
  sessionId,
  abort: new AbortController().signal,
});

async function untilSettled(sessionId: string, id: string): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const status = peekShellRegistry(sessionId)?.get(id)?.status;
    if (status && status !== "running") return;
    if (Date.now() > deadline) throw new Error(`${id} never settled`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("run_in_background returns immediately with a shell id", async () => {
  const sessionId = "bg-returns";
  // `sleep 5` with the default 60s foreground timeout: if this awaited the
  // process the assertion below would take five seconds, not milliseconds.
  const started = Date.now();
  const result = await _executeBash(
    { command: "sleep 5", run_in_background: true },
    ctx(sessionId),
  );
  assert.equal(result.success, true);
  assert.ok(Date.now() - started < 1000, "must not wait for the process");
  assert.ok(result.success && result.result.output.includes("bash_1"));
  assert.equal(result.success && result.result.metadata?.background, true);
  disposeShellRegistry(sessionId);
});

test("bashoutput drains new output and then reports status", async () => {
  const sessionId = "bg-output";
  const start = await _executeBash(
    { command: "echo streamed", run_in_background: true },
    ctx(sessionId),
  );
  const shellId = (start.success && start.result.metadata?.shellId) as string;
  await untilSettled(sessionId, shellId);

  const first = await BashOutputTool.execute(
    { bash_id: shellId },
    ctx(sessionId),
  );
  assert.match(first.success ? first.result.output : "", /streamed/);
  assert.match(
    first.success ? first.result.output : "",
    /<status>completed<\/status>/,
  );

  const second = await BashOutputTool.execute(
    { bash_id: shellId },
    ctx(sessionId),
  );
  assert.match(second.success ? second.result.output : "", /no new output/);
  disposeShellRegistry(sessionId);
});

test("bashoutput on an unknown shell is a message, not a failure", async () => {
  const result = await BashOutputTool.execute(
    { bash_id: "bash_404" },
    ctx("bg-miss"),
  );
  assert.equal(result.success, true);
  assert.match(
    result.success ? result.result.output : "",
    /No background shell/,
  );
});

test("killbash stops a running shell and says so", async () => {
  const sessionId = "bg-kill";
  const start = await _executeBash(
    { command: "sleep 30", run_in_background: true },
    ctx(sessionId),
  );
  const shellId = (start.success && start.result.metadata?.shellId) as string;

  const killed = await KillBashTool.execute(
    { bash_id: shellId },
    ctx(sessionId),
  );
  assert.equal(killed.success && killed.result.metadata?.killed, true);
  // Buffered output outlives the process, so a crash is still diagnosable.
  const after = await BashOutputTool.execute(
    { bash_id: shellId },
    ctx(sessionId),
  );
  assert.match(
    after.success ? after.result.output : "",
    /<status>killed<\/status>/,
  );
  disposeShellRegistry(sessionId);
});

test("run_in_background without a session is refused, not silently foregrounded", async () => {
  const result = await _executeBash(
    { command: "echo x", run_in_background: true },
    { cwd: process.cwd(), abort: new AbortController().signal },
  );
  assert.equal(result.success, false);
  assert.match(result.success ? "" : result.error, /requires a session/);
});

test("disposeShellRegistry kills whatever the session left running", async () => {
  const sessionId = "bg-dispose";
  await _executeBash(
    { command: "sleep 30", run_in_background: true },
    ctx(sessionId),
  );
  disposeShellRegistry(sessionId);
  assert.equal(peekShellRegistry(sessionId), undefined);
});
