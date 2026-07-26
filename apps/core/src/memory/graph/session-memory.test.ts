import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../mem-store.js";
import { MemoryGraphService } from "./index.js";
import type { MemoryEntry } from "../mem-types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkEntry(name: string): MemoryEntry {
  return {
    name,
    type: "project",
    description: "",
    content: name,
    createdAt: 0,
    updatedAt: 0,
  };
}

// Build a service whose retrieval is deterministic (no embedding model): each
// query yields a single memory named after the query, after an optional delay.
function svc(retrieveDelayMs = 0): {
  service: MemoryGraphService;
  cleanup: () => void;
  calls: string[];
} {
  const dir = mkdtempSync(join(tmpdir(), "sess-mem-"));
  const service = new MemoryGraphService(new MemoryStore(dir));
  const calls: string[] = [];
  (service as unknown as { retrieve: (q: string) => Promise<MemoryEntry[]> }).retrieve =
    async (q: string) => {
      calls.push(q);
      if (retrieveDelayMs > 0) await sleep(retrieveDelayMs);
      return [mkEntry(q)];
    };
  return { service, cleanup: () => rmSync(dir, { recursive: true, force: true }), calls };
}

const names = (m: MemoryEntry[]) => m.map((e) => e.name);

test("two sessions in one project never share a stash", async () => {
  const { service, cleanup } = svc();
  try {
    const a = await service.prepareMemories("A", "how does authentication work");
    const b = await service.prepareMemories("B", "what code style do we use");
    assert.deepEqual(names(a), ["how does authentication work"]);
    assert.deepEqual(names(b), ["what code style do we use"]);

    // Re-asking in A must still reflect A's topic, not B's.
    const a2 = await service.prepareMemories("A", "how does authentication work");
    assert.deepEqual(names(a2), ["how does authentication work"]);
  } finally {
    cleanup();
  }
});

test("cold turn returns freshly retrieved memories within budget", async () => {
  const { service, cleanup } = svc(0); // fast retrieval → lands within budget
  try {
    const first = await service.prepareMemories("S", "database schema");
    assert.deepEqual(names(first), ["database schema"]);
  } finally {
    cleanup();
  }
});

test("a topic change clears the stale set then refills", async () => {
  const { service, cleanup } = svc();
  try {
    const warm = await service.prepareMemories("S", "authentication flow tokens");
    assert.deepEqual(names(warm), ["authentication flow tokens"]);

    const switched = await service.prepareMemories("S", "editor keybindings and themes");
    assert.deepEqual(names(switched), ["editor keybindings and themes"]);
    assert.ok(!names(switched).includes("authentication flow tokens"));
  } finally {
    cleanup();
  }
});

test("slow retrieval: cold turn is empty, next turn is one-turn-behind filled", async () => {
  const { service, cleanup } = svc(200); // slower than COLD_BUDGET_MS
  try {
    const cold = await service.prepareMemories("S", "slow topic");
    assert.deepEqual(names(cold), [], "cold turn returns empty when retrieval exceeds budget");

    await sleep(300); // let the background retrieval land
    const warm = await service.prepareMemories("S", "slow topic");
    assert.deepEqual(names(warm), ["slow topic"], "next turn injects the now-ready set");
  } finally {
    cleanup();
  }
});

test("prepareMemories never throws and keeps the stash when retrieval fails", async () => {
  const { service, cleanup } = svc();
  try {
    const ok = await service.prepareMemories("S", "topic one");
    assert.deepEqual(names(ok), ["topic one"]);

    (service as unknown as { retrieve: () => Promise<MemoryEntry[]> }).retrieve =
      async () => {
        throw new Error("embedding blew up");
      };
    // Same query (warm) → returns existing stash; background failure swallowed.
    const after = await service.prepareMemories("S", "topic one");
    assert.deepEqual(names(after), ["topic one"]);
  } finally {
    cleanup();
  }
});

test("disposeSession drops a session's cache (next turn is cold again)", async () => {
  const { service, cleanup, calls } = svc();
  try {
    await service.prepareMemories("S", "q");
    service.disposeSession("S");
    calls.length = 0;
    await service.prepareMemories("S", "q");
    // A dropped cache means we retrieved again for the same query.
    assert.ok(calls.includes("q"));
  } finally {
    cleanup();
  }
});
