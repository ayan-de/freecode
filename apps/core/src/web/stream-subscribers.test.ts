// =============================================================================
// Unit tests for the multi-subscriber /events fan-out.
//
// Verifies spec §4.3 — multiple concurrent subscribers, heartbeat, idle
// reaper, and shared-lifetime teardown. Uses fake res objects so the real
// write paths (and their false-return / destroyed-socket branches) are
// exercised without binding a port.
// =============================================================================

import { strict as assert } from "assert";
import { describe, it, afterEach } from "node:test";
import * as http from "http";
import {
  addSubscriber,
  publishToSession,
  publishToAll,
  subscriberCount,
  disposeSession,
  replayForSubscriber,
  currentSeq,
  runReaperForTests,
  STREAM_TIMINGS,
} from "./stream-subscribers.js";

/** A minimal stand-in for ServerResponse that records writes. */
function makeFakeRes(opts: { destroyed?: boolean; writeOk?: boolean } = {}): {
  res: http.ServerResponse;
  written: string[];
  destroy: () => void;
} {
  const written: string[] = [];
  let writeOk = opts.writeOk ?? true;
  const listeners: Record<string, (() => void)[]> = {};

  const fakeSocket = { destroyed: opts.destroyed ?? false };

  const res = {
    socket: fakeSocket,
    writableEnded: false,
    write(chunk: string) {
      written.push(chunk);
      if (!writeOk) return false;
      return true;
    },
    on(event: string, cb: () => void) {
      (listeners[event] ||= []).push(cb);
      return this;
    },
    emit(event: string) {
      for (const cb of listeners[event] ?? []) cb();
    },
  } as unknown as http.ServerResponse;

  return {
    res,
    written,
    destroy() {
      fakeSocket.destroyed = true;
    },
  };
}

function makeFakeReq(): http.IncomingMessage {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    on(event: string, cb: () => void) {
      (listeners[event] ||= []).push(cb);
      return this;
    },
    emit(event: string) {
      for (const cb of listeners[event] ?? []) cb();
    },
  } as unknown as http.IncomingMessage;
}

afterEach(() => {
  // Wipe state between tests by tearing down any sessions we created.
  for (const sessionId of ["s-A", "s-B", "s-C", "s-D", "s-E", "s-F"]) {
    disposeSession(sessionId);
  }
});

