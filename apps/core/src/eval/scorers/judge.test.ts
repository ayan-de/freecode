import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseVerdict,
  renderJudgePrompt,
  scoreJudged,
} from "./judge.js";
import type { ToolSpan, Trace } from "../../rollout/trace.js";
import type { EvalCase, RunRecord } from "../types.js";

// Hermetic rubrics: `evalsDir()` is CWD-relative, and `tsx --test` runs from
// apps/core, so the shipped `evals/` is not where this process would look.
// Pointing at a tmpdir also keeps the test from breaking when the real rubric
// is reworded.
let tmpEvals: string;
let prevEvalsDir: string | undefined;

before(() => {
  tmpEvals = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-rubric-"));
  fs.mkdirSync(path.join(tmpEvals, "rubrics"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpEvals, "rubrics", "answer-quality.md"),
    "RUBRIC TEXT",
    "utf-8",
  );
  prevEvalsDir = process.env.FREECODE_EVALS_DIR;
  process.env.FREECODE_EVALS_DIR = tmpEvals;
});

after(() => {
  if (prevEvalsDir === undefined) delete process.env.FREECODE_EVALS_DIR;
  else process.env.FREECODE_EVALS_DIR = prevEvalsDir;
  fs.rmSync(tmpEvals, { recursive: true, force: true });
});

const tool = (name: string): ToolSpan => ({
  callSeq: 0,
  tool: name,
  startedAt: 0,
  duration_ms: 1,
});

const run = (toolSpans: ToolSpan[], response = "the reply"): RunRecord => ({
  trace: {
    sessionId: "s1",
    startedAt: 0,
    endedAt: 1,
    wall_ms: 1,
    modelSpans: [],
    toolSpans,
    model_ms: 1,
    tool_ms: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    hung: false,
    inFlight: false,
    redirects: 0,
    redirectsSkipped: 0,
  } as Trace,
  prompt: "what does gate.ts do?",
  response,
});

const kase: EvalCase = {
  id: "c",
  prompt: "what does gate.ts do?",
  rubric: "answer-quality",
};

test("parses the documented two-line format", () => {
  const v = parseVerdict("SCORE: 4\nWHY: accurate and specific");
  assert.equal(v.score, 4);
  assert.equal(v.reason, "accurate and specific");
});

test("parses the shapes models actually emit", () => {
  // However firmly you ask, you get markdown, dashes and bare numbers.
  assert.equal(parseVerdict("**SCORE:** 5\n**WHY:** perfect").score, 5);
  assert.equal(parseVerdict("Score - 3\nWhy - fine").score, 3);
  assert.equal(parseVerdict("score 2").score, 2);
  assert.equal(parseVerdict("4").score, 4);
});

test("an unparseable reply is a null score, not a zero", () => {
  // Zero is a real verdict meaning "actively unhelpful"; a judge that rambled
  // has told us nothing, and conflating the two would fail a good run.
  const v = parseVerdict("I think this is quite good overall, well done!");
  assert.equal(v.score, null);
  assert.match(v.reason, /unparseable/);
});

test("a score outside the scale is rejected, not clamped", () => {
  // A judge answering 8 on a five-point scale did not understand the task;
  // clamping to 5 would record its confusion as a perfect mark.
  assert.equal(parseVerdict("SCORE: 8").score, null);
  assert.equal(parseVerdict("SCORE: -1").score, null);
  assert.match(parseVerdict("SCORE: 8").reason, /out of range/);
});

test("the prompt gives the judge the tools that actually fired", () => {
  // §7 constraint 2 — the single most common false negative in agent judging
  // is a truthful "I read the file" being marked as a hallucination.
  const prompt = renderJudgePrompt(
    run([tool("read"), tool("grep")]),
    kase,
    "RUBRIC TEXT",
  );
  assert.match(prompt, /ground truth/);
  assert.match(prompt, /read, grep/);
  assert.match(prompt, /RUBRIC TEXT/);
});

test("repeated tools are collapsed with a count", () => {
  // A judge shown `read, read, read, read` starts grading the repetition,
  // which is the trajectory scorer's job.
  const prompt = renderJudgePrompt(
    run([tool("read"), tool("read"), tool("read")]),
    kase,
    "R",
  );
  assert.match(prompt, /read \(x3\)/);
});

test("a turn with no tools says so rather than leaving a blank", () => {
  assert.match(renderJudgePrompt(run([]), kase, "R"), /\(none\)/);
});

test("a provider outage is a null score, never a throw", () => {
  // §7 constraint 3: a harness that goes red because a third party 429'd
  // teaches the team to ignore red.
  return scoreJudged({
    run: run([]),
    kase,
    judge: { provider: "anthropic" },
    complete: async () => {
      throw new Error("503 upstream");
    },
  }).then((v) => {
    assert.equal(v.score, null);
    assert.match(v.reason, /judge unavailable/);
    assert.match(v.reason, /503/);
  });
});

test("a missing rubric file is a null score, not a crash", async () => {
  const v = await scoreJudged({
    run: run([]),
    kase: { ...kase, rubric: "does-not-exist" },
    judge: { provider: "anthropic" },
    complete: async () => ({ text: "SCORE: 5" }),
  });
  assert.equal(v.score, null);
  assert.match(v.reason, /no such rubric/);
});

test("a case with no rubric is not this scorer's business", async () => {
  const v = await scoreJudged({
    run: run([]),
    kase: { id: "c", prompt: "p" },
    judge: { provider: "anthropic" },
    complete: async () => ({ text: "SCORE: 5" }),
  });
  assert.equal(v.score, null);
  assert.equal(v.reason, "no rubric");
});

test("a real verdict comes back scored", async () => {
  const v = await scoreJudged({
    run: run([tool("read")]),
    kase,
    judge: { provider: "anthropic", model: "claude-haiku-4-5" },
    complete: async () => ({ text: "SCORE: 4\nWHY: names the file and the reason" }),
  });
  assert.equal(v.score, 4);
  assert.match(v.reason, /names the file/);
});

test("grading cost rides along with the verdict", async () => {
  const v = await scoreJudged({
    run: run([tool("read")]),
    kase,
    judge: { provider: "anthropic", model: "claude-haiku-4-5" },
    complete: async () => ({ text: "SCORE: 4\nWHY: fine", costUsd: 0.002 }),
  });
  assert.equal(v.costUsd, 0.002);
});

test("an unparseable reply still reports what it cost", async () => {
  // A judge that answered with garbage billed for it either way, and a cost
  // that vanishes on the error path understates the run.
  const v = await scoreJudged({
    run: run([tool("read")]),
    kase,
    judge: { provider: "anthropic", model: "claude-haiku-4-5" },
    complete: async () => ({ text: "I'd rather not", costUsd: 0.002 }),
  });
  assert.equal(v.score, null);
  assert.equal(v.costUsd, 0.002);
});

test("an outage has no cost to report", async () => {
  // `undefined`, not 0 — the same instinct as an unpriced model. A zero here
  // would read as "grading was free" rather than "grading did not happen".
  const v = await scoreJudged({
    run: run([tool("read")]),
    kase,
    judge: { provider: "anthropic", model: "claude-haiku-4-5" },
    complete: async () => {
      throw new Error("503 upstream");
    },
  });
  assert.equal(v.score, null);
  assert.equal(v.costUsd, undefined);
});
