import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RolloutRecorder } from "./recorder.js";
import type {
  FunctionDeniedEvent,
  FunctionOutputEvent,
  RolloutEvent,
} from "./types.js";

function readEvents(dir: string): RolloutEvent[] {
  return readFileSync(join(dir, "events.jsonl"), "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RolloutEvent);
}

test("seq resumes across recorder instances for the same session", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  try {
    const first = new RolloutRecorder("s1", { rolloutDir: dir });
    first.recordTurnStarted("turn-1");
    first.recordTurnStarted("turn-2");

    const second = new RolloutRecorder("s1", { rolloutDir: dir });
    second.recordTurnStarted("turn-3");

    assert.deepEqual(
      readEvents(dir).map((e) => e.seq),
      [1, 2, 3],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("function.output carries turnId and preserves falsy values", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  try {
    const recorder = new RolloutRecorder("s1", { rolloutDir: dir });
    recorder.recordFunctionOutput("read", "", 0, "turn-1");

    const [event] = readEvents(dir) as FunctionOutputEvent[];
    assert.equal(event.type, "function.output");
    assert.equal(event.turnId, "turn-1");
    assert.equal(event.output, "");
    assert.equal(event.duration_ms, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("model events round-trip every field through the JSONL log", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  try {
    const recorder = new RolloutRecorder("s1", { rolloutDir: dir });
    recorder.recordModelRequest("turn-2", {
      provider: "minimax",
      model: "MiniMax-M3",
      messageCount: 12,
      toolCount: 15,
      promptChars: 48_000,
      streamed: true,
    });
    recorder.recordModelFirstToken("turn-2", 1500);
    recorder.recordModelResponse("turn-2", {
      provider: "minimax",
      model: "MiniMax-M3",
      duration_ms: 4200,
      ttft_ms: 1500,
      inputTokens: 12_000,
      // 0 must survive: "the model emitted nothing" is a real, diagnostic value.
      outputTokens: 0,
      cacheReadTokens: 11_000,
      cacheWriteTokens: 0,
      toolCalls: ["bash", "read"],
      textChars: 0,
      thinkingChars: 320,
    });

    const [request, firstToken, response] = readEvents(dir) as Array<
      Record<string, unknown>
    >;
    assert.equal(request.type, "model.request");
    assert.equal(request.turnId, "turn-2");
    assert.equal(request.promptChars, 48_000);
    assert.equal(request.streamed, true);
    assert.equal(firstToken.type, "model.first_token");
    assert.equal(firstToken.ttft_ms, 1500);
    assert.equal(response.type, "model.response");
    assert.equal(response.duration_ms, 4200);
    assert.equal(response.outputTokens, 0);
    assert.deepEqual(response.toolCalls, ["bash", "read"]);
    // Sequence numbers keep the three lines orderable after the fact.
    assert.deepEqual([request.seq, firstToken.seq, response.seq], [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("model.error records the stall kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  try {
    const recorder = new RolloutRecorder("s1", { rolloutDir: dir });
    recorder.recordModelError("turn-0", {
      provider: "minimax",
      model: "MiniMax-M3",
      duration_ms: 120_000,
      kind: "stall",
      error: "Provider sent no response for 120s",
    });
    const [event] = readEvents(dir) as Array<Record<string, unknown>>;
    assert.equal(event.type, "model.error");
    assert.equal(event.kind, "stall");
    assert.equal(event.duration_ms, 120_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("function.denied records the tool, the gate, and the reason", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  try {
    const recorder = new RolloutRecorder("s1", { rolloutDir: dir });
    recorder.recordFunctionDenied(
      "edit",
      { filePath: "match.ts" },
      "mode",
      'Tool "edit" is not allowed in review mode (read-only)',
      "turn-3",
    );

    const [event] = readEvents(dir) as FunctionDeniedEvent[];
    assert.equal(event.type, "function.denied");
    assert.equal(event.tool, "edit");
    assert.equal(event.source, "mode");
    assert.equal(event.turnId, "turn-3");
    assert.deepEqual(event.args, { filePath: "match.ts" });
    assert.match(event.reason, /review mode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