describe("web/stream-subscribers", () => {
  describe("addSubscriber / publishToSession", () => {
    it("fan-outs one wire event to every subscriber on the session", () => {
      const a = makeFakeRes();
      const b = makeFakeRes();
      addSubscriber("s-A", makeFakeReq(), a.res);
      addSubscriber("s-A", makeFakeReq(), b.res);

      publishToSession("s-A", { type: "text", content: "hi" });

      assert.equal(a.written.length, 1);
      assert.equal(b.written.length, 1);
      // SSE frame format: id: <seq>\ndata: <json>\n\n
      assert.match(a.written[0], /^id: 1\ndata: /);
      assert.match(a.written[0], /"content":"hi"/);
    });

    it("isolates subscribers across different sessions", () => {
      const a = makeFakeRes();
      const b = makeFakeRes();
      addSubscriber("s-A", makeFakeReq(), a.res);
      addSubscriber("s-B", makeFakeReq(), b.res);

      publishToSession("s-A", { type: "text", content: "only A" });

      assert.equal(a.written.length, 1);
      assert.equal(b.written.length, 0);
    });

    it("drops a subscriber whose socket is destroyed", () => {
      const sub = makeFakeRes({ destroyed: true });
      addSubscriber("s-B", makeFakeReq(), sub.res);
      assert.equal(subscriberCount("s-B"), 1);

      publishToSession("s-B", { type: "text", content: "drop me" });

      assert.equal(sub.written.length, 0, "destroyed subscriber should not receive");
      assert.equal(subscriberCount("s-B"), 0, "destroyed subscriber should be pruned");
    });

    it("drops a subscriber whose res.write returns false (backpressure)", () => {
      const sub = makeFakeRes({ writeOk: false });
      addSubscriber("s-C", makeFakeReq(), sub.res);
      assert.equal(subscriberCount("s-C"), 1);

      publishToSession("s-C", { type: "text", content: "backpressure" });

      // Subscriber is dropped from the registry on backpressure. The fake
      // still records the attempted write — that's the Node.js behavior
      // (write returns false because the kernel buffer is full, but the
      // chunk has been queued). We assert on the registry side, which is
      // what the spec guarantees: no further events reach this subscriber.
      assert.equal(subscriberCount("s-C"), 0);
    });

    it("continues delivering to other subscribers when one is removed mid-loop", () => {
      // The publish loop iterates a snapshot so a drop on sub A does not
      // disturb sub B's delivery.
      const a = makeFakeRes({ destroyed: true });
      const b = makeFakeRes();
      addSubscriber("s-D", makeFakeReq(), a.res);
      addSubscriber("s-D", makeFakeReq(), b.res);

      publishToSession("s-D", { type: "text", content: "ok" });

      assert.equal(b.written.length, 1);
    });
  });

  describe("publishToAll", () => {
    it("delivers to every subscriber on every session", () => {
      const a = makeFakeRes();
      const b = makeFakeRes();
      addSubscriber("s-E", makeFakeReq(), a.res);
      addSubscriber("s-F", makeFakeReq(), b.res);

      publishToAll({ type: "notice", level: "info", content: "hello" });

      assert.equal(a.written.length, 1);
      assert.equal(b.written.length, 1);
    });
  });

  describe("teardown", () => {
    it("drops the session record when disposeSession is called", () => {
      const sub = makeFakeRes();
      addSubscriber("s-A", makeFakeReq(), sub.res);
      assert.equal(subscriberCount("s-A"), 1);

      disposeSession("s-A");
      assert.equal(subscriberCount("s-A"), 0);
    });

    it("is idempotent when tearing down an unknown session", () => {
      // Must not throw.
      disposeSession("never-existed");
      assert.equal(subscriberCount("never-existed"), 0);
    });
  });

  // The P1 bug this covers: the record was disposed the moment the last
  // subscriber left, which for a single browser is every disconnect. The
  // reconnect then replayed "nothing was missed" and lost the whole gap.
  describe("reconnect after the last subscriber leaves", () => {
    it("replays events produced while nobody was attached", () => {
      const first = makeFakeRes();
      addSubscriber("s-C", makeFakeReq(), first.res);
      publishToSession("s-C", { type: "text", content: "before" });
      const seen = currentSeq("s-C");

      // The only browser goes away.
      first.destroy();
      first.res.emit("close");
      assert.equal(subscriberCount("s-C"), 0);

      // Work continues while disconnected.
      publishToSession("s-C", { type: "text", content: "while away" });

      const replay = replayForSubscriber("s-C", seen);
      assert.equal(replay.gap, false);
      assert.equal(replay.gap === false && replay.events.length, 1);
      assert.match(JSON.stringify(replay), /while away/);
    });

    it("reports a gap — never 'nothing missed' — once the record is reaped", () => {
      const sub = makeFakeRes();
      addSubscriber("s-D", makeFakeReq(), sub.res);
      publishToSession("s-D", { type: "text", content: "before" });
      sub.destroy();
      sub.res.emit("close");

      // Run one reaper pass at a clock past the record's TTL.
      runReaperForTests(Date.now() + STREAM_TIMINGS.RECORD_TTL_MS + 1);

      const replay = replayForSubscriber("s-D", 1);
      assert.equal(replay.gap, true, "a vanished buffer must report a gap");
    });

    it("keeps the record alive while a subscriber is still attached", () => {
      const a = makeFakeRes();
      const b = makeFakeRes();
      addSubscriber("s-E", makeFakeReq(), a.res);
      addSubscriber("s-E", makeFakeReq(), b.res);
      publishToSession("s-E", { type: "text", content: "x" });

      a.destroy();
      a.res.emit("close");
      runReaperForTests();

      assert.equal(subscriberCount("s-E"), 1);
      assert.equal(currentSeq("s-E"), 1, "buffer survives a partial disconnect");
    });

    it("a reconnect inside the window clears the TTL, so the record survives", () => {
      const a = makeFakeRes();
      addSubscriber("s-F", makeFakeReq(), a.res);
      publishToSession("s-F", { type: "text", content: "x" });
      a.destroy();
      a.res.emit("close");

      // Reconnect, then age the clock as far as the reaper can see.
      const b = makeFakeRes();
      addSubscriber("s-F", makeFakeReq(), b.res);
      runReaperForTests();

      assert.equal(subscriberCount("s-F"), 1);
      assert.equal(currentSeq("s-F"), 1);
    });
  });

  describe("timings", () => {
    it("exports heartbeat and idle constants", () => {
      assert.ok(STREAM_TIMINGS.HEARTBEAT_MS > 0);
      assert.ok(STREAM_TIMINGS.IDLE_TIMEOUT_MS > STREAM_TIMINGS.HEARTBEAT_MS);
      assert.ok(STREAM_TIMINGS.RECORD_TTL_MS > STREAM_TIMINGS.IDLE_TIMEOUT_MS);
    });
  });
});
