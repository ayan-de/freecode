import test from "node:test";
import assert from "node:assert/strict";
import type { MemoryEntry } from "../mem-types.js";
import { deriveGraph, graphSignature } from "./builder.js";

function mem(
  name: string,
  type: MemoryEntry["type"],
  content: string,
  extra: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    name,
    type,
    description: "",
    content,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

test("deriveGraph builds HasTag / RelatesTo / Supersedes edges", () => {
  const entries: MemoryEntry[] = [
    mem("db-choice", "project", "we use postgres; see [[deploy-flow]]", {
      tags: ["infra"],
    }),
    mem("deploy-flow", "reference", "deploys via github actions"),
    mem("db-choice-v2", "project", "now we use planetscale", {
      supersedes: ["db-choice"],
    }),
  ];

  const { nodes, edges } = deriveGraph(entries);

  assert.ok(nodes.find((n) => n.id === "tag:infra" && n.kind === "Tag"));
  const kinds = edges.map((e) => `${e.from}->${e.to}:${e.kind}`);
  assert.ok(kinds.includes("project/db-choice->tag:infra:HasTag"));
  assert.ok(kinds.includes("project/db-choice->reference/deploy-flow:RelatesTo"));
  assert.ok(kinds.includes("project/db-choice-v2->project/db-choice:Supersedes"));
});

test("deriveGraph skips dangling wikilinks", () => {
  const entries = [mem("a", "project", "points at [[nowhere]]")];
  const { edges } = deriveGraph(entries);
  assert.equal(
    edges.filter((e) => e.kind === "RelatesTo").length,
    0,
  );
});

test("graphSignature is stable and change-sensitive", () => {
  const a = [mem("a", "project", "x", { tags: ["t"] })];
  const b = [mem("a", "project", "x", { tags: ["t"] })];
  const c = [mem("a", "project", "x", { tags: ["t", "u"] })];
  assert.equal(graphSignature(a), graphSignature(b));
  assert.notEqual(graphSignature(a), graphSignature(c));
});
