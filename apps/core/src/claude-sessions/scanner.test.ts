// =============================================================================
// Tests for the Claude Code session scanner.
//
// Strategy: each test builds a temp dir that mimics `~/.claude/projects/<slug>/`
// with hand-crafted jsonl transcripts and (optionally) sessions-index files,
// then asserts what `listClaudeSessions` returns.
//
// Run: `pnpm test` from `apps/core/`. (Uses node:test; matches the rest of
// the core suite.)
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import {
  decodeProjectSlug,
  extractTitleFromJsonl,
  getClaudeConfigDir,
  listClaudeSessions,
  readClaudeTranscript,
} from "./scanner.js";

// =============================================================================
// Test fixtures
// =============================================================================

const SLUG = "-home-user-myproject";

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-sess-"));
  await fs.mkdir(path.join(root, "projects", SLUG), { recursive: true });
  return root;
}

/** Write a single jsonl transcript under `root/projects/<slug>/<id>.jsonl`. */
async function writeTranscript(
  root: string,
  id: string,
  lines: object[],
  slug = SLUG,
): Promise<string> {
  const dir = path.join(root, "projects", slug);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  await fs.writeFile(file, text);
  // Backdate the mtime so the sort order is deterministic.
  const past = new Date(Date.now() - 1_000_000);
  await fs.utimes(file, past, past);
  return file;
}

/** Write the optional per-project sessions-index.json. */
async function writeIndex(
  root: string,
  index: object,
  slug = SLUG,
): Promise<void> {
  const dir = path.join(root, "projects", slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "sessions-index.json"),
    JSON.stringify(index),
  );
}

// =============================================================================
// getClaudeConfigDir
// =============================================================================

test("getClaudeConfigDir honors $CLAUDE_CONFIG_DIR", () => {
  const dir = getClaudeConfigDir(
    { CLAUDE_CONFIG_DIR: "/custom/claude" },
    "/home/user",
  );
  assert.equal(dir, "/custom/claude");
});

test("getClaudeConfigDir falls back to ~/.claude", () => {
  const dir = getClaudeConfigDir({}, "/home/user");
  assert.equal(dir, "/home/user/.claude");
});

test("getClaudeConfigDir ignores blank $CLAUDE_CONFIG_DIR", () => {
  const dir = getClaudeConfigDir(
    { CLAUDE_CONFIG_DIR: "  " },
    "/home/user",
  );
  assert.equal(dir, "/home/user/.claude");
});

// =============================================================================
// listClaudeSessions
// =============================================================================

test("listClaudeSessions returns [] when ~/.claude does not exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-sess-"));
  // Note: no `projects/` dir created.
  const rows = await listClaudeSessions({ claudeConfigDir: root });
  assert.deepEqual(rows, []);
});

test("listClaudeSessions returns [] when projects dir is empty", async () => {
  const root = await makeRoot();
  const rows = await listClaudeSessions({ claudeConfigDir: root });
  assert.deepEqual(rows, []);
});

test("listClaudeSessions merges sessions-index + jsonl fallback", async () => {
  const root = await makeRoot();
  // Two indexed sessions (one fully populated, one with customTitle), plus
  // a third jsonl-only session the index forgot about.
  await writeTranscript(
    root,
    "11111111-1111-1111-1111-111111111111",
    [
      { type: "mode", mode: "normal", sessionId: "11111111-1111-1111-1111-111111111111" },
      { type: "user", cwd: "/home/user/myproject", sessionId: "11111111-1111-1111-1111-111111111111", message: { role: "user", content: "hello" } },
      { type: "assistant", sessionId: "11111111-1111-1111-1111-111111111111", message: { role: "assistant", content: "hi there" } },
    ],
  );
  await writeTranscript(
    root,
    "22222222-2222-2222-2222-222222222222",
    [
      { type: "user", cwd: "/home/user/myproject", sessionId: "22222222-2222-2222-2222-222222222222", message: { role: "user", content: "second" } },
      { type: "customTitle", sessionId: "22222222-2222-2222-2222-222222222222", customTitle: "Renamed session" },
    ],
  );
  await writeTranscript(
    root,
    "33333333-3333-3333-3333-333333333333",
    [
      { type: "user", cwd: "/home/user/myproject", sessionId: "33333333-3333-3333-3333-333333333333", message: { role: "user", content: "unindexed" } },
    ],
  );

  await writeIndex(root, {
    version: 1,
    entries: [
      {
        sessionId: "11111111-1111-1111-1111-111111111111",
        fullPath: path.join(root, "projects", SLUG, "11111111-1111-1111-1111-111111111111.jsonl"),
        messageCount: 2,
        modified: new Date(Date.now() - 1_000_000).toISOString(),
      },
      {
        sessionId: "22222222-2222-2222-2222-222222222222",
        fullPath: path.join(root, "projects", SLUG, "22222222-2222-2222-2222-222222222222.jsonl"),
        messageCount: 1,
        modified: new Date(Date.now() - 500_000).toISOString(),
      },
    ],
  });

  const rows = await listClaudeSessions({ claudeConfigDir: root });
  assert.equal(rows.length, 3);

  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
  ]) {
    assert.ok(byId.has(id), `missing session ${id}`);
    const row = byId.get(id)!;
    assert.equal(row.provider, "claude-code");
    assert.equal(row.fullPath.endsWith(`${id}.jsonl`), true);
  }

  // The renamed session's customTitle wins.
  assert.equal(
    byId.get("22222222-2222-2222-2222-222222222222")?.title,
    "Renamed session",
  );
  // The unindexed session falls back to the jsonl scan's title (no
  // customTitle in the transcript) — falls back to firstPrompt.
  assert.match(
    byId.get("33333333-3333-3333-3333-333333333333")?.title ?? "",
    /unindexed/,
  );
});

