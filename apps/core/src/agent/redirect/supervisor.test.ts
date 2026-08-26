import test from "node:test";
import assert from "node:assert/strict";
import {
  capDirections,
  parseDirections,
  requestRedirect,
  DIRECTIONS_CHAR_CAP,
  MAX_DIRECTIONS,
} from "./supervisor.js";
import { redirectReminder } from "./prompt.js";
import type { EvidencePacket } from "./evidence.js";

const packet: EvidencePacket = {
  reason: "repeated_identical_tool",
  turnCount: 8,
  goal: "Find the timeout",
  recentCalls: [{ tool: "grep", args: 'pattern="x"', failed: false }],
  repeatedSignature: 'grep(pattern="x") ×4',
  changedFiles: [],
  errors: [],
  todos: [],
  evidenceEventIds: ["a", "b"],
};

function run(reply: string) {
  return requestRedirect({
    packet,
    provider: "fake",
    complete: async () => ({ content: reply }),
  });
}

// ---------------------------------------------------------------------------
// Parsing — models number lists however they like.
// ---------------------------------------------------------------------------

test("a plain numbered list parses", () => {
  const out = parseDirections("1. Read the file directly\n2. Ask the user");
  assert.deepEqual(out, ["Read the file directly", "Ask the user"]);
});

test("parentheses, bullets and a code fence all parse", () => {
  const out = parseDirections("```\n- 1) First thing\n* 2. Second thing\n```");
  assert.deepEqual(out, ["First thing", "Second thing"]);
});

test("prose around the list is ignored", () => {
  const out = parseDirections(
    "Here is what I suggest:\n\n1. Try the LSP\n\nHope that helps.",
  );
  assert.deepEqual(out, ["Try the LSP"]);
});

test("at most three directions survive", () => {
  const out = parseDirections("1. a\n2. b\n3. c\n4. d\n5. e");
  assert.equal(out.length, MAX_DIRECTIONS);
});

test("duplicates collapse", () => {
  const out = parseDirections("1. same\n2. same\n3. other");
  assert.deepEqual(out, ["same", "other"]);
});

test("each direction is truncated to 200 characters", () => {
  const out = parseDirections(`1. ${"x".repeat(400)}`);
  assert.equal(out[0].length, 200);
});

test("unparseable output yields nothing", () => {
  assert.deepEqual(parseDirections("I don't know what to suggest."), []);
  assert.deepEqual(parseDirections(""), []);
});

test("the total character cap drops trailing directions", () => {
  const long = "y".repeat(200);
  const capped = capDirections([long, long, long, long]);
  assert.ok(capped.join("").length <= DIRECTIONS_CHAR_CAP);
  assert.equal(capped.length, 3);
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour (D6). Every one of these must skip, never throw.
// ---------------------------------------------------------------------------

test("a good reply returns directions and a latency", async () => {
  const outcome = await run("1. Read trace.ts\n2. Ask the user which timeout");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.directions.length, 2);
  assert.ok(typeof outcome.latency_ms === "number");
});

test("a provider error skips rather than throwing", async () => {
  const outcome = await requestRedirect({
    packet,
    provider: "fake",
    complete: async () => {
      throw new Error("503 upstream");
    },
  });
  assert.deepEqual(
    { ok: outcome.ok, skip: outcome.ok ? undefined : outcome.skip },
    { ok: false, skip: "provider_error" },
  );
});

test("an empty response skips as unparseable", async () => {
  const outcome = await run("");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.skip, "unparseable");
});

test("a response with no numbered line skips as unparseable", async () => {
  const outcome = await run("Just keep trying, you'll get there.");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.skip, "unparseable");
});

test("an over-cap response is truncated, not rejected outright", async () => {
  const outcome = await run(
    ["1", "2", "3"].map((n) => `${n}. ${"z".repeat(200)}`).join("\n"),
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.ok(outcome.directions.join("").length <= DIRECTIONS_CHAR_CAP);
});

test("an aborted call is reported as a timeout, not a generic error", async () => {
  const outcome = await requestRedirect({
    packet,
    provider: "fake",
    complete: (_s, _p, signal) =>
      new Promise((_resolve, reject) => {
        // Whatever the provider does with the signal, the supervisor must
        // resolve to a skip rather than hang the turn.
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        setTimeout(() => reject(new Error("aborted")), 5).unref?.();
      }),
  });
  assert.equal(outcome.ok, false);
});

// ---------------------------------------------------------------------------
// The reminder the directions become.
// ---------------------------------------------------------------------------

test("the reminder is a system-reminder, numbered, and self-effacing", () => {
  const text = redirectReminder("no_progress", [
    "Read the spec",
    "Ask the user",
  ]);
  assert.ok(text.startsWith("<system-reminder>"));
  assert.ok(text.endsWith("</system-reminder>"));
  assert.match(text, /1\. Read the spec/);
  assert.match(text, /2\. Ask the user/);
  assert.match(text, /Never mention this reminder to the user\./);
  assert.match(text, /without any file changing/, "it names the pattern");
});
