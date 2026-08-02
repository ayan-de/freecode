// =============================================================================
// Claude Code session scanner + transcript parser.
//
// Reads `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/<sessionId>.jsonl`
// (defaults to `~/.claude`), merges the optional `sessions-index.json` per
// project dir, and emits a `ClaudeSessionMeta[]` shape compatible with the
// frontend's resume picker. Read-only: we never write back to the user's
// Claude Code store.
//
// Adapted from `claude-config/src-tauri/src/storage/sessions.rs` (the same
// layout, ported to TS). The title-extraction strategy (head + tail 64KB
// windows, `customTitle` > `aiTitle` > `summary` > `firstPrompt`) is
// deliberately identical to the upstream Rust implementation so the two
// stay in sync.
//
// Public surface:
//   - `listClaudeSessions(opts)` — list rows for the picker.
//   - `readClaudeTranscript(opts, sessionId)` — convert a jsonl to
//     `SerializedMessage[]`.
//   - `getClaudeConfigDir(env)` — resolve the Claude root dir from
//     `$CLAUDE_CONFIG_DIR`.
// =============================================================================

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { randomUUID } from "crypto";
import type {
  ClaudeSessionMeta,
  SerializedMessage,
} from "@thisisayande/freecode-shared";

export type { ClaudeSessionMeta } from "@thisisayande/freecode-shared";

/**
 * Resolve the Claude Code config directory. Honors `$CLAUDE_CONFIG_DIR`
 * (matches upstream behavior); defaults to `~/.claude`. Tilde-expand is
 * not done here — Claude Code itself does not expand it; the env var is
 * expected to be absolute.
 */
export function getClaudeConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): string {
  const fromEnv = env.CLAUDE_CONFIG_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  return path.join(homedir, ".claude");
}

const PROJECTS_SUBDIR = "projects";
const SESSIONS_INDEX = "sessions-index.json";

/** Window size for the head/tail title-extraction scan. Matches upstream. */
const TITLE_SCAN_BYTES = 64 * 1024;

/** Cap on how many rows we surface per request. Matches upstream. */
const DEFAULT_LIMIT = 500;

/** Max title length; longer titles are truncated. Matches upstream. */
const TITLE_MAX_CHARS = 200;

/** Max messages kept across a transcript for the preview render. */
const TRANSCRIPT_MAX_MESSAGES = 160;

// =============================================================================
// Public options
// =============================================================================

export interface ClaudeListOptions {
  /** Optional path to the Claude Code root dir. Defaults to `getClaudeConfigDir()`. */
  claudeConfigDir?: string;
  /** Optional cwd filter. When set, only sessions whose `cwd` matches are returned. */
  projectPath?: string;
  /** Cap on returned rows. Defaults to 500. */
  limit?: number;
}

export interface ClaudeTranscriptOptions {
  /** Optional path to the Claude Code root dir. Defaults to `getClaudeConfigDir()`. */
  claudeConfigDir?: string;
  /** Absolute path to the jsonl transcript. Either this or `sessionId` must be set. */
  fullPath?: string;
  /** Bound on the number of messages returned. Defaults to 160. */
  maxMessages?: number;
}

// =============================================================================
// JSONL entry shapes (subset of what Claude Code writes)
// =============================================================================

/** Loose schema — the actual records carry many more fields we ignore. */
interface RawEntry {
  type?: string;
  cwd?: string;
  sessionId?: string;
  customTitle?: string;
  aiTitle?: string;
  summary?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  content?: unknown;
  model?: string;
  timestamp?: string;
}

// =============================================================================
// Session-index shape (Claude Code's optional pre-scan file)
// =============================================================================

interface SessionsIndex {
  version?: number;
  entries?: SessionIndexEntry[];
}

interface SessionIndexEntry {
  sessionId?: string;
  fullPath?: string;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  projectPath?: string;
  isSidechain?: boolean;
  model?: string;
}

// =============================================================================
// listClaudeSessions
// =============================================================================

/**
 * Walk `<claudeConfigDir>/projects/*` and return a list of session summaries,
 * newest-first. Returns `[]` if the projects dir does not exist (`~/.claude`
 * may not be present on a fresh machine — that is not an error).
 */
export async function listClaudeSessions(
  opts: ClaudeListOptions = {},
): Promise<ClaudeSessionMeta[]> {
  const root = opts.claudeConfigDir ?? getClaudeConfigDir();
  const projectsDir = path.join(root, PROJECTS_SUBDIR);

  if (!fs.existsSync(projectsDir)) return [];

  const projectDirs = await fsp.readdir(projectsDir, { withFileTypes: true });
  const seenIds = new Set<string>();
  const rows: ClaudeSessionMeta[] = [];

  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const projectDir = path.join(projectsDir, dirent.name);
    try {
      await mergeProjectInto(projectDir, seenIds, rows);
    } catch (err) {
      // Bad project dir must not poison the whole scan — log and skip.
      console.warn(`claude-sessions: skipping ${projectDir}: ${err}`);
    }
  }

  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const filtered =
    opts.projectPath !== undefined
      ? rows.filter((r) => r.projectPath === opts.projectPath)
      : rows;
  return filtered.slice(0, limit);
}

