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

  for (const msg of messages) {
    const partsChars = JSON.stringify(msg.parts ?? []).length;

    if (msg.usage) {
      reported.responses++;
      reported.input += msg.usage.inputTokens ?? 0;
      reported.output += msg.usage.outputTokens ?? 0;
      reported.cacheRead += msg.usage.cacheReadInputTokens ?? 0;
      reported.cacheWrite += msg.usage.cacheCreationInputTokens ?? 0;
    }

    if (msg.role === "assistant") {
      assistantMessages++;
      assistantTimestamps.push(msg.timestamp ?? 0);

      // Cost of the request that produced this message: everything before it.
      const requestTokens = historyTokens + opts.systemTokens;
      sumInputTokens += requestTokens;
      peakRequestTokens = Math.max(peakRequestTokens, requestTokens);

      let calls = 0;
      for (const part of msg.parts ?? []) {
        if (part.type !== "tool") continue;
        calls++;
        const name = part.tool?.name ?? "<unknown>";
        toolNames.set(name, (toolNames.get(name) ?? 0) + 1);
        if (typeof part.result === "string")
          resultSizes.push(part.result.length);
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
  const multiCallMessages = [...toolCallHistogram.entries()]
    .filter(([calls]) => calls >= 2)
    .reduce((sum, [, count]) => sum + count, 0);
  const totalCalls = [...toolNames.values()].reduce((a, b) => a + b, 0);

  // The number that decides whether prompt caching is working. Cache reads bill
  // at ~0.1x and writes at ~1.25x, so a session can send far more tokens than
  // another and still cost a fraction of it. Claude Code runs ~99% on real work.
  const billedInput = reported.input + reported.cacheRead + reported.cacheWrite;
  const cacheReadRatio =
    billedInput > 0 ? reported.cacheRead / billedInput : null;
  // Anthropic-style multipliers; approximate for other providers.
  const billedEquivalent =
    reported.input + reported.cacheRead * 0.1 + reported.cacheWrite * 1.25;

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
    multiCallMessages,
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
    billedEquivalent,
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

  console.log(`\n  Tool calls per assistant message   [RC2 signal]`);
  console.log(
    `    histogram               ${JSON.stringify(a.toolCallHistogram)}`,
  );
  console.log(`    calls / request         ${a.callsPerRequest.toFixed(2)}`);
  console.log(
    `    messages with >= 2      ${num(a.multiCallMessages)}` +
      (a.multiCallMessages === 0 ? "   <- no parallelism at all" : ""),
  );
  if (a.topTools.length > 0) {
    console.log(
      `    top tools               ${a.topTools.map(([n, c]) => `${n}:${c}`).join("  ")}`,
    );
  }

  console.log(`\n  Context`);
  console.log(`    final history           ${K(a.finalHistoryTokens)} tokens`);
  console.log(`    peak request            ${K(a.peakRequestTokens)} tokens`);
  console.log(
    `    SUM input tokens        ${M(a.sumInputTokens)}   <- headline`,
  );

  console.log(`\n  Prompt cache (provider-reported)`);
  if (a.reported.responses === 0) {
    console.log(`    no usage recorded — session predates usage persistence,`);
    console.log(`    or the provider returns no usage metadata at all`);
  } else {
    console.log(`    responses with usage   ${num(a.reported.responses)}`);
    console.log(`    cache read             ${num(a.reported.cacheRead)}`);
    console.log(`    cache write            ${num(a.reported.cacheWrite)}`);
    console.log(`    uncached input         ${num(a.reported.input)}`);
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
