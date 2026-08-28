import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listRuns,
  manifestPath,
  readManifest,
  requestCancel,
  runDir,
  updateManifest,
  writeManifest,
} from "./run-store.js";
import { DEFAULT_RUN_LIMITS, EMPTY_USAGE, type RunManifest } from "./types.js";

function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "freecode-runs-"));
  const previous = process.env.FREECODE_RUNS_HOME;
  process.env.FREECODE_RUNS_HOME = home;
  try {
    return fn(home);
  } finally {
    if (previous === undefined) delete process.env.FREECODE_RUNS_HOME;
    else process.env.FREECODE_RUNS_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

function manifest(over: Partial<RunManifest> = {}): RunManifest {
  return {
    runId: "run-1",
    status: "running",
    createdAt: 1000,
    projectPath: "/p",
    provider: "anthropic",
    limits: DEFAULT_RUN_LIMITS,
    usage: EMPTY_USAGE,
    turns: 0,
    verifyCommand: "pnpm test",
    taskCardCount: 0,
    ...over,
  };
}

test("a manifest round-trips", () => {
  withHome(() => {
    const m = manifest();
    writeManifest(m);
    assert.deepEqual(readManifest("run-1"), m);
  });
});

test("a missing manifest reads as null, not a throw", () => {
  withHome(() => {
    assert.equal(readManifest("nope"), null);
  });
});

test("an unparseable manifest reads as null", () => {
  withHome(() => {
    mkdirSync(runDir("broken"), { recursive: true });
    writeFileSync(manifestPath("broken"), "{ this is not json", "utf-8");
    assert.equal(readManifest("broken"), null);
  });
});

test("writing leaves no temp file behind", () => {
  withHome(() => {
    writeManifest(manifest());
    assert.ok(existsSync(manifestPath("run-1")));
    assert.ok(
      !existsSync(`${manifestPath("run-1")}.tmp`),
      "the tmp file is renamed, not left as debris",
    );
  });
});

test("listRuns returns newest first and skips unreadable directories", () => {
  withHome(() => {
    writeManifest(manifest({ runId: "old", createdAt: 1 }));
    writeManifest(manifest({ runId: "new", createdAt: 999 }));
    mkdirSync(runDir("junk"), { recursive: true });

    assert.deepEqual(
      listRuns().map((m) => m.runId),
      ["new", "old"],
    );
  });
});

test("listRuns on a machine that has never run one is empty, not an error", () => {
  withHome((home) => {
    rmSync(home, { recursive: true, force: true });
    assert.deepEqual(listRuns(), []);
  });
});

test("updateManifest reads from disk, so a stale caller cannot roll back progress", () => {
  withHome(() => {
    writeManifest(manifest({ turns: 0 }));

    // The detached run advances while a caller holds an old copy.
    writeManifest(manifest({ turns: 7, taskCardCount: 3 }));

    const updated = updateManifest("run-1", (m) => ({
      ...m,
      status: "completed",
    }));

    assert.equal(updated?.status, "completed");
    assert.equal(
      updated?.turns,
      7,
      "the run's own progress survived the update",
    );
    assert.equal(updated?.taskCardCount, 3);
  });
});

test("updating a manifest that is gone returns null rather than creating one", () => {
  withHome(() => {
    assert.equal(
      updateManifest("ghost", (m) => m),
      null,
    );
    assert.equal(readManifest("ghost"), null);
  });
});

test("cancellation is a flag on disk, checked later — never a signal", () => {
  withHome(() => {
    writeManifest(manifest());
    assert.equal(requestCancel("run-1"), true);

    const after = readManifest("run-1");
    assert.equal(after?.cancelRequested, true);
    assert.equal(
      after?.status,
      "running",
      "the run decides when it stops; the flag only asks",
    );
  });
});

test("cancelling an unknown run reports failure instead of pretending", () => {
  withHome(() => {
    assert.equal(requestCancel("ghost"), false);
  });
});
