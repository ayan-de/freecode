// =============================================================================
// `METHODS` is described as the source of truth for the IPC surface
// (CLAUDE.md). It was not one: it declared roughly half the implemented
// handlers, so all of memory.*, config.*, models.* and eight session ops got
// zero compile-time checking in frontends — a frontend could call
// `session.fork` with the wrong params and find out at runtime.
//
// This test is what makes the claim true. Adding a handler without declaring
// it now fails here.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { METHODS } from "@thisisayande/freecode-shared";
import { methodHandlers } from "../server.js";

test("every implemented handler is declared in METHODS", () => {
  const declared = new Set(Object.keys(METHODS));
  const undeclared = Object.keys(methodHandlers).filter(
    (name) => !declared.has(name),
  );
  assert.deepEqual(
    undeclared,
    [],
    `handlers missing from METHODS: ${undeclared.join(", ")}`,
  );
});

test("every declared method is implemented", () => {
  const implemented = new Set(Object.keys(methodHandlers));
  const missing = Object.keys(METHODS).filter((name) => !implemented.has(name));
  assert.deepEqual(
    missing,
    [],
    `METHODS declares methods with no handler: ${missing.join(", ")}`,
  );
});