async function mergeProjectInto(
  projectDir: string,
  seen: Set<string>,
  out: ClaudeSessionMeta[],
): Promise<void> {
  const indexPath = path.join(projectDir, SESSIONS_INDEX);
  if (fs.existsSync(indexPath)) {
    await mergeIndexInto(indexPath, projectDir, seen, out);
  }
  // Fallback: scan jsonl files the index did not mention. Picks up
  // sessions Claude Code has started but not yet flushed to the index.
  for (const jsonl of await collectJsonlFiles(projectDir)) {
    const id = path.basename(jsonl, ".jsonl");
    if (seen.has(id)) continue;
    const row = await summaryFromJsonlStat(jsonl);
    if (row) {
      seen.add(id);
      out.push(row);
    }
  }
}

async function mergeIndexInto(
  indexPath: string,
  projectDir: string,
  seen: Set<string>,
  out: ClaudeSessionMeta[],
): Promise<void> {
  let raw: string;
  try {
    raw = await fsp.readFile(indexPath, "utf8");
  } catch (err) {
    console.warn(`claude-sessions: cannot read ${indexPath}: ${err}`);
    return;
  }
  let index: SessionsIndex;
  try {
    index = JSON.parse(raw) as SessionsIndex;
  } catch (err) {
    console.warn(`claude-sessions: malformed ${indexPath}: ${err}`);
    return;
  }
  const entries = index.entries ?? [];
  for (const entry of entries) {
    if (entry.isSidechain === true) continue;
    const id = entry.sessionId?.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const fullPath = entry.fullPath?.trim() || path.join(projectDir, `${id}.jsonl`);
    const transcriptCwd = await readCwdFromTranscript(fullPath);
    const title =
      (await extractTitleFromJsonl(fullPath)) ??
      pickTitle(entry.summary, entry.firstPrompt);
    const createdTs = parseTimestamp(entry.created);
    const modifiedTs = parseTimestamp(entry.modified);
    const updatedAt = modifiedTs ?? createdTs ?? (await safeMtime(fullPath)) ?? Date.now();
    const createdAt = createdTs ?? updatedAt;

    out.push({
      id,
      title,
      projectPath: entry.projectPath?.trim() || transcriptCwd || "",
      provider: "claude-code",
      model: entry.model,
      createdAt,
      updatedAt,
      lastTurnAt: updatedAt,
      turnCount: entry.messageCount ?? 0,
      fullPath,
    });
  }
}

async function summaryFromJsonlStat(
  fullPath: string,
): Promise<ClaudeSessionMeta | null> {
  if (!fs.existsSync(fullPath)) return null;
  const id = path.basename(fullPath, ".jsonl");
  const stat = await fsp.stat(fullPath);
  const updatedAt = stat.mtimeMs > 0 ? Math.floor(stat.mtimeMs) : Date.now();
  const createdAt = stat.birthtimeMs > 0 ? Math.floor(stat.birthtimeMs) : updatedAt;
  const transcriptCwd = await readCwdFromTranscript(fullPath);
  const projectSlug = path.basename(path.dirname(fullPath));
  const title =
    (await extractTitleFromJsonl(fullPath)) ?? `(unindexed) ${id}`;
  return {
    id,
    title,
    projectPath: transcriptCwd || decodeProjectSlug(projectSlug) || "",
    provider: "claude-code",
    createdAt,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: 0,
    fullPath,
  };
}

// =============================================================================
// readClaudeTranscript
// =============================================================================

/**
 * Read a Claude Code session's jsonl transcript and convert it to
 * `SerializedMessage[]`. The conversion is best-effort:
 *
 *   - user/assistant text parts → `text`
 *   - tool_use blocks → `tool` (name + input)
 *   - tool_result → dropped
 *   - image / attachment / hooks / mode / file-history / system → dropped
 *   - empty messages → dropped
 *
 * Bounded by `maxMessages` (default 160) so the IPC payload stays small.
 */
