import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  cleanText,
  extractResponseText,
  findUpstreamError,
  textsInLine,
  DeltaFold,
} from "./parse.js";
import { sapisidHash } from "./protocol.js";

// A real response, captured live from the endpoint and scrubbed of ids. This is
// the regression net for the framing: fixtures cannot catch a format CHANGE
// (they are captures of the old format by definition), but they do catch us
// breaking the parser against the format we know.
const fixture = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "hello.txt",
  ),
  "utf-8",
);

/** One framing line, shaped like the real thing: 60 positional slots with the
 *  candidate list at index 4. Size matters — the parser rejects frames and
 *  payloads below a minimum length, because short ones carry only ids. */
function frame(text: string): string {
  const inner: unknown[] = new Array(60).fill(null);
  inner[1] = ["c_0000000000000000", "r_0000000000000000"];
  inner[4] = [["rc_0000000000000000", [text]]];
  return JSON.stringify([["wrb.fr", null, JSON.stringify(inner)]]);
}

test("extracts the reply from a real captured response", () => {
  assert.equal(extractResponseText(fixture), "OK");
});

test("ignores the length markers and the )]}' prologue", () => {
  // Every non-frame line must yield nothing, or a stray number becomes "text".
  for (const line of fixture.split("\n")) {
    if (!line.includes('"wrb.fr"')) assert.deepEqual(textsInLine(line), []);
  }
});

test("a malformed frame is skipped, not fatal", () => {
  // Frames repeat with the whole reply each time, so one bad frame costs
  // nothing — but throwing here would lose a reply that did arrive.
  assert.deepEqual(textsInLine(`[["wrb.fr",null,"${"x".repeat(300)}"]]`), []);
});

test("detects an upstream rejection carried inside a 200 body", () => {
  assert.match(
    findUpstreamError('junk BardErrorInfo [42] junk') ?? "",
    /BardErrorInfo \[42\]/,
  );
  assert.equal(findUpstreamError(fixture), undefined);
  assert.throws(() => extractResponseText("BardErrorInfo [7]"), /BardErrorInfo/);
});

test("strips Gemini's own code-execution and card artefacts", () => {
  const raw =
    "before\n```python?code_stdout&code_event_index=3\nnoise\n```\n" +
    "http://googleusercontent.com/card_content/9\nafter";
  assert.equal(cleanText(raw), "before\nafter");
});

test("DeltaFold emits only what each cumulative frame adds", () => {
  const fold = new DeltaFold();
  assert.equal(fold.push(frame("Hello")), "Hello");
  assert.equal(fold.push(frame("Hello, world")), ", world");
  // Frames repeat verbatim as the model writes; a repeat must emit nothing.
  assert.equal(fold.push(frame("Hello, world")), undefined);
  assert.equal(fold.text, "Hello, world");
});

test("DeltaFold refuses a reply that is not an extension of what was shown", () => {
  // An upstream retry restarts the answer. Emitting the new text would
  // contradict what the user already read, so this is an error, not a delta.
  const fold = new DeltaFold();
  fold.push(frame("Hello, world"));
  assert.throws(() => fold.push(frame("Completely different")), /restarted/);
});

test("sapisidHash is sha1 over '<seconds> <sapisid> <origin>'", () => {
  // Pinned so a refactor cannot quietly change the scheme into something that
  // authenticates as nothing and silently downgrades every user to anonymous.
  assert.equal(
    sapisidHash("SECRET", 1_700_000_000_000),
    "SAPISIDHASH 1700000000_6d548ecd684512833bd55ba3a2a9cc9c08bb02db",
  );
});
