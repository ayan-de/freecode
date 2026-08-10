import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/mem-store.js";
import { MemoryGraphService } from "../memory/graph/index.js";
import {
  dispatchApi,
  handleGraph,
  handleNode,
  handleSearch,
  writeApiResult,
  type NodeDetailResponse,
} from "./api.js";
import type { MemoryEntry } from "../memory/mem-types.js";

function mkEntry(name: string, opts: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    name,
    type: "project",
    description: "",
    content: name,
    createdAt: 0,
    updatedAt: 0,
    ...opts,
  };
}

// Make a service whose retrieval is deterministic — the cascade is what we
// want to exercise; embedding/keyword search adds nondeterminism.
function svc(): { service: MemoryGraphService; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gex-api-"));
  const service = new MemoryGraphService(new MemoryStore(dir));
  (service as unknown as { seed: () => Promise<unknown[]> }).seed =
    async () => [];
  return {
    service,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function fakeReq(method: string): import("http").IncomingMessage {
  return { method } as unknown as import("http").IncomingMessage;
}
function fakeRes(): import("http").ServerResponse {
  return {} as unknown as import("http").ServerResponse;
}

test("handleGraph returns empty arrays when the project has no memories", async () => {
  const { service, cleanup } = svc();
  try {
    const r = await handleGraph(fakeReq("GET"), fakeRes(), { service });
    assert.equal(r.status, 200);
    const body = (r as { body: unknown }).body as {
      nodes: unknown[];
      edges: unknown[];
      embedderAvailable: boolean;
    };
    assert.deepEqual(body.nodes, []);
    assert.deepEqual(body.edges, []);
    assert.equal(typeof body.embedderAvailable, "boolean");
  } finally {
    cleanup();
  }
});

test("handleGraph returns nodes and edges when memories exist", async () => {
  const { service, cleanup } = svc();
  const store = (service as unknown as { store: MemoryStore }).store;
  try {
    store.save(mkEntry("alpha"));
    store.save(mkEntry("beta"));
    const r = await handleGraph(fakeReq("GET"), fakeRes(), { service });
    assert.equal(r.status, 200);
    const body = (r as { body: unknown }).body as {
      nodes: Array<{ id: string; kind: string }>;
      edges: Array<{ from: string; to: string; kind: string }>;
    };
    assert.ok(body.nodes.length >= 2, "at least two memory nodes");
    assert.ok(
      body.nodes.every((n) => n.kind === "Memory" || n.kind === "Tag"),
      "every node kind is known",
    );
  } finally {
    cleanup();
  }
});

test("handleSearch rejects empty q with 400", async () => {
  const { service, cleanup } = svc();
  try {
    const url = new URL(`http://x/api/search?q=${encodeURIComponent("")}`);
    const r = await handleSearch(fakeReq("GET"), url, fakeRes(), { service });
    assert.equal(r.status, 400);
    assert.deepEqual((r as { body: { error: string } }).body, {
      error: "missing q parameter",
    });
  } finally {
    cleanup();
  }
});

test("handleSearch returns results with via edges for cascaded nodes", async () => {
  const { service, cleanup } = svc();
  const store = (service as unknown as { store: MemoryStore }).store;
  try {
    store.save(mkEntry("alpha"));
    store.save(mkEntry("beta"));
    // Force a non-empty seed pool so cascade actually has something to walk.
    (service as unknown as { seed: (q: string) => Promise<unknown[]> }).seed =
      async () => [{ id: "project/alpha", score: 1 }];
    const url = new URL(`http://x/api/search?q=${encodeURIComponent("alpha")}`);
    const r = await handleSearch(fakeReq("GET"), url, fakeRes(), { service });
    assert.equal(r.status, 200);
    const body = (r as { body: unknown }).body as {
      results: Array<{
        id: string;
        score: number;
        via: { from: string; edgeKind: string } | null;
      }>;
      seedMode: "vector" | "keyword";
    };
    assert.ok(body.results.length >= 1, "at least one result");
    // The seed itself (alpha) should have via === null; any cascaded result
    // should carry a `via` object with from + edgeKind.
    const alpha = body.results.find((x) => x.id === "project/alpha");
    assert.ok(alpha, "seed appears in results");
    assert.equal(alpha.via, null, "seeds have no via");
    const cascaded = body.results.find((x) => x.id !== "project/alpha");
    if (cascaded) {
      assert.ok(cascaded.via, "cascaded results have a via");
      assert.equal(typeof cascaded.via.from, "string");
      assert.equal(typeof cascaded.via.edgeKind, "string");
    }
    assert.ok(["vector", "keyword"].includes(body.seedMode));
  } finally {
    cleanup();
  }
});

test("dispatchApi routes /api/graph and /api/search; other paths → null", async () => {
  const { service, cleanup } = svc();
  try {
    const graphUrl = new URL("http://x/api/graph");
    const searchUrl = new URL("http://x/api/search?q=alpha");
    const otherUrl = new URL("http://x/index.html");
    assert.ok(
      await dispatchApi(fakeReq("GET"), graphUrl, fakeRes(), { service }),
      "/api/graph is routed",
    );
    assert.ok(
      await dispatchApi(fakeReq("GET"), searchUrl, fakeRes(), { service }),
      "/api/search is routed",
    );
    assert.equal(
      await dispatchApi(fakeReq("GET"), otherUrl, fakeRes(), { service }),
      null,
      "other paths are not routed",
    );
    assert.equal(
      await dispatchApi(
        { method: "POST" } as unknown as import("http").IncomingMessage,
        graphUrl,
        fakeRes(),
        { service },
      ),
      null,
      "non-GET methods are not routed",
    );
  } finally {
    cleanup();
  }
});

test("writeApiResult serializes the body and sets the right headers", () => {
  let captured: {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  } = {};
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      captured.headers = headers;
    },
    end(body: string) {
      captured.body = body;
    },
  } as unknown as import("http").ServerResponse;

  writeApiResult(res, {
    status: 200,
    body: { ok: true, n: 1 },
  });
  assert.equal(captured.status, 200);
  assert.match(captured.headers["Content-Type"] ?? "", /^application\/json/);
  assert.equal(captured.headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(captured.body ?? "").ok, true);
});