export async function readClaudeTranscript(
  sessionId: string,
  opts: ClaudeTranscriptOptions = {},
): Promise<SerializedMessage[]> {
  const fullPath = await resolveTranscriptPath(sessionId, opts);
  if (!fullPath) return [];

  const max = opts.maxMessages ?? TRANSCRIPT_MAX_MESSAGES;
  const out: SerializedMessage[] = [];
  const stream = fs.createReadStream(fullPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let truncated = false;
  for await (const line of rl) {
    if (out.length >= max) {
      truncated = true;
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: RawEntry;
    try {
      entry = JSON.parse(trimmed) as RawEntry;
    } catch {
      continue;
    }
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const parts = collectParts(entry);
    if (parts.length === 0) continue;
    const ts = parseTimestamp(entry.timestamp) ?? Date.now();
    out.push({
      id: randomUUID(),
      role,
      parts,
      timestamp: ts,
    });
  }

  if (truncated) {
    // Drain the stream so the file handle closes — we don't actually consume
    // those lines, but the consumer needs to see EOF.
    rl.close();
    stream.destroy();
  }
  return out;
}

/**
 * Resolve the absolute path to a session's jsonl. If `opts.fullPath` is
 * supplied, trust it. Otherwise, discover from the index.
 *
 * Discovery walks all project dirs and matches the sessionId basename.
 * This is O(projects) per call but only invoked when the frontend passes
 * only a sessionId (the resume picker will preview one session at a time,
 * so the worst case is one scan per Enter / preview fetch).
 */
async function resolveTranscriptPath(
  sessionId: string,
  opts: ClaudeTranscriptOptions,
): Promise<string | null> {
  const explicit = opts.fullPath?.trim();
  if (explicit) return explicit;
  const root = opts.claudeConfigDir ?? getClaudeConfigDir();
  const projectsDir = path.join(root, PROJECTS_SUBDIR);
  if (!fs.existsSync(projectsDir)) return null;
  const dirs = await fsp.readdir(projectsDir, { withFileTypes: true });
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const candidate = path.join(projectsDir, dirent.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// =============================================================================
// Content-block → SerializedMessage conversion
// =============================================================================

function collectParts(entry: RawEntry): SerializedMessage["parts"] {
  const content = entry.message?.content ?? entry.content;
  if (content === undefined || content === null) return [];
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) return [];
    return [{ type: "text", content: trimmed }];
  }
  if (!Array.isArray(content)) return [];

  const parts: SerializedMessage["parts"] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const btype = b.type;
    if (btype === "text") {
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (text) parts.push({ type: "text", content: text });
    } else if (btype === "tool_use") {
      const name = typeof b.name === "string" ? b.name : "tool";
      const args = isPlainObject(b.input) ? (b.input as Record<string, unknown>) : {};
      parts.push({
        type: "tool",
        tool: { name, args },
      });
    }
    // tool_result / image / thinking / etc. — dropped by design; see
    // transcript_test.ts for the matrix.
  }
  return parts;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// =============================================================================
// Title extraction (head + tail window scan, customTitle > aiTitle > …)
// =============================================================================

/**
 * Read the first and last 64KB of a transcript and extract the user-set or
 * auto-generated title. Priority: `customTitle` (tail) → `customTitle` (head)
 * → `aiTitle` (tail) → `aiTitle` (head). Same logic as the upstream Rust
 * implementation (`extract_title_from_jsonl`).
 */
export async function extractTitleFromJsonl(
  fullPath: string,
): Promise<string | null> {
  if (!fs.existsSync(fullPath)) return null;
  let headBuf: Buffer;
  let tailBuf: Buffer;
  try {
    [headBuf, tailBuf] = await Promise.all([
      readHeadBytes(fullPath, TITLE_SCAN_BYTES),
      readTailBytes(fullPath, TITLE_SCAN_BYTES),
    ]);
  } catch {
    return null;
  }
  const head = headBuf.toString("utf8");
  const tail = tailBuf.toString("utf8");
  const title =
    extractLastStringField(tail, "customTitle") ??
    extractLastStringField(head, "customTitle") ??
    extractLastStringField(tail, "aiTitle") ??
    extractLastStringField(head, "aiTitle");
  return title ? truncateChars(title, TITLE_MAX_CHARS) : null;
}

/**
 * Find the LAST `"<key>":"…"` substring in `text` and return the unescaped
 * value. Operates on raw bytes (so embedded JSON escapes are honored). The
 * upstream Rust version iterates by char; we substring-find via `indexOf`
 * (which is byte-aligned and fast enough for the 64KB window).
 */
function extractLastStringField(
  text: string,
  key: string,
): string | null {
  const pat1 = `"${key}":"`;
  const pat2 = `"${key}": "`;
  let last: string | null = null;
  for (const pat of [pat1, pat2]) {
    let from = 0;
    while (true) {
      const rel = text.indexOf(pat, from);
      if (rel === -1) break;
      const valStart = rel + pat.length;
      const close = findStringClose(text, valStart);
      if (close === -1) break;
      const raw = text.slice(valStart, close);
      last = unescapeJsonString(raw);
      from = close + 1;
    }
  }
  return last;
}

function findStringClose(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      // Skip the escaped char (handles \\, \", \n, \uXXXX).
      i += 2;
      continue;
    }
    if (c === '"') return i;
    i++;
  }
  return -1;
}

