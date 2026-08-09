#!/usr/bin/env node
// =============================================================================
// analyze-session.mjs — replay a recorded session and report what it cost.
//
// Phase 0 of docs/superpowers/plans/2026-08-05-token-efficiency.md. Every later
// phase is verified by re-running this and comparing the headline number, so
// this script is the baseline — not a fix.
//
// It reads the persisted history (no API calls, no cost) and reconstructs what
// each provider request carried: one assistant message ≈ one response, and its
// input cost ≈ every message before it plus the system+tools block. Summing
// that over the session gives Σ input tokens, the number that matters.
//
// Usage:
//   node scripts/analyze-session.mjs <sessionId|path>
//   node scripts/analyze-session.mjs --compare <before> <after>
//   node scripts/analyze-session.mjs --list
//
// Flags:
//   --system-tokens <n>  system+tools block per request (default 12000)
//   --cluster-ms <n>     gap that separates two provider requests (default 1500)
//   --json               emit JSON instead of a table
// =============================================================================

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const SESSIONS_ROOT = join(homedir(), ".freecode", "sessions");

// Mirrors compaction/tokens.ts CHARS_PER_TOKEN. Deliberately the same heuristic
// the compaction trigger uses — this script measures the system as it is, not as
// it should be. See RC6 for why the estimate is wrong for images.
const CHARS_PER_TOKEN = 4;

// Mirrors tools/output-store/config.ts MAX_MODEL_OUTPUT_CHARS.
const MAX_MODEL_OUTPUT_CHARS =
  Number(process.env.FREECODE_OUTPUT_MAX_CHARS) || 30_000;

// One assistant message is not one request: the loop splits a single response
// carrying both text and a tool call into two history messages, written within
// milliseconds of each other. Messages closer together than this belong to the
// same provider round trip.
const DEFAULT_CLUSTER_MS = 1500;

// The system prompt + native tool schemas ride on every request but are not in
// messages.jsonl. Order-of-magnitude constant; override when it matters.
const DEFAULT_SYSTEM_TOKENS = 12_000;

// Below this many tool calls, "zero batched responses" carries no information:
// a session that made four calls may have had four genuinely dependent steps,
// and batching them would have been wrong. Flagging that as a failure sends
// someone off to fix a healthy session — the measurement equivalent of a false
// positive, and worse than staying quiet, because Phase 0 exists to be trusted.
const PARALLELISM_MIN_CALLS = 10;

// ---------------------------------------------------------------------------
// Repeat-work signal — Phase 0 of
// docs/superpowers/specs/2026-08-08-continual-harness-design.md ("Layer 1").
// The question this answers: does the agent redo work in this session that a
// continual harness (a durable note like "you already read this file" or
// "this command fails here, use X instead") could have prevented? Three
// sub-signals, each scoped to what messages.jsonl can actually prove rather
// than what would be nice to know — an inflated signal sends someone to build
// a feature that doesn't pay off; see PARALLELISM_MIN_CALLS above for why
// this script already treats that as worse than reporting nothing.
// ---------------------------------------------------------------------------

// A file re-read below this many times is normal iteration (re-check a file
// after editing it, look at it from two different angles) — only count it as
// signal once the same exact path comes back a third time.
const REPEAT_READ_MIN = 3;

// Mirrors agent/oscillation.ts RECENT_EDIT_WINDOW. Kept in sync by hand
// deliberately, not by import: this script has no build step and reads
// persisted history the way it actually was written, not the way the TS
// source happens to compile today — see the CHARS_PER_TOKEN comment above for
// the same reasoning applied to a different constant.
const RECENT_EDIT_WINDOW = 30;

