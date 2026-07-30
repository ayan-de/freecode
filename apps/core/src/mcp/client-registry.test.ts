import test from "node:test";
import assert from "node:assert/strict";
import {
  registerClient,
  getClient,
  getClientTimeout,
  removeClient,
  listClients,
} from "./client-registry.js";

const fakeClient = { close: async () => {} } as never;

test("registerClient stores the client and its timeout", () => {
  registerClient("a", fakeClient, 9000);
  try {
    assert.equal(getClient("a"), fakeClient as unknown);
    assert.equal(getClientTimeout("a"), 9000);
    assert.ok(listClients().includes("a"));
  } finally {
    removeClient("a");
  }
});

test("getClientTimeout defaults to 30000 for unknown or timeout-less servers", () => {
  assert.equal(getClientTimeout("nope"), 30000);
  registerClient("b", fakeClient); // no timeout arg
  try {
    assert.equal(getClientTimeout("b"), 30000);
  } finally {
    removeClient("b");
  }
});

test("removeClient clears the entry", () => {
  registerClient("c", fakeClient, 1000);
  removeClient("c");
  assert.equal(getClient("c"), undefined);
  assert.ok(!listClients().includes("c"));
});
