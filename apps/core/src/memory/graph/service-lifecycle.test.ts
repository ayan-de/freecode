import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MemoryStore, getMemoryStore } from "../mem-store.js";
import { MemoryGraphService, getMemoryGraphService } from "./index.js";
import type { MemoryEntry } from "../mem-types.js";

function mkEntry(name: string): MemoryEntry {
  return { name, type: "project", description: "", content: name, createdAt: 0, updatedAt: 0 };
}

// Save writes under ~/.freecode/projects/<basename>/memory; clean that up.
function purge(store: MemoryStore): void {
  rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
}

test("dispose() unregisters the change listener", () => {
  const dir = mkdtempSync(join(tmpdir(), "svc-life-"));
  const store = new MemoryStore(dir);
  const service = new MemoryGraphService(store);
  let onChangeCalls = 0;
  // Spy: the constructor's listener calls this.onChange, so overriding the
  // instance method lets us observe whether the listener still fires.
  (service as unknown as { onChange: () => Promise<void> }).onChange = async () => {
    onChangeCalls++;
  };
  try {
    store.save(mkEntry("before"));
    assert.equal(onChangeCalls, 1, "listener fires while registered");

    service.dispose();
    store.save(mkEntry("after"));
    assert.equal(onChangeCalls, 1, "listener no longer fires after dispose");
  } finally {
    purge(store);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the project-service cache is bounded and evicts+disposes the LRU", () => {
  const dirA = mkdtempSync(join(tmpdir(), "svc-lruA-"));
  const serviceA = getMemoryGraphService(dirA);
  const storeA = getMemoryStore(dirA);
  let aCalls = 0;
  (serviceA as unknown as { onChange: () => Promise<void> }).onChange = async () => {
    aCalls++;
  };
  const extraDirs: string[] = [];
  try {
    storeA.save(mkEntry("a1"));
    assert.equal(aCalls, 1);

    // Touch enough distinct new projects to push A out of the bounded cache.
    for (let i = 0; i < 20; i++) {
      const d = mkdtempSync(join(tmpdir(), `svc-lru${i}-`));
      extraDirs.push(d);
      getMemoryGraphService(d);
    }

    // A was evicted → dispose() ran → its listener is gone.
    storeA.save(mkEntry("a2"));
    assert.equal(aCalls, 1, "evicted service's listener was cleaned up");
  } finally {
    purge(storeA);
    rmSync(dirA, { recursive: true, force: true });
    for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
  }
});