// Exact literal error strings the loop writes into a tool-result message
// (agent/loop.ts:2428 persists `result.modelOutput || result.error || ""`).
// These come from tools/orchestrator.ts and tools/bash.ts and are matched as
// prefixes, not substrings — a command whose own stdout happens to contain
// the word "error" must not count. This catches hard tool-execution failures
// (permission denial, missing tool, timeout, spawn error). It does NOT catch
// a bash command's own non-zero exit: bash.ts resolves `{ success: true }`
// for any exit code and never writes it into the persisted string, only into
// `metadata.exitCode`, which is not part of `result`. The `<stderr>` marker
// below is the closest available proxy for that case, reported separately
// because it is weaker evidence.
const HARD_ERROR_PREFIXES = [
  "Permission denied: ",
  "Command timed out after ",
  "Error executing command: ",
];
const isHardToolError = (resultText) =>
  typeof resultText === "string" &&
  (HARD_ERROR_PREFIXES.some((p) => resultText.startsWith(p)) ||
    (resultText.startsWith("Tool '") && resultText.includes("' not found")));

// bash.ts:227-228 wraps stderr as `<stderr>\n...\n</stderr>` inside the
// otherwise-successful output. Its presence on a repeated command is weaker
// evidence than a hard error (some tools write warnings to stderr on
// success), so it is reported as a separate, explicitly softer number.
const hasStderr = (resultText) =>
  typeof resultText === "string" && resultText.includes("<stderr>");

// tools/edit.ts's own literal failure strings (:579,586,594). Its catch-block
// errors (:617,658) rethrow whatever the filesystem/apply step said and are
// not enumerable here — an edit that failed for one of those reasons is
// undercounted as "succeeded" for oscillation purposes. Accepted approximation,
// same spirit as HARD_ERROR_PREFIXES: better to undercount a rare case than to
// guess at arbitrary exception text and overcount.
const EDIT_ERROR_PREFIXES = [
  "oldString and newString are identical",
  "File not found: ",
  "Path is a directory: ",
];
const isFailedEdit = (resultText) =>
  typeof resultText === "string" &&
  EDIT_ERROR_PREFIXES.some((p) => resultText.startsWith(p));

// Port of agent/oscillation.ts toEditTransition/isRevert — same reasoning as
// RECENT_EDIT_WINDOW above for why this is copied rather than imported.
const hashSide = (value) => createHash("sha1").update(value).digest("hex");
const toEditTransition = (file, oldString, newString) => ({
  file,
  from: hashSide(oldString),
  to: hashSide(newString),
});
const isRevert = (recent, edit) => {
  if (edit.from === edit.to) return false;
  return recent.some(
    (prior) =>
      prior.file === edit.file &&
      prior.from === edit.to &&
      prior.to === edit.from,
  );
};

const tokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);

// ---------------------------------------------------------------------------
// Locating sessions
// ---------------------------------------------------------------------------

