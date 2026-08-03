// =============================================================================
// Unit tests for the resumable ring buffer (spec §4.2).
//
// Verifies seq assignment, replay, gap detection, and the count+bytes bound.
// =============================================================================

import { strict as assert } from "assert";
import { describe, it } from "node:test";
import {
  StreamBuffer,
  STREAM_BUFFER_LIMITS,
} from "./stream-buffer.js";

describe("web/stream-buffer", () => {
  describe("push / currentSeq", () => {
    it("assigns monotonic seq starting at 1", () => {
      const b = new StreamBuffer("s1");
      assert.equal(b.push({ type: "text", content: "a" }), 1);
      assert.equal(b.push({ type: "text", content: "b" }), 2);
      assert.equal(b.push({ type: "text", content: "c" }), 3);
      assert.equal(b.currentSeq, 3);
    });

    it("currentSeq is 0 for an empty buffer", () => {
      const b = new StreamBuffer("s1");
      assert.equal(b.currentSeq, 0);
    });
  });

  describe("replayFrom", () => {
    it("returns events with seq > afterSeq", () => {
      const b = new StreamBuffer("s1");
      b.push({ id: 1 });
      b.push({ id: 2 });
      b.push({ id: 3 });
      const r = b.replayFrom(1);
      assert.equal(r.gap, false);
      if (r.gap) return;
      assert.deepEqual(
        r.events.map((e) => (e as { id: number }).id),
        [2, 3],
      );
      assert.equal(r.from, 2);
      assert.equal(r.to, 3);
    });

    it("returns empty when afterSeq is the latest", () => {
      const b = new StreamBuffer("s1");
      b.push({ id: 1 });
      b.push({ id: 2 });
      const r = b.replayFrom(2);
      assert.equal(r.gap, false);
      if (r.gap) return;
      assert.equal(r.events.length, 0);
    });

    it("returns a gap when afterSeq is older than the oldest kept", () => {
      const b = new StreamBuffer("s1", { maxEvents: 3 });
      for (let i = 0; i < 10; i++) b.push({ id: i + 1 });
      // After maxEvents=3, the buffer holds ids 8, 9, 10. Request replay
      // from id=5 — that's older than 8 (the oldest in the buffer).
      const r = b.replayFrom(5);
      assert.equal(r.gap, true);
      if (!r.gap) return;
      assert.equal(r.from, 6);
      assert.equal(r.to, 7);
    });

    it("treats an empty buffer as 'up to date'", () => {
      const b = new StreamBuffer("s1");
      const r = b.replayFrom(0);
      assert.equal(r.gap, false);
      if (r.gap) return;
      assert.equal(r.events.length, 0);
    });
  });

  describe("bounds", () => {
    it("evicts the oldest event past maxEvents", () => {
      const b = new StreamBuffer("s1", { maxEvents: 3 });
      b.push({ id: 1 });
      b.push({ id: 2 });
      b.push({ id: 3 });
      b.push({ id: 4 });
      // Client had seq=1 (the first event). Replay from 1 should give
      // events 2, 3, 4 — all still in the buffer.
      const r = b.replayFrom(1);
      assert.equal(r.gap, false);
      if (r.gap) return;
      assert.deepEqual(
        r.events.map((e) => (e as { id: number }).id),
        [2, 3, 4],
      );
    });

    it("evicts past the byte ceiling", () => {
      // maxBytes: 100, maxEvents generous so the byte cap binds.
      const b = new StreamBuffer("s1", {
        maxEvents: 100,
        maxBytes: 100,
      });
      // Each push is a small payload of ~7 bytes ({"id":0}).
      // After enough pushes, the byte cap evicts the oldest.
      for (let i = 0; i < 20; i++) b.push({ id: i });
      // The buffer's oldest kept seq is well past 1, so asking for a replay
      // from seq=0 surfaces a gap that spans the evicted range.
      const r = b.replayFrom(0);
      assert.equal(r.gap, true, "byte cap should have evicted events past the front");
      if (!r.gap) return;
      // from=1 (the first seq assigned, evicted) and to is the seq just
      // before the oldest kept one — verify to > 1 means at least one event
      // was evicted.
      assert.equal(r.from, 1);
      assert.ok(r.to > 1, "byte cap should have evicted at least one event");
    });

    it("returns a gap when afterSeq falls off the front of the buffer", () => {
      const b = new StreamBuffer("s1", { maxEvents: 3 });
      for (let i = 0; i < 5; i++) b.push({ id: i + 1 });
      // Buffer holds ids 3, 4, 5. A client reconnecting with lastSeq=1
      // (older than the oldest, which is 3) gets a gap.
      const r = b.replayFrom(1);
      assert.equal(r.gap, true);
      if (!r.gap) return;
      assert.equal(r.from, 2);
      assert.equal(r.to, 2);
    });

    it("does not over-evict when under both bounds", () => {
      const b = new StreamBuffer("s1", {
        maxEvents: 10,
        maxBytes: 4096,
      });
      for (let i = 0; i < 5; i++) b.push({ id: i });
      // Client had seq=0 (just connected, no events yet). Replay from 0
      // should give all 5 events since they all fit.
      const r = b.replayFrom(0);
      assert.equal(r.gap, false);
      if (r.gap) return;
      assert.equal(r.events.length, 5);
    });
  });

  describe("dispose", () => {
    it("drops all buffered events", () => {
      const b = new StreamBuffer("s1");
      b.push({ id: 1 });
      b.push({ id: 2 });
      b.dispose();
      const r = b.replayFrom(0);
      assert.equal(r.gap, false);
      if (r.gap) return;
      assert.equal(r.events.length, 0);
    });
  });

  describe("limits", () => {
    it("exports reasonable defaults", () => {
      assert.equal(STREAM_BUFFER_LIMITS.DEFAULT_MAX_EVENTS, 1000);
      assert.equal(STREAM_BUFFER_LIMITS.DEFAULT_MAX_BYTES, 4 * 1024 * 1024);
    });
  });
});
