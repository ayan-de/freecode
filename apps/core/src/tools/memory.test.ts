import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MemoryTool } from "./memory.js";
import { getMemoryStore } from "../memory/mem-store.js";
import { parseMemoryFrontmatter } from "../memory/mem-types.js";
import type { ToolContext } from "./types.js";

// The store derives its directory from basename(projectPath), so a temp
// project dir yields a temp-named memory dir under ~/.freecode/projects. Both
// are removed in cleanup so a test run leaves nothing behind.
function fixture(): { ctx: ToolContext; memDir: string; cleanup: () => void } {
  const projectPath = mkdtempSync(join(tmpdir(), "mem-tool-"));
  const memDir = getMemoryStore(projectPath).getMemoryDir();
  return {
    ctx: { cwd: projectPath, projectPath },
    memDir,
    cleanup: () => {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(dirname(memDir), { recursive: true, force: true });
    },
  };
}

const save = {
  action: "save" as const,
  type: "feedback" as const,
  name: "prefers-tables",
  description: "User wants comparisons as tables",
  content: "Use tables for comparisons.\n\n**Why:** easier to scan.",
};

test("save writes a file whose frontmatter round-trips", async () => {
  const { ctx, memDir, cleanup } = fixture();
  try {
    const res = await MemoryTool.execute(save, ctx);
    assert.equal(res.success, true);

    const file = join(memDir, "feedback", "prefers-tables.md");
    assert.ok(existsSync(file), "memory file should exist");

    const parsed = parseMemoryFrontmatter(readFileSync(file, "utf-8"));
    assert.equal(parsed.metadata.name, "prefers-tables");
    assert.equal(parsed.metadata.description, save.description);
    assert.equal(parsed.metadata.type, "feedback");
    assert.equal(parsed.content, save.content);
  } finally {
    cleanup();
  }
});

test("save reports created, then updated with the prior description", async () => {
  const { ctx, cleanup } = fixture();
  try {
    const first = await MemoryTool.execute(save, ctx);
    assert.equal(first.success && first.result.metadata?.outcome, "created");

    const second = await MemoryTool.execute(
      { ...save, description: "Reworded" },
      ctx,
    );
    assert.equal(second.success && second.result.metadata?.outcome, "updated");
    assert.equal(
      second.success && second.result.metadata?.previousDescription,
      save.description,
    );
  } finally {
    cleanup();
  }
});

test("a memory containing a secret is refused and nothing is written", async () => {
  const { ctx, memDir, cleanup } = fixture();
  try {
    const res = await MemoryTool.execute(
      {
        ...save,
        name: "deploy-creds",
        content: "Deploy with sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      },
      ctx,
    );
    assert.equal(res.success, false);
    assert.match(res.success === false ? res.error : "", /secret/i);
    assert.ok(
      !existsSync(join(memDir, "feedback", "deploy-creds.md")),
      "no file should be written for a secret-bearing memory",
    );
  } finally {
    cleanup();
  }
});

test("delete removes an entry and reports a miss for an absent one", async () => {
  const { ctx, memDir, cleanup } = fixture();
  try {
    await MemoryTool.execute(save, ctx);
    const hit = await MemoryTool.execute(
      { action: "delete", type: "feedback", name: "prefers-tables" },
      ctx,
    );
    assert.equal(hit.success && hit.result.metadata?.deleted, true);
    assert.ok(!existsSync(join(memDir, "feedback", "prefers-tables.md")));

    const miss = await MemoryTool.execute(
      { action: "delete", type: "feedback", name: "never-existed" },
      ctx,
    );
    assert.equal(miss.success && miss.result.metadata?.deleted, false);
  } finally {
    cleanup();
  }
});

test("list returns names and descriptions but never bodies", async () => {
  const { ctx, cleanup } = fixture();
  try {
    await MemoryTool.execute(save, ctx);
    const res = await MemoryTool.execute({ action: "list" }, ctx);
    assert.equal(res.success, true);
    const output = res.success ? res.result.output : "";
    assert.match(output, /prefers-tables/);
    assert.match(output, /User wants comparisons as tables/);
    assert.doesNotMatch(
      output,
      /easier to scan/,
      "bodies must not be included — recall is the graph's job",
    );
  } finally {
    cleanup();
  }
});

test("validateInput rejects a bad type and echoes the valid ones", () => {
  const bad = MemoryTool.validateInput?.({ ...save, type: "notes" });
  assert.equal(bad?.valid, false);
  assert.match(
    bad?.valid === false ? bad.error : "",
    /user.*feedback.*project.*reference/s,
  );
});

test("validateInput requires the fields each action needs", () => {
  assert.equal(
    MemoryTool.validateInput?.({ action: "save", type: "user", name: "x" })
      .valid,
    false,
    "save without description/content is invalid",
  );
  assert.equal(
    MemoryTool.validateInput?.({ action: "delete", type: "user" }).valid,
    false,
    "delete without a name is invalid",
  );
  assert.equal(
    MemoryTool.validateInput?.({ action: "list" }).valid,
    true,
    "list needs nothing",
  );
});

test("tags arrive as a comma-separated string from strict-decoding providers", async () => {
  const { ctx, memDir, cleanup } = fixture();
  try {
    const res = await MemoryTool.execute(
      { ...save, tags: "style, formatting" as unknown as string[] },
      ctx,
    );
    assert.equal(res.success, true);
    const file = join(memDir, "feedback", "prefers-tables.md");
    const parsed = parseMemoryFrontmatter(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.metadata.tags, ["style", "formatting"]);
  } finally {
    cleanup();
  }
});