function listSessions() {
  if (!existsSync(SESSIONS_ROOT)) return [];
  const out = [];
  for (const project of readdirSync(SESSIONS_ROOT)) {
    const projectDir = join(SESSIONS_ROOT, project);
    if (!statSync(projectDir).isDirectory()) continue;
    for (const id of readdirSync(projectDir)) {
      const dir = join(projectDir, id);
      const messages = join(dir, "messages.jsonl");
      if (!existsSync(messages)) continue;
      out.push({ id, project, dir, bytes: statSync(messages).size });
    }
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

// Accepts a full path, a full session id, or an unambiguous id prefix.
function resolveSession(ref) {
  // A path may be given with or without a trailing slash; basename() keeps the
  // report label short either way.
  if (existsSync(join(ref, "messages.jsonl"))) {
    return { id: basename(ref.replace(/\/+$/, "")), project: "", dir: ref };
  }
  const matches = listSessions().filter(
    (s) => s.id === ref || s.id.startsWith(ref),
  );
  if (matches.length === 0)
    throw new Error(`no session matching "${ref}" under ${SESSIONS_ROOT}`);
  if (matches.length > 1 && !matches.some((s) => s.id === ref)) {
    throw new Error(
      `"${ref}" matches ${matches.length} sessions:\n` +
        matches.map((s) => `  ${s.id}`).join("\n"),
    );
  }
  return matches.find((s) => s.id === ref) ?? matches[0];
}

function readMeta(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8"));
  } catch {
    return {};
  }
}

// A truncated final write leaves an unparseable last line; skip it rather than
// refusing to analyze an otherwise complete session.
function readMessages(dir) {
  const lines = readFileSync(join(dir, "messages.jsonl"), "utf-8").split("\n");
  const messages = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      skipped++;
    }
  }
  return { messages, skipped };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyze(session, opts) {
  const { messages, skipped } = readMessages(session.dir);
  const meta = readMeta(session.dir);

  let userMessages = 0;
  let assistantMessages = 0;
  let imageParts = 0;
  const toolCallHistogram = new Map();
  const toolNames = new Map();
  const resultSizes = [];

  // Walked in order: `history` is what the next request would carry.
  let historyTokens = 0;
  let sumInputTokens = 0;
  let peakRequestTokens = 0;
  const assistantTimestamps = [];

  // Provider-reported usage, present on at most one message per response.
  const reported = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    responses: 0,
  };

  // Tool calls per *response*, which is the only sound way to measure
  // parallelism: appendToolMessage writes one message per tool call, so a
  // per-message count is capped at 1 by construction and would report "no
  // parallelism" no matter what the model did. Usage rides on the first
  // message of each response, so a usage-bearing message opens a group.
  const callsPerResponse = [];
  let currentResponse = null;
  const hasUsageAnywhere = messages.some((m) => m.usage);

  // Repeat-work signal (Phase 0, see constants block above).
  const readCounts = new Map(); // filePath -> times read
  const bashByCommand = new Map(); // command -> { count, hardErrors, stderrHits }
  const recentEdits = [];
  let oscillationScore = 0;

  for (const msg of messages) {
    const partsChars = JSON.stringify(msg.parts ?? []).length;

    if (msg.usage) {
      reported.responses++;
      reported.input += msg.usage.inputTokens ?? 0;
      reported.output += msg.usage.outputTokens ?? 0;
      reported.cacheRead += msg.usage.cacheReadInputTokens ?? 0;
      reported.cacheWrite += msg.usage.cacheCreationInputTokens ?? 0;
      currentResponse = { calls: 0 };
      callsPerResponse.push(currentResponse);
    }
    if (currentResponse) {
      currentResponse.calls += (msg.parts ?? []).filter(
        (p) => p.type === "tool",
      ).length;
    }

    if (msg.role === "assistant") {
      assistantMessages++;
      assistantTimestamps.push(msg.timestamp ?? 0);

      // Cost of the request that produced this message: everything before it.
      //
      // Charged once per *response*, not per message. One response is
      // persisted as several messages, so summing per message inflated the
      // estimate ~2x (169 messages against 76 real responses on the session
      // that exposed this). When usage is recorded, response starts are known
      // exactly; otherwise fall back to per-message and accept the error.
      const requestTokens = historyTokens + opts.systemTokens;
      const chargeable = hasUsageAnywhere ? msg.usage !== undefined : true;
      if (chargeable) sumInputTokens += requestTokens;
      peakRequestTokens = Math.max(peakRequestTokens, requestTokens);

      let calls = 0;
      for (const part of msg.parts ?? []) {
        if (part.type !== "tool") continue;
        calls++;
        const name = part.tool?.name ?? "<unknown>";
        toolNames.set(name, (toolNames.get(name) ?? 0) + 1);
        if (typeof part.result === "string")
          resultSizes.push(part.result.length);

        const args = part.tool?.args ?? {};
        const result = part.result;

        if (name === "read" && typeof args.filePath === "string") {
          readCounts.set(args.filePath, (readCounts.get(args.filePath) ?? 0) + 1);
        }

        if (name === "bash" && typeof args.command === "string") {
          const entry = bashByCommand.get(args.command) ?? {
            count: 0,
            hardErrors: 0,
            stderrHits: 0,
          };
          entry.count++;
          if (isHardToolError(result)) entry.hardErrors++;
          if (hasStderr(result)) entry.stderrHits++;
          bashByCommand.set(args.command, entry);
        }

        // Mirrors updateLoopHealth's part C (agent/loop.ts:2190-2217): only an
        // edit that undoes an earlier one on the same file scores, and a
        // failed edit changed nothing so it can't be part of a revert cycle.
        if (
          name === "edit" &&
          !isFailedEdit(result) &&
          typeof args.filePath === "string" &&
          typeof args.oldString === "string" &&
          typeof args.newString === "string"
        ) {
          const edit = toEditTransition(
            args.filePath,
            args.oldString,
            args.newString,
          );
          if (isRevert(recentEdits, edit)) oscillationScore++;
          recentEdits.push(edit);
          if (recentEdits.length > RECENT_EDIT_WINDOW) recentEdits.shift();
        }
      }
      toolCallHistogram.set(calls, (toolCallHistogram.get(calls) ?? 0) + 1);
    } else if (msg.role === "user") {
      userMessages++;
    }

    for (const part of msg.parts ?? []) {
      if (part.type === "image") imageParts++;
    }

    historyTokens += tokens(partsChars);
  }

  // Collapse assistant messages written within clusterMs of each other — those
  // are one response split across history entries, not two round trips.
  let requests = assistantTimestamps.length > 0 ? 1 : 0;
  for (let i = 1; i < assistantTimestamps.length; i++) {
    if (assistantTimestamps[i] - assistantTimestamps[i - 1] > opts.clusterMs)
      requests++;
  }

  const resultChars = resultSizes.reduce((a, b) => a + b, 0);
  const totalCalls = [...toolNames.values()].reduce((a, b) => a + b, 0);

  // Exact when usage is recorded; absent on sessions predating that.
  const responseHistogram = new Map();
  for (const r of callsPerResponse) {
    responseHistogram.set(r.calls, (responseHistogram.get(r.calls) ?? 0) + 1);
  }
  const multiCallResponses = callsPerResponse.filter(
    (r) => r.calls >= 2,
  ).length;
  const parallelismMeasurable = callsPerResponse.length > 0;

  // The number that decides whether prompt caching is working. Cache reads bill
  // at ~0.1x and writes at ~1.25x, so a session can send far more tokens than
  // another and still cost a fraction of it. Claude Code runs ~99% on real work.
  // `inputTokens` is the AI SDK's TOTAL input, cached tokens included --
  // `inputTokenDetails.noCacheTokens` is the uncached part. (Raw Anthropic is
  // the other way round: its `input_tokens` excludes the cached ones, which is
  // why a claude-code transcript shows a tiny input beside a huge cache_read.)
  // Adding cacheRead on top of inputTokens therefore double-counts every
  // cached token and roughly halves the apparent hit rate -- it reported 38%
  // on a session that was really running at ~99% on most turns.
  const billedInput = reported.input + reported.cacheWrite;
  const uncachedInput = Math.max(0, reported.input - reported.cacheRead);
  const cacheReadRatio =
    reported.input > 0 ? reported.cacheRead / reported.input : null;
  // Anthropic-style multipliers; approximate for other providers.
  const billedEquivalent =
    uncachedInput + reported.cacheRead * 0.1 + reported.cacheWrite * 1.25;

  // Repeat-work summary. See the constants block for what each number can
  // and cannot prove.
  const repeatedReads = [...readCounts.entries()]
    .filter(([, count]) => count >= REPEAT_READ_MIN)
    .sort((a, b) => b[1] - a[1]);
  const wastedReads = repeatedReads.reduce((sum, [, count]) => sum + count - 1, 0);

  const retriedBash = [...bashByCommand.entries()].filter(
    ([, e]) => e.count >= 2 && (e.hardErrors > 0 || e.stderrHits > 0),
  );
  const retriedAfterHardError = retriedBash.filter(([, e]) => e.hardErrors > 0);
  const retriedAfterStderr = retriedBash.filter(
    ([, e]) => e.hardErrors === 0 && e.stderrHits > 0,
  );

  return {
    id: session.id,
    title: meta.title ?? "",
    model: meta.model ?? "",
    provider: meta.provider ?? "",
    skippedLines: skipped,
    userMessages,
    assistantMessages,
    requests,
    requestsPerUserMessage: userMessages > 0 ? requests / userMessages : 0,
    toolCallHistogram: Object.fromEntries(
      [...toolCallHistogram].sort((a, b) => a[0] - b[0]),
    ),
    totalCalls,
    callsPerRequest: requests > 0 ? totalCalls / requests : 0,
    parallelismMeasurable,
    responseHistogram: Object.fromEntries(
      [...responseHistogram].sort((a, b) => a[0] - b[0]),
    ),
    multiCallResponses,
    responseCount: callsPerResponse.length,
    topTools: [...toolNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    finalHistoryTokens: historyTokens,
    peakRequestTokens,
    sumInputTokens,
    toolResultChars: resultChars,
    toolResultTokens: tokens(resultChars),
    resultsOverCap: resultSizes.filter((s) => s > MAX_MODEL_OUTPUT_CHARS)
      .length,
    largestResults: [...resultSizes].sort((a, b) => b - a).slice(0, 5),
    imageParts,
    reported,
    cacheReadRatio,
    billedInput,
    uncachedInput,
    billedEquivalent,
    repeatWork: {
      repeatedReads: repeatedReads.map(([path, count]) => ({ path, count })),
      wastedReads,
      retriedAfterHardError: retriedAfterHardError.map(([command, e]) => ({
        command,
        count: e.count,
      })),
      retriedAfterStderr: retriedAfterStderr.map(([command, e]) => ({
        command,
        count: e.count,
      })),
      oscillationScore,
    },
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const M = (n) => `${(n / 1e6).toFixed(1)}M`;
const K = (n) => `${(n / 1e3).toFixed(0)}K`;
const num = (n) => n.toLocaleString("en-US");

function report(a) {
  const label = [a.id.slice(0, 8), a.model, a.title].filter(Boolean).join("  ");
  console.log(`\n=== ${label} ===`);
  if (a.skippedLines > 0)
    console.log(`  (skipped ${a.skippedLines} unparseable line(s))`);

  console.log(`\n  Requests`);
  console.log(`    user messages           ${num(a.userMessages)}`);
  console.log(`    assistant messages      ${num(a.assistantMessages)}`);
  console.log(`    provider requests       ${num(a.requests)}`);
  console.log(
    `    requests / user message ${a.requestsPerUserMessage.toFixed(1)}`,
  );

  console.log(`\n  Parallelism   [RC2 signal]`);
  if (a.parallelismMeasurable) {
    const pct =
      a.responseCount > 0
        ? ((a.multiCallResponses / a.responseCount) * 100).toFixed(0)
        : "0";
    console.log(
      `    calls per response      ${JSON.stringify(a.responseHistogram)}`,
    );
    // Only call it a failure when the absence is evidence. See
    // PARALLELISM_MIN_CALLS.
    const verdict =
      a.multiCallResponses > 0
        ? ""
        : a.totalCalls >= PARALLELISM_MIN_CALLS
          ? "   <- no parallelism"
          : `   (${a.totalCalls} calls — too few to judge)`;
    console.log(
      `    responses with >= 2     ${num(a.multiCallResponses)} of ${num(a.responseCount)}  (${pct}%)` +
        verdict,
    );
  } else {
    // Per-message counts cannot exceed 1: appendToolMessage persists one
    // message per tool call. Only calls/request carries any signal here, and
    // it inherits the timestamp-clustering heuristic's error bars.
    console.log(`    exact measure unavailable — session predates usage`);
    console.log(`    recording; calls/request below is approximate`);
  }
  console.log(`    calls / request         ${a.callsPerRequest.toFixed(2)}`);
  if (a.topTools.length > 0) {
    console.log(
      `    top tools               ${a.topTools.map(([n, c]) => `${n}:${c}`).join("  ")}`,
    );
  }

  console.log(`\n  Repeat work   [Layer1-P0 signal]`);
  const rw = a.repeatWork;
  if (rw.repeatedReads.length > 0) {
    console.log(
      `    files re-read >= ${REPEAT_READ_MIN}x     ${num(rw.repeatedReads.length)}` +
        `  (${num(rw.wastedReads)} reads beyond the first)`,
    );
    for (const { path, count } of rw.repeatedReads.slice(0, 5)) {
      console.log(`      ${count}x  ${path}`);
    }
  } else {
    console.log(`    files re-read >= ${REPEAT_READ_MIN}x     0`);
  }
  if (rw.retriedAfterHardError.length > 0) {
    console.log(
      `    commands retried after error   ${num(rw.retriedAfterHardError.length)}   <- hard signal`,
    );
    for (const { command, count } of rw.retriedAfterHardError.slice(0, 5)) {
      console.log(`      ${count}x  ${command.split("\n")[0].slice(0, 60)}`);
    }
  }
  if (rw.retriedAfterStderr.length > 0) {
    console.log(
      `    commands retried w/ stderr     ${num(rw.retriedAfterStderr.length)}   (weaker signal — stderr isn't always failure)`,
    );
  }
  if (
    rw.retriedAfterHardError.length === 0 &&
    rw.retriedAfterStderr.length === 0
  ) {
    console.log(`    commands retried after error   0`);
  }
  console.log(
    `    oscillation score              ${num(rw.oscillationScore)}` +
      (rw.oscillationScore > 0 ? "   <- edit/revert/edit cycles" : ""),
  );

  console.log(`\n  Context`);
  console.log(`    final history           ${K(a.finalHistoryTokens)} tokens`);
  console.log(`    peak request            ${K(a.peakRequestTokens)} tokens`);
  if (a.reported.responses > 0) {
    // The provider's own count beats any reconstruction; keep the estimate
    // visible so a large gap flags a modelling error rather than hiding one.
    console.log(
      `    SUM input (reported)    ${M(a.billedInput)}   <- headline`,
    );
    console.log(`    SUM input (estimated)   ${M(a.sumInputTokens)}`);
  } else {
    console.log(
      `    SUM input (estimated)   ${M(a.sumInputTokens)}   <- headline`,
    );
  }

  console.log(`\n  Prompt cache (provider-reported)`);
  if (a.reported.responses === 0) {
    console.log(`    no usage recorded — session predates usage persistence,`);
    console.log(`    or the provider returns no usage metadata at all`);
  } else {
    console.log(`    responses with usage   ${num(a.reported.responses)}`);
    console.log(`    total input            ${num(a.reported.input)}`);
    console.log(`    cache read             ${num(a.reported.cacheRead)}`);
    console.log(`    cache write            ${num(a.reported.cacheWrite)}`);
    console.log(`    uncached input         ${num(a.uncachedInput)}`);
    console.log(`    output                 ${num(a.reported.output)}`);
    if (a.cacheReadRatio === null) {
      console.log(`    cache read ratio       n/a (no input billed)`);
    } else {
      const pct = (a.cacheReadRatio * 100).toFixed(1);
      const verdict =
        a.cacheReadRatio >= 0.9
          ? "healthy"
          : a.cacheReadRatio >= 0.5
            ? "partial — prefix is being invalidated"
            : "BROKEN — almost nothing is being reused";
      console.log(`    cache read ratio       ${pct}%   ${verdict}`);
    }
    console.log(
      `    billed-equivalent      ${M(a.billedEquivalent)}   (read x0.1 + write x1.25)`,
    );
  }

  console.log(`\n  Tool results`);
  console.log(
    `    total                   ${num(a.toolResultChars)} chars (${K(a.toolResultTokens)} tokens)`,
  );
  console.log(
    `    over ${num(MAX_MODEL_OUTPUT_CHARS)}-char cap    ${num(a.resultsOverCap)}`,
  );
  if (a.largestResults.length > 0) {
    console.log(
      `    largest                 ${a.largestResults.map(num).join(", ")}`,
    );
  }
  if (a.imageParts > 0) {
    console.log(
      `    image parts             ${num(a.imageParts)}   [RC6: scored as chars/4]`,
    );
  }
}

function compare(before, after) {
  const rows = [
    ["provider requests", before.requests, after.requests, false],
    ["calls / request", before.callsPerRequest, after.callsPerRequest, true],
    [
      "final history (tok)",
      before.finalHistoryTokens,
      after.finalHistoryTokens,
      false,
    ],
    [
      "peak request (tok)",
      before.peakRequestTokens,
      after.peakRequestTokens,
      false,
    ],
    ["SUM input tokens", before.sumInputTokens, after.sumInputTokens, false],
    // Already a percentage, so the change is reported in percentage points —
    // a relative change from a 0% baseline is undefined, and 0% -> 99% is the
    // single most important result this table can show.
    [
      "cache read ratio %",
      (before.cacheReadRatio ?? 0) * 100,
      (after.cacheReadRatio ?? 0) * 100,
      true,
      "pp",
    ],
    [
      "billed-equivalent",
      before.billedEquivalent,
      after.billedEquivalent,
      false,
    ],
    [
      "wasted re-reads",
      before.repeatWork.wastedReads,
      after.repeatWork.wastedReads,
      false,
    ],
    [
      "commands retried/error",
      before.repeatWork.retriedAfterHardError.length,
      after.repeatWork.retriedAfterHardError.length,
      false,
    ],
    [
      "oscillation score",
      before.repeatWork.oscillationScore,
      after.repeatWork.oscillationScore,
      false,
    ],
  ];

  console.log(
    `\n=== ${before.id.slice(0, 8)}  ->  ${after.id.slice(0, 8)} ===\n`,
  );
  console.log(
    `  ${"metric".padEnd(22)}${"before".padStart(14)}${"after".padStart(14)}${"change".padStart(12)}`,
  );
  console.log(`  ${"-".repeat(60)}`);
  for (const [name, b, a, higherIsBetter, unit] of rows) {
    const fmt = (v) => (Number.isInteger(v) ? num(v) : v.toFixed(2));
    // Percentage-point metrics subtract; everything else is a relative change,
    // guarded because an empty baseline would print Infinity and read as a win.
    const pct = unit === "pp" ? a - b : b === 0 ? null : ((a - b) / b) * 100;
    const delta =
      pct === null
        ? "n/a"
        : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}${unit === "pp" ? "pp" : "%"}`;
    // Under half a percent is noise, not a result — don't award it a verdict.
    const flat = pct !== null && Math.abs(pct) < 0.5;
    const verdict =
      pct === null || flat
        ? ""
        : (higherIsBetter ? a > b : a < b)
          ? "better"
          : "worse";
    console.log(
      `  ${name.padEnd(22)}${fmt(b).padStart(14)}${fmt(a).padStart(14)}` +
        `${delta.padStart(10)}  ${verdict}`,
    );
  }
  console.log(
    `\n  Note: only comparable across sessions doing similar work. Prefer re-running` +
      `\n  the same task; a smaller number on an easier task is not a win.\n`,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    const value = Number(argv[i + 1]);
    if (!Number.isFinite(value)) throw new Error(`${name} expects a number`);
    argv.splice(i, 2);
    return value;
  };

  const asJson = argv.includes("--json");
  if (asJson) argv.splice(argv.indexOf("--json"), 1);

  const opts = {
    systemTokens: flag("--system-tokens", DEFAULT_SYSTEM_TOKENS),
    clusterMs: flag("--cluster-ms", DEFAULT_CLUSTER_MS),
  };

  if (argv.includes("--list")) {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log(`No sessions under ${SESSIONS_ROOT}`);
      return;
    }
    console.log(`${sessions.length} session(s), largest first:\n`);
    for (const s of sessions.slice(0, 25)) {
      const meta = readMeta(s.dir);
      const size = `${(s.bytes / 1024).toFixed(0)}K`.padStart(6);
      console.log(
        `  ${s.id}  ${size}  ${meta.model ?? ""}  ${meta.title ?? ""}`,
      );
    }
    return;
  }

  const compareIdx = argv.indexOf("--compare");
  if (compareIdx !== -1) {
    const [beforeRef, afterRef] = argv.slice(compareIdx + 1, compareIdx + 3);
    if (!beforeRef || !afterRef)
      throw new Error("--compare needs two session refs");
    const before = analyze(resolveSession(beforeRef), opts);
    const after = analyze(resolveSession(afterRef), opts);
    if (asJson) {
      console.log(JSON.stringify({ before, after }, null, 2));
      return;
    }
    report(before);
    report(after);
    compare(before, after);
    return;
  }

  const ref = argv[0];
  if (!ref) {
    console.error(
      "Usage: node scripts/analyze-session.mjs <sessionId|path> [--compare a b] [--list]",
    );
    process.exit(1);
  }

  const result = analyze(resolveSession(ref), opts);
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else report(result);
}

try {
  main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