// -----------------------------------------------------------------------------
// /api/node — the endpoint that gives a clicked node something to show.
// -----------------------------------------------------------------------------

test("handleNode returns the stored memory behind a node", async () => {
  const { service, cleanup } = svc();
  try {
    const store = (service as unknown as { store: MemoryStore }).store;
    store.save(
      mkEntry("freecode-founder", {
        type: "user",
        description: "Builds freecode",
        content: "Ships releases from main.",
        tags: ["freecode", "founder"],
        createdAt: 1000,
        updatedAt: 2000,
      }),
    );
    await handleGraph(fakeReq("GET"), fakeRes(), { service });

    const r = handleNode(
      fakeReq("GET"),
      new URL("http://x/api/node?id=user/freecode-founder"),
      fakeRes(),
      { service },
    );
    assert.equal(r.status, 200);
    const body = (r as { body: NodeDetailResponse }).body;

    // The graph node itself carries only these three fields — the point of
    // the endpoint is everything below it.
    assert.equal(body.node.kind, "Memory");
    assert.equal(body.node.label, "freecode-founder");

    assert.ok(body.entry);
    assert.equal(body.entry!.description, "Builds freecode");
    assert.equal(body.entry!.content, "Ships releases from main.");
    // MemoryStore.load derives timestamps from the file's own birthtime/mtime
    // rather than frontmatter, so the saved values are not what comes back.
    assert.ok(body.entry!.createdAt > 0);
    assert.ok(body.entry!.updatedAt > 0);
    assert.deepEqual(body.entry!.tags, ["freecode", "founder"]);

    // Its tags are neighbours, so the panel can walk to them.
    const tagNeighbors = body.neighbors.filter((n) => n.kind === "Tag");
    assert.equal(tagNeighbors.length, 2);
    assert.equal(tagNeighbors[0].edge, "HasTag");
    assert.equal(tagNeighbors[0].direction, "out");
  } finally {
    cleanup();
  }
});

test("handleNode reports a tag node as a grouping with no entry", async () => {
  const { service, cleanup } = svc();
  try {
    const store = (service as unknown as { store: MemoryStore }).store;
    store.save(mkEntry("a", { tags: ["shared"] }));
    store.save(mkEntry("b", { tags: ["shared"] }));
    await handleGraph(fakeReq("GET"), fakeRes(), { service });

    const r = handleNode(
      fakeReq("GET"),
      new URL("http://x/api/node?id=tag:shared"),
      fakeRes(),
      { service },
    );
    assert.equal(r.status, 200);
    const body = (r as { body: NodeDetailResponse }).body;
    assert.equal(body.node.kind, "Tag");
    // A synthetic grouping has no stored content — the members are the value.
    assert.equal(body.entry, null);
    assert.equal(body.neighbors.filter((n) => n.kind === "Memory").length, 2);
  } finally {
    cleanup();
  }
});

test("handleNode 400s without an id and 404s on an unknown one", async () => {
  const { service, cleanup } = svc();
  try {
    const missingId = handleNode(
      fakeReq("GET"),
      new URL("http://x/api/node"),
      fakeRes(),
      { service },
    );
    assert.equal(missingId.status, 400);

    const unknown = handleNode(
      fakeReq("GET"),
      new URL("http://x/api/node?id=project/nope"),
      fakeRes(),
      { service },
    );
    assert.equal(unknown.status, 404);
  } finally {
    cleanup();
  }
});

test("dispatchApi routes /api/node", async () => {
  const { service, cleanup } = svc();
  try {
    const r = await dispatchApi(
      fakeReq("GET"),
      new URL("http://x/api/node?id=nope"),
      fakeRes(),
      { service },
    );
    assert.ok(r, "dispatch handled the path");
    assert.equal(r!.status, 404);
  } finally {
    cleanup();
  }
});
