import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  AUTHORABLE_MEMORY_TYPES,
  MEMORY_TYPES,
  parseMemoryFrontmatter,
  serializeMemoryEntry,
  type MemoryEntry,
} from "./mem-types.js";
import { MemoryStore } from "./mem-store.js";
import { renderRetrievedMemories } from "./mem-prompt.js";

function episode(name: string, happened_at?: string): MemoryEntry {
  return {
    name,
    type: "episode",
    description: `we decided ${name}`,
    content: `A one-sentence record of ${name}.`,
    createdAt: 0,
    updatedAt: 0,
    ...(happened_at ? { happened_at } : {}),
  };
}

test("episode is a memory type but not an authorable one", () => {
  assert.ok(MEMORY_TYPES.includes("episode"));
  assert.ok(
    !AUTHORABLE_MEMORY_TYPES.includes("episode"),
    "the model reads its history, it does not author it",
  );
});

test("happened_at survives a serialize/parse round trip", () => {
  const serialized = serializeMemoryEntry(episode("sse-timeout", "2026-08-23"));
  assert.match(serialized, /^happened_at: 2026-08-23$/m);
  assert.equal(
    parseMemoryFrontmatter(serialized).metadata.happened_at,
    "2026-08-23",
  );
});

test("a memory without happened_at is unchanged by the new field", () => {
  // Back-compatibility in exactly the way tags/supersedes were: absent means
  // undated, and every file written before this existed still parses.
  const legacy = [
    "---",
    "name: prefers-tables",
    "description: wants tables",
    "type: feedback",
    "---",
    "body",
  ].join("\n");
  const parsed = parseMemoryFrontmatter(legacy);
  assert.equal(parsed.metadata.happened_at, undefined);
  assert.equal(parsed.metadata.type, "feedback");
  assert.equal(parsed.content, "body");

  const noDate = serializeMemoryEntry({
    name: "x",
    type: "project",
    description: "d",
    content: "c",
    createdAt: 0,
    updatedAt: 0,
  });
  assert.ok(!noDate.includes("happened_at"), "field is omitted when absent");
});

test("a malformed happened_at is dropped rather than stored unparsed", () => {
  // A bad date reaching the decay maths would silently make an episode look
  // brand new or ancient, so it is refused at the boundary.
  for (const bad of ["yesterday", "2026-13-45", "08/23/2026", "2026-8-3"]) {
    const raw = [
      "---",
      "name: e",
      "description: d",
      "type: episode",
      `happened_at: ${bad}`,
      "---",
      "body",
    ].join("\n");
    assert.equal(
      parseMemoryFrontmatter(raw).metadata.happened_at,
      undefined,
      `"${bad}" must not parse`,
    );
  }
});

test("episodes round-trip through the store like any other type", () => {
  const projectPath = mkdtempSync(join(tmpdir(), "mem-episode-"));
  const store = new MemoryStore(projectPath);
  try {
    store.save(episode("sse-timeout", "2026-08-23"));
    const loaded = store.load("sse-timeout", "episode");
    assert.ok(loaded, "episode loads back");
    assert.equal(loaded.happened_at, "2026-08-23");
    assert.equal(loaded.type, "episode");
    assert.equal(
      store.list("episode").length,
      1,
      "and is listable by its type",
    );
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
  }
});

test("episodes render as one dated line, newest first, after everything else", () => {
  const rendered = renderRetrievedMemories([
    episode("older", "2026-01-05"),
    {
      name: "prefers-tables",
      type: "feedback",
      description: "wants tables",
      content: "full body here",
      createdAt: 0,
      updatedAt: 0,
    },
    episode("newer", "2026-08-23"),
  ]);

  assert.match(rendered, /## Episode/);
  const newerAt = rendered.indexOf("2026-08-23");
  const olderAt = rendered.indexOf("2026-01-05");
  assert.ok(newerAt > -1 && olderAt > -1, "both episodes render");
  assert.ok(newerAt < olderAt, "newest first");
  assert.ok(
    rendered.indexOf("## Feedback") < newerAt,
    "episodes come after the semantic sections",
  );
  assert.ok(
    !rendered.includes("A one-sentence record of newer."),
    "episodes never render a body — they are one sentence by construction",
  );
});

test("an undated episode still renders, labelled as undated", () => {
  const rendered = renderRetrievedMemories([episode("mystery")]);
  assert.match(rendered, /- undated — we decided mystery/);
});

// -- D6: decay, discounted by use ---------------------------------------------

const DAY = 86_400_000;

function dated(name: string, daysAgo: number): MemoryEntry {
  const when = new Date(Date.now() - daysAgo * DAY);
  return episode(name, when.toISOString().slice(0, 10));
}

test("an old episode ranks below a recent one for the same query", async () => {
  const { MemoryGraphService } = await import("./graph/index.js");
  const projectPath = mkdtempSync(join(tmpdir(), "mem-decay-"));
  const store = new MemoryStore(projectPath);
  const service = new MemoryGraphService(store);
  try {
    store.save(dated("ancient-decision", 400));
    store.save(dated("recent-decision", 3));

    const names = (await service.retrieve("decision", { limit: 10 })).map(
      (r) => r.name,
    );
    assert.ok(names.includes("recent-decision"), "both surface");
    assert.ok(names.includes("ancient-decision"));
    assert.ok(
      names.indexOf("recent-decision") < names.indexOf("ancient-decision"),
      "decay demotes the older episode",
    );
  } finally {
    service.dispose();
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
  }
});

test("a heavily used old episode outranks an unused recent one", async () => {
  // The assertion that justifies the use term existing at all (spec D6). If it
  // cannot be made to pass, the multiplier is decoration.
  const { MemoryGraphService } = await import("./graph/index.js");
  const projectPath = mkdtempSync(join(tmpdir(), "mem-decay-use-"));
  const store = new MemoryStore(projectPath);
  const service = new MemoryGraphService(store);
  try {
    const old = dated("load-bearing-decision", 400);
    const fresh = dated("forgettable-decision", 20);
    store.save(old);
    store.save(fresh);

    for (let i = 0; i < 200; i++) {
      service.recordCited(["episode/load-bearing-decision"], [old]);
    }

    const names = (await service.retrieve("decision", { limit: 10 })).map(
      (r) => r.name,
    );
    assert.ok(
      names.indexOf("load-bearing-decision") <
        names.indexOf("forgettable-decision"),
      "use outweighs age when the evidence is strong enough",
    );
  } finally {
    service.dispose();
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
  }
});

test("semantic memories are not decayed by age", async () => {
  const { MemoryGraphService } = await import("./graph/index.js");
  const projectPath = mkdtempSync(join(tmpdir(), "mem-no-decay-"));
  const store = new MemoryStore(projectPath);
  const service = new MemoryGraphService(store);
  try {
    // "User prefers tables" does not get less true. Demoting a durable fact for
    // being old is how a system forgets a standing instruction.
    store.save({
      name: "prefers-tables",
      type: "feedback",
      description: "wants comparisons as tables",
      content: "Render comparisons as markdown tables.",
      createdAt: Date.now() - 400 * DAY,
      updatedAt: Date.now() - 400 * DAY,
    });

    const results = await service.retrieve("tables", { limit: 5 });
    assert.equal(
      results[0]?.name,
      "prefers-tables",
      "still ranks first at 400 days old",
    );
  } finally {
    service.dispose();
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
  }
});