test("listClaudeSessions skips sidechain entries", async () => {
  const root = await makeRoot();
  await writeIndex(root, {
    version: 1,
    entries: [
      {
        sessionId: "aaaa",
        isSidechain: true,
        fullPath: "/nonexistent.jsonl",
      },
      {
        sessionId: "bbbb",
        fullPath: "/nonexistent.jsonl",
        summary: "real session",
      },
    ],
  });
  const rows = await listClaudeSessions({ claudeConfigDir: root });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "bbbb");
});

test("listClaudeSessions sorts by modified descending", async () => {
  const root = await makeRoot();
  // All three sessions are in the index with explicit timestamps; the
  // jsonl files don't exist on disk so the index values are authoritative.
  await writeIndex(root, {
    version: 1,
    entries: [
      {
        sessionId: "old",
        summary: "old session",
        modified: "2025-01-01T00:00:00Z",
      },
      {
        sessionId: "newest",
        summary: "newest session",
        modified: "2026-08-01T00:00:00Z",
      },
      {
        sessionId: "middle",
        summary: "middle session",
        modified: "2026-01-01T00:00:00Z",
      },
    ],
  });
  const rows = await listClaudeSessions({ claudeConfigDir: root });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["newest", "middle", "old"],
  );
});

test("listClaudeSessions filters by projectPath", async () => {
  const root = await makeRoot();
  await writeIndex(root, {
    version: 1,
    entries: [
      { sessionId: "a", projectPath: "/proj/a", summary: "a" },
      { sessionId: "b", projectPath: "/proj/b", summary: "b" },
    ],
  });
  const rows = await listClaudeSessions({
    claudeConfigDir: root,
    projectPath: "/proj/a",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "a");
});

test("listClaudeSessions honors the limit", async () => {
  const root = await makeRoot();
  const entries = Array.from({ length: 5 }, (_, i) => ({
    sessionId: `s${i}`,
    summary: `session ${i}`,
    modified: new Date(Date.now() - i * 1000).toISOString(),
  }));
  await writeIndex(root, { version: 1, entries });
  const rows = await listClaudeSessions({ claudeConfigDir: root, limit: 2 });
  assert.equal(rows.length, 2);
});

test("listClaudeSessions tolerates a malformed index", async () => {
  const root = await makeRoot();
  await fs.writeFile(
    path.join(root, "projects", SLUG, "sessions-index.json"),
    "{not json",
  );
  // Should not throw; the jsonl fallback picks up nothing → empty list.
  const rows = await listClaudeSessions({ claudeConfigDir: root });
  assert.deepEqual(rows, []);
});

// =============================================================================
// readClaudeTranscript
// =============================================================================

test("readClaudeTranscript converts user/assistant text + tool_use", async () => {
  const root = await makeRoot();
  const file = await writeTranscript(root, "session-1", [
    { type: "user", sessionId: "session-1", message: { role: "user", content: "hello" } },
    { type: "assistant", sessionId: "session-1", message: { role: "assistant", content: [
      { type: "text", text: "I'll check the file." },
      { type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } },
      { type: "tool_result", content: "file contents" },
    ] } },
    { type: "assistant", sessionId: "session-1", message: { role: "assistant", content: "done" } },
    // Not a user/assistant message — should be dropped.
    { type: "mode", mode: "normal" },
    { type: "system", subtype: "away_summary", content: "ignored" },
  ]);

  const messages = await readClaudeTranscript("session-1", {
    fullPath: file,
  });
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.deepEqual(messages[0].parts, [{ type: "text", content: "hello" }]);
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].parts.length, 2); // text + tool_use; tool_result dropped
  assert.equal(messages[1].parts[0].type, "text");
  assert.equal(messages[1].parts[1].type, "tool");
  assert.equal(messages[1].parts[1].tool?.name, "Read");
  assert.deepEqual(messages[1].parts[1].tool?.args, { file_path: "/tmp/x" });
  assert.equal(messages[2].role, "assistant");
});

