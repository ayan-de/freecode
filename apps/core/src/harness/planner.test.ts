import test from "node:test";
import assert from "node:assert/strict";
import {
  planDistillation,
  parseDistillProposal,
  MAX_EDITS_PER_PROPOSAL,
} from "./planner.js";
import { emptyHarnessState } from "./store.js";

const VALID_PROPOSAL = JSON.stringify({
  summary: "Learned the test command",
  rationale: "Corrected twice",
  expectedOutcome: "Uses pnpm next time",
  edits: [
    {
      action: "create",
      kind: "prompt",
      title: "Use pnpm",
      content: "This repo uses pnpm, not npm.",
    },
  ],
});

test("parseDistillProposal parses a bare JSON object", () => {
  const proposal = parseDistillProposal(VALID_PROPOSAL);
  assert.equal(proposal.edits.length, 1);
  assert.equal(proposal.edits[0].title, "Use pnpm");
});

test("parseDistillProposal parses a fenced JSON block", () => {
  const proposal = parseDistillProposal(
    `Here is my analysis:\n\n\`\`\`json\n${VALID_PROPOSAL}\n\`\`\`\n\nDone.`,
  );
  assert.equal(proposal.edits.length, 1);
});

test("parseDistillProposal brace-slices JSON wrapped in prose without a fence", () => {
  const proposal = parseDistillProposal(
    `Sure, here's the proposal: ${VALID_PROPOSAL} Hope that helps!`,
  );
  assert.equal(proposal.edits.length, 1);
});

test("parseDistillProposal diagnoses a truncated (unterminated string) response distinctly from malformed JSON", () => {
  const truncated = '{"summary": "cut off mid-str';
  assert.throws(
    () => parseDistillProposal(truncated),
    /output budget exhausted/,
  );
});

test("parseDistillProposal diagnoses truncation mid-array (unbalanced brackets) the same way", () => {
  const truncated = '{"summary": "s", "edits": [{"action": "create"';
  assert.throws(
    () => parseDistillProposal(truncated),
    /output budget exhausted/,
  );
});

test("parseDistillProposal reports a distinct error for genuinely malformed (but complete) JSON", () => {
  const malformed = "{not: valid, json: at, all}";
  assert.throws(
    () => parseDistillProposal(malformed),
    (err) => {
      return (
        err instanceof Error && !err.message.includes("output budget exhausted")
      );
    },
  );
});

test("parseDistillProposal returns an empty edits array when the model says nothing is justified", () => {
  const proposal = parseDistillProposal(
    JSON.stringify({
      summary: "Nothing durable here",
      rationale: "One-off task",
      expectedOutcome: "",
      edits: [],
    }),
  );
  assert.equal(proposal.edits.length, 0);
  assert.equal(proposal.summary, "Nothing durable here");
});

test("parseDistillProposal drops an edit with an unrecognized kind rather than throwing", () => {
  const proposal = parseDistillProposal(
    JSON.stringify({
      summary: "s",
      rationale: "r",
      expectedOutcome: "o",
      edits: [
        { action: "create", kind: "not-a-real-kind", title: "t", content: "c" },
      ],
    }),
  );
  assert.equal(proposal.edits.length, 0);
});

test("parseDistillProposal hard-caps edits at MAX_EDITS_PER_PROPOSAL even if the model proposes more", () => {
  const manyEdits = Array.from(
    { length: MAX_EDITS_PER_PROPOSAL + 20 },
    (_, i) => ({
      action: "create",
      kind: "prompt",
      title: `note ${i}`,
      content: `content ${i}`,
    }),
  );
  const proposal = parseDistillProposal(
    JSON.stringify({
      summary: "s",
      rationale: "r",
      expectedOutcome: "o",
      edits: manyEdits,
    }),
  );
  assert.equal(proposal.edits.length, MAX_EDITS_PER_PROPOSAL);
});

test("planDistillation returns an empty-edits proposal for an empty transcript, without calling complete", async () => {
  let called = false;
  const proposal = await planDistillation({
    transcript: "   ",
    state: emptyHarnessState(),
    scope: "local",
    provider: "mock",
    complete: async () => {
      called = true;
      return { text: VALID_PROPOSAL, truncated: false };
    },
  });
  assert.equal(called, false);
  assert.equal(proposal.edits.length, 0);
});

test("planDistillation returns the parsed proposal from a real (mocked) call", async () => {
  const proposal = await planDistillation({
    transcript: "user: always use pnpm\nassistant: got it, using pnpm now",
    state: emptyHarnessState(),
    scope: "local",
    provider: "mock",
    complete: async () => ({ text: VALID_PROPOSAL, truncated: false }),
  });
  assert.equal(proposal.edits.length, 1);
  assert.equal(proposal.edits[0].title, "Use pnpm");
});

test("planDistillation never throws when complete() reports truncation — falls back to an empty proposal", async () => {
  const proposal = await planDistillation({
    transcript: "some transcript",
    state: emptyHarnessState(),
    scope: "local",
    provider: "mock",
    complete: async () => ({ text: '{"summary": "cut off', truncated: true }),
  });
  assert.equal(proposal.edits.length, 0);
  assert.equal(proposal.summary, "Distillation failed");
});

test("planDistillation never throws when complete() itself rejects", async () => {
  const proposal = await planDistillation({
    transcript: "some transcript",
    state: emptyHarnessState(),
    scope: "local",
    provider: "mock",
    complete: async () => {
      throw new Error("provider is down");
    },
  });
  assert.equal(proposal.edits.length, 0);
});

test("planDistillation passes the requested scope through to the prompt so a global request is distinguishable", async () => {
  let sawGlobalInstruction = false;
  await planDistillation({
    transcript: "some transcript",
    state: emptyHarnessState(),
    scope: "global",
    provider: "mock",
    complete: async (_system, prompt) => {
      sawGlobalInstruction = prompt.includes("Requested scope: global");
      return { text: VALID_PROPOSAL, truncated: false };
    },
  });
  assert.equal(sawGlobalInstruction, true);
});
