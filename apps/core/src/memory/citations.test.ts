import test from "node:test";
import assert from "node:assert/strict";
import {
  CitationStreamFilter,
  parseCitations,
  stripCitations,
} from "./citations.js";

test("parses a well-formed tag and strips it from the visible text", () => {
  const r = parseCitations(
    "Use the keychain.\n<memory-used>project/auth-tokens-in-keychain</memory-used>",
  );
  assert.deepEqual(r.ids, ["project/auth-tokens-in-keychain"]);
  assert.equal(r.stripped, "Use the keychain.");
  assert.ok(!r.stripped.includes("memory-used"));
});

test("parses several ids and preserves their order", () => {
  const r = parseCitations("<memory-used>user/a, project/b, feedback/c</memory-used>");
  assert.deepEqual(r.ids, ["user/a", "project/b", "feedback/c"]);
});

test("no tag yields no ids and returns the text unchanged", () => {
  const text = "Just an ordinary answer.";
  const r = parseCitations(text);
  assert.deepEqual(r.ids, []);
  assert.equal(r.stripped, text);
});

test("a fenced tag is stripped along with its fence", () => {
  // Models fence the tag often enough that leaving an empty ``` behind would
  // be a visible artefact in every such reply.
  const r = parseCitations(
    "Done.\n\n```\n<memory-used>project/a</memory-used>\n```",
  );
  assert.deepEqual(r.ids, ["project/a"]);
  assert.equal(r.stripped, "Done.");
});

test("tolerates whitespace, a trailing period, and a repeated tag", () => {
  const r = parseCitations(
    "x <memory-used>  project/a .  </memory-used> y <memory-used>project/b</memory-used>",
  );
  assert.deepEqual(r.ids, ["project/a", "project/b"]);
  assert.equal(r.stripped, "x  y");
});

test("duplicate ids are counted once", () => {
  const r = parseCitations("<memory-used>project/a, project/a</memory-used>");
  assert.deepEqual(r.ids, ["project/a"]);
});

test("malformed ids are discarded while siblings survive", () => {
  const r = parseCitations(
    "<memory-used>project/a, not-an-id, /b, project/, project/c</memory-used>",
  );
  assert.deepEqual(r.ids, ["project/a", "project/c"]);
});

test("an empty tag is not an error, just no citation", () => {
  const r = parseCitations("answer\n<memory-used></memory-used>");
  assert.deepEqual(r.ids, []);
  assert.equal(r.stripped, "answer");
});

test("an unclosed tag is left alone rather than eating the reply", () => {
  // Truncation mid-tag must not silently delete the answer the user is reading.
  const text = "important answer <memory-used>project/a";
  const r = parseCitations(text);
  assert.deepEqual(r.ids, []);
  assert.ok(r.stripped.includes("important answer"));
});

test("stripCitations is idempotent", () => {
  const once = stripCitations("a\n<memory-used>project/x</memory-used>");
  assert.equal(stripCitations(once), once);
});

// -- The streaming filter -----------------------------------------------------
//
// These exist because a real turn against a real provider printed the tag while
// every parse test passed: stripping the FINAL text is too late, the deltas
// already reached the frontend.

function streamThrough(deltas: string[]): string {
  const f = new CitationStreamFilter();
  return deltas.map((d) => f.push(d)).join("") + f.flush();
}

test("the tag never reaches the user, even split across deltas", () => {
  // The failure mode from the smoke test: providers emit the marker a few
  // characters at a time, so no single delta contains it.
  assert.equal(
    streamThrough(["All done.\n", "<memory", "-used>", "project/a", "</memory-used>"]),
    "All done.\n",
  );
});

test("one-character-at-a-time streaming is also clean", () => {
  const text = "Answer.\n<memory-used>project/a</memory-used>";
  assert.equal(streamThrough([...text]), "Answer.\n");
});

test("ordinary text passes through byte-identical", () => {
  const deltas = ["Hello ", "world", ", how are you?"];
  assert.equal(streamThrough(deltas), "Hello world, how are you?");
});

test("a false start is released, not swallowed", () => {
  // "<mem" looks like the beginning of the marker and must be held — but if the
  // model was actually writing about <memory> the text has to come back.
  assert.equal(streamThrough(["see <mem", "ory> in the docs"]), "see <memory> in the docs");
  assert.equal(streamThrough(["trailing <mem"]), "trailing <mem");
});

test("text after the tag is suppressed too", () => {
  // The tag is instructed to come last; anything following it is the model
  // ignoring that, and showing it would look like a rendering glitch.
  assert.equal(
    streamThrough(["A.", "<memory-used>project/a</memory-used>", "  \n"]),
    "A.",
  );
});

test("the filter and the parser agree on the same stream", () => {
  const deltas = ["Body text. ", "<memory-used>", "project/a, user/b", "</memory-used>"];
  const raw = deltas.join("");
  assert.equal(streamThrough(deltas), "Body text. ");
  assert.deepEqual(parseCitations(raw).ids, ["project/a", "user/b"]);
});
