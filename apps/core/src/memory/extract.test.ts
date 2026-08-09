import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { extractMemories, MAX_SAVES_PER_RUN } from "./extract.js";
import { getMemoryStore } from "./mem-store.js";
import { bus } from "../bus/index.js";

function fixture(): { projectPath: string; cleanup: () => void } {
  const projectPath = mkdtempSync(join(tmpdir(), "mem-extract-"));
  const memDir = getMemoryStore(projectPath).getMemoryDir();
  return {
    projectPath,
    cleanup: () => {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(dirname(memDir), { recursive: true, force: true });
    },
  };
}

function proposal(name: string) {
  return {
    type: "project",
    name,
    description: `about ${name}`,
    content: `content for ${name}`,
  };
}

const TRANSCRIPT = "user: we always deploy on Fridays\nassistant: noted";

test("saves proposals up to the per-run cap and drops the rest", async () => {
  const { projectPath, cleanup } = fixture();
  try {
    const five = [1, 2, 3, 4, 5].map((i) => proposal(`fact-${i}`));
    const saved = await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      complete: async () => JSON.stringify(five),
    });

    assert.equal(saved, MAX_SAVES_PER_RUN);
    assert.equal(getMemoryStore(projectPath).list().length, MAX_SAVES_PER_RUN);
  } finally {
    cleanup();
  }
});

test("a throwing completion is swallowed and saves nothing", async () => {
  const { projectPath, cleanup } = fixture();
  try {
    const saved = await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      complete: async () => {
        throw new Error("provider exploded");
      },
    });
    assert.equal(saved, 0);
    assert.equal(getMemoryStore(projectPath).list().length, 0);
  } finally {
    cleanup();
  }
});

test("malformed output saves nothing and does not throw", async () => {
  const { projectPath, cleanup } = fixture();
  try {
    const saved = await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      complete: async () => "I could not find anything worth saving, sorry!",
    });
    assert.equal(saved, 0);
  } finally {
    cleanup();
  }
});

test("an empty transcript never calls the provider", async () => {
  const { projectPath, cleanup } = fixture();
  try {
    let called = false;
    const saved = await extractMemories({
      transcript: "   ",
      projectPath,
      provider: "anthropic",
      complete: async () => {
        called = true;
        return "[]";
      },
    });
    assert.equal(called, false);
    assert.equal(saved, 0);
  } finally {
    cleanup();
  }
});

test("a proposal carrying a secret is skipped, its siblings still save", async () => {
  const { projectPath, cleanup } = fixture();
  try {
    const saved = await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      complete: async () =>
        JSON.stringify([
          {
            type: "reference",
            name: "deploy-key",
            description: "the deploy key",
            content: "key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
          },
          proposal("safe-fact"),
        ]),
    });

    assert.equal(saved, 1);
    const names = getMemoryStore(projectPath)
      .list()
      .map((e) => e.name);
    assert.deepEqual(names, ["safe-fact"]);
  } finally {
    cleanup();
  }
});

test("proposals fenced in a markdown code block are still parsed", async () => {
  const { projectPath, cleanup } = fixture();
  try {
    const saved = await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      complete: async () =>
        "Here is what I found:\n\n```json\n" +
        JSON.stringify([proposal("fenced")]) +
        "\n```\n",
    });
    assert.equal(saved, 1);
  } finally {
    cleanup();
  }
});

test("proposals with an unknown type or missing fields are skipped", async () => {
  const { projectPath, cleanup } = fixture();
  try {
    const saved = await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      complete: async () =>
        JSON.stringify([
          { type: "notes", name: "a", description: "d", content: "c" },
          { type: "project", name: "b", description: "d" },
          proposal("valid"),
        ]),
    });
    assert.equal(saved, 1);
  } finally {
    cleanup();
  }
});

// Writing notes about someone without telling them is the wrong default, so
// the bus notice is part of the contract, not a nicety.
function captureMemorySaved(): { events: unknown[]; stop: () => void } {
  const events: unknown[] = [];
  const stop = bus.subscribeAll((e) => {
    if ((e as { type: string }).type === "memory.saved") events.push(e);
  });
  return { events, stop };
}

test("announces saved memories on the bus so the user is told", async () => {
  const { projectPath, cleanup } = fixture();
  const cap = captureMemorySaved();
  try {
    await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      sessionId: "S1",
      complete: async () => JSON.stringify([proposal("deploy-cadence")]),
    });
    assert.equal(cap.events.length, 1);
    assert.deepEqual(cap.events[0], {
      type: "memory.saved",
      sessionId: "S1",
      memories: [{ type: "project", name: "deploy-cadence" }],
    });
  } finally {
    cap.stop();
    cleanup();
  }
});

test("stays silent when nothing was saved", async () => {
  const { projectPath, cleanup } = fixture();
  const cap = captureMemorySaved();
  try {
    await extractMemories({
      transcript: TRANSCRIPT,
      projectPath,
      provider: "anthropic",
      sessionId: "S1",
      complete: async () => "[]",
    });
    assert.equal(cap.events.length, 0, "an empty extraction must not notify");
  } finally {
    cap.stop();
    cleanup();
  }
});
