import test from "node:test";
import assert from "node:assert/strict";
import { bus, BusEvents } from "./index.js";

test("stream events preserve per-session FIFO order", () => {
  const got: string[] = [];
  const off = bus.subscribeAll((e) => {
    if (e.type === "stream" && e.sessionId === "s1") {
      got.push((e.event as any).delta);
    }
  });
  try {
    ["a", "b", "c"].forEach((d) =>
      BusEvents.stream("s1", { type: "text_delta", delta: d }),
    );
  } finally {
    off();
  }
  assert.deepEqual(got, ["a", "b", "c"]);
});

test("a subscriber filtering by sessionId never sees another session's events", () => {
  const s1: unknown[] = [];
  const off = bus.subscribeAll((e) => {
    if (e.type === "stream" && e.sessionId === "s1") s1.push(e.event);
  });
  try {
    BusEvents.stream("s2", { type: "text_delta", delta: "x" });
  } finally {
    off();
  }
  assert.equal(s1.length, 0);
});