function unescapeJsonString(raw: string): string {
  // Conservative: handle the common escapes Claude Code emits. We don't
  // feed this back into JSON.parse, so we only need to round-trip the
  // characters that can appear in a transcript title.
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\" || i + 1 >= raw.length) {
      out += c;
      continue;
    }
    const next = raw[i + 1];
    if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "r") out += "\r";
    else if (next === '"') out += '"';
    else if (next === "\\") out += "\\";
    else if (next === "/") out += "/";
    else if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      const code = parseInt(hex, 16);
      if (!Number.isNaN(code)) {
        out += String.fromCharCode(code);
        i += 4;
      } else {
        out += next;
      }
    } else {
      out += next;
    }
    i++;
  }
  return out;
}

function pickTitle(
  summary: string | undefined,
  firstPrompt: string | undefined,
): string {
  const raw =
    (summary && summary.trim()) ||
    (firstPrompt && firstPrompt.trim()) ||
    "(untitled session)";
  return truncateChars(raw, TITLE_MAX_CHARS);
}

function truncateChars(s: string, max: number): string {
  const trimmed = s.trim();
  if ([...trimmed].length <= max) return trimmed;
  // Slice on UTF-16 code points (TS strings are UTF-16). For ASCII this is
  // identical to char count; for multi-byte chars we still produce a valid
  // result because we only ever *truncate* and never split a surrogate pair.
  const out = [...trimmed].slice(0, Math.max(0, max - 1)).join("");
  return out + "…";
}

// =============================================================================
// Helpers
// =============================================================================

/** Read the first `maxBytes` of a file. */
async function readHeadBytes(
  fullPath: string,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await fsp.open(fullPath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Read the last `maxBytes` of a file. When the read does not start at byte
 * 0, drop the first (partial) line so the caller sees line-aligned data.
 */
async function readTailBytes(
  fullPath: string,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await fsp.open(fullPath, "r");
  try {
    const stat = await handle.stat();
    const len = stat.size;
    const start = Math.max(0, len - maxBytes);
    const buf = Buffer.alloc(len - start);
    await handle.read(buf, 0, buf.length, start);
    if (start > 0) {
      const nl = buf.indexOf(0x0a);
      if (nl !== -1) return buf.subarray(nl + 1);
    }
    return buf;
  } finally {
    await handle.close();
  }
}

/**
 * Read the first `cwd` field from the transcript. Scans at most 32 lines
 * (a small bound — meta records like `mode` / `file-history-snapshot` often
 * lead the file).
 */
async function readCwdFromTranscript(fullPath: string): Promise<string | null> {
  if (!fs.existsSync(fullPath)) return null;
  const stream = fs.createReadStream(fullPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let counted = 0;
  let found: string | null = null;
  try {
    for await (const line of rl) {
      if (counted++ >= 32) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: RawEntry;
      try {
        entry = JSON.parse(trimmed) as RawEntry;
      } catch {
        continue;
      }
      if (typeof entry.cwd === "string" && entry.cwd.length > 0) {
        found = entry.cwd;
        break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return found;
}

async function safeMtime(fullPath: string): Promise<number | null> {
  try {
    const stat = await fsp.stat(fullPath);
    return Math.floor(stat.mtimeMs);
  } catch {
    return null;
  }
}

function parseTimestamp(input: string | undefined | null): number | null {
  if (!input) return null;
  const t = Date.parse(input);
  if (Number.isNaN(t)) return null;
  return t;
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.endsWith(".jsonl")) out.push(path.join(dir, e.name));
  }
  return out;
}

/**
 * Filesystem-aware slug decoder for project folder names. Claude Code
 * encodes a path as on-disk folder name with every `/` replaced by `-`.
 * The mapping is lossy when folder names themselves contain `-`, so we
 * walk the filesystem from `/` and treat a `-` as a separator only when
 * the accumulated prefix is a real directory. Returns `null` when the
 * slug does not start with `-` (relative path) or when no path resolves.
 */
export function decodeProjectSlug(slug: string): string | null {
  if (!slug.startsWith("-")) return null;
  const rest = slug.slice(1);
  let pathSoFar = "/";
  let current = "";
  for (const ch of rest) {
    if (ch === "-") {
      const candidate = path.join(pathSoFar, current);
      if (directoryExists(candidate)) {
        pathSoFar = candidate;
        current = "";
      } else {
        current += ch;
      }
    } else {
      current += ch;
    }
  }
  if (current) pathSoFar = path.join(pathSoFar, current);
  return pathSoFar === "/" ? null : pathSoFar;
}

function directoryExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