test("readClaudeTranscript drops empty messages", async () => {
  const root = await makeRoot();
  const file = await writeTranscript(root, "session-1", [
    { type: "user", sessionId: "session-1", message: { role: "user", content: "" } },
    { type: "assistant", sessionId: "session-1", message: { role: "assistant", content: [] } },
    { type: "assistant", sessionId: "session-1", message: { role: "assistant", content: "kept" } },
  ]);
  const messages = await readClaudeTranscript("session-1", { fullPath: file });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].parts[0].content, "kept");
});

test("readClaudeTranscript caps output at maxMessages", async () => {
  const root = await makeRoot();
  const lines = Array.from({ length: 10 }, (_, i) => ({
    type: "user",
    sessionId: "x",
    message: { role: "user", content: `msg ${i}` },
  }));
  const file = await writeTranscript(root, "session-1", lines);
  const messages = await readClaudeTranscript("session-1", {
    fullPath: file,
    maxMessages: 3,
  });
  assert.equal(messages.length, 3);
});

test("readClaudeTranscript returns [] when no transcript matches the id", async () => {
  const root = await makeRoot();
  const messages = await readClaudeTranscript("nope", { claudeConfigDir: root });
  assert.deepEqual(messages, []);
});

// =============================================================================
// extractTitleFromJsonl (head + tail scan)
// =============================================================================

test("extractTitleFromJsonl honors customTitle in tail", async () => {
  const root = await makeRoot();
  // Build a transcript whose tail carries a customTitle and whose head does
  // not — exercises the "customTitle in tail" code path.
  const lines = Array.from({ length: 5 }, (_, i) => ({
    type: "user",
    sessionId: "x",
    message: { role: "user", content: `msg ${i} ${"x".repeat(200)}` },
  }));
  lines.push({
    type: "user",
    sessionId: "x",
    customTitle: "My deep dive",
    message: { role: "user", content: "msg 5" },
  });
  const file = await writeTranscript(root, "session-1", lines);
  const title = await extractTitleFromJsonl(file);
  assert.equal(title, "My deep dive");
});

test("extractTitleFromJsonl falls back to aiTitle", async () => {
  const root = await makeRoot();
  const lines = [
    { type: "user", sessionId: "x", aiTitle: "Auto title", message: { role: "user", content: "hi" } },
  ];
  const file = await writeTranscript(root, "session-1", lines);
  const title = await extractTitleFromJsonl(file);
  assert.equal(title, "Auto title");
});

test("extractTitleFromJsonl handles unicode escapes", async () => {
  const root = await makeRoot();
  // JSON.stringify emits \uXXXX for non-ASCII; our parser must unescape it.
  const lines = [
    { type: "user", sessionId: "x", customTitle: "héllo wörld 🚀", message: { role: "user", content: "hi" } },
  ];
  const file = await writeTranscript(root, "session-1", lines);
  const title = await extractTitleFromJsonl(file);
  assert.match(title ?? "", /héllo/);
});

// =============================================================================
// decodeProjectSlug
// =============================================================================

test("decodeProjectSlug returns null for non-leading-dash input", () => {
  assert.equal(decodeProjectSlug("not-a-path"), null);
  assert.equal(decodeProjectSlug(""), null);
});

test("decodeProjectSlug decodes by walking real directories", () => {
  // The test does not depend on the user's real filesystem; create a temp
  // tree that matches the path we expect.
  const base = path.resolve("/tmp/decode-project-slug-test");
  // Build /tmp/decode-project-slug-test/foo/bar/baz
  const segments = ["foo", "bar", "baz"];
  let sofar = base;
  try {
    for (const seg of segments) {
      sofar = path.join(sofar, seg);
      fsSync.mkdirSync(sofar, { recursive: true });
    }
    const slug = "-tmp-decode-project-slug-test-foo-bar-baz";
    assert.equal(decodeProjectSlug(slug), sofar);
  } finally {
    fsSync.rmSync(base, { recursive: true, force: true });
  }
});