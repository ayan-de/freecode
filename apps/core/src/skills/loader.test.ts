import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadAllSkills, loadSkill } from "./loader.js";
import type { Skill } from "./types.js";

// ---------------------------------------------------------------------------
// Hermetic fixture helpers
// ---------------------------------------------------------------------------
//
// The loader reads global skills from a home dir and system skills from an
// install dir. Both are injectable (LoaderOptions.homeDir / installDir), so
// every test runs against a throwaway tmp tree and never touches the real
// ~/.claude, ~/.freecode, or the app install.

interface Sandbox {
  root: string;
  home: string;
  project: string;
  install: string;
}

function makeSandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-skills-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const install = path.join(root, "install");
  for (const dir of [home, project, install]) fs.mkdirSync(dir, { recursive: true });
  return { root, home, project, install };
}

/** Write `<baseDir>/skills/<name>/SKILL.md` with optional frontmatter fields. */
function writeSkill(
  baseDir: string,
  name: string,
  opts: {
    description?: string;
    allowedTools?: string;
    body?: string;
    frontmatterName?: string;
    noFrontmatter?: boolean;
  } = {},
): void {
  const dir = path.join(baseDir, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  const body = opts.body ?? `Body for ${name}.`;
  if (opts.noFrontmatter) {
    fs.writeFileSync(path.join(dir, "SKILL.md"), body);
    return;
  }
  const lines = ["---", `name: ${opts.frontmatterName ?? name}`];
  if (opts.description) lines.push(`description: ${opts.description}`);
  if (opts.allowedTools) lines.push(`allowed-tools: ${opts.allowedTools}`);
  lines.push("---", "", body, "");
  fs.writeFileSync(path.join(dir, "SKILL.md"), lines.join("\n"));
}

function byName(skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((s) => [`${s.scope}/${s.name}`, s]));
}

/** A sandbox load never sees the real home — collapse to name→skill by scope. */
async function load(sb: Sandbox): Promise<Skill[]> {
  const { skills } = await loadAllSkills({
    projectPath: sb.project,
    installDir: sb.install,
    homeDir: sb.home,
  });
  return skills;
}

function cleanup(sb: Sandbox): void {
  fs.rmSync(sb.root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Discovery + parsing
// ---------------------------------------------------------------------------

test("discovers a project-local SKILL.md and parses frontmatter", async () => {
  const sb = makeSandbox();
  try {
    writeSkill(path.join(sb.project, ".freecode"), "optimize", {
      description: "Make it faster",
      allowedTools: "bash, read , write",
    });

    const skills = byName(await load(sb));
    const skill = skills.get("repo/optimize");
    assert.ok(skill, "expected repo/optimize to be discovered");
    assert.equal(skill!.description, "Make it faster");
    assert.deepEqual(skill!.allowedTools, ["bash", "read", "write"]);
    assert.match(skill!.content, /Body for optimize/);
    assert.equal(skill!.id, "repo/optimize");
  } finally {
    cleanup(sb);
  }
});

test("falls back to the directory name when frontmatter is missing", async () => {
  const sb = makeSandbox();
  try {
    writeSkill(path.join(sb.project, ".freecode"), "no-front", {
      noFrontmatter: true,
    });
    const skills = byName(await load(sb));
    const skill = skills.get("repo/no-front");
    assert.ok(skill, "skill without frontmatter should still load by dir name");
    assert.equal(skill!.name, "no-front");
    assert.equal(skill!.allowedTools, undefined);
  } finally {
    cleanup(sb);
  }
});

test("prefers frontmatter name over the directory name", async () => {
  const sb = makeSandbox();
  try {
    writeSkill(path.join(sb.project, ".freecode"), "dir-name", {
      frontmatterName: "real-name",
    });
    const skills = byName(await load(sb));
    assert.ok(skills.get("repo/real-name"));
    assert.ok(!skills.get("repo/dir-name"));
  } finally {
    cleanup(sb);
  }
});

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

test("assigns user scope to ~/.claude and ~/.freecode global skills", async () => {
  const sb = makeSandbox();
  try {
    writeSkill(path.join(sb.home, ".claude"), "claude-global");
    writeSkill(path.join(sb.home, ".freecode"), "freecode-global");
    writeSkill(path.join(sb.home, ".agents"), "agents-global");

    const skills = byName(await load(sb));
    assert.equal(skills.get("user/claude-global")?.scope, "user");
    assert.equal(skills.get("user/freecode-global")?.scope, "user");
    assert.equal(skills.get("user/agents-global")?.scope, "user");
  } finally {
    cleanup(sb);
  }
});

test("assigns system scope to install-dir skills", async () => {
  const sb = makeSandbox();
  try {
    writeSkill(path.join(sb.install, ".system"), "shipped");
    const skills = byName(await load(sb));
    assert.equal(skills.get("system/shipped")?.scope, "system");
  } finally {
    cleanup(sb);
  }
});

// ---------------------------------------------------------------------------
// Claude Code plugin discovery
// ---------------------------------------------------------------------------

function writePluginManifest(home: string, installPaths: string[]): void {
  const pluginsRoot = path.join(home, ".claude", "plugins");
  fs.mkdirSync(pluginsRoot, { recursive: true });
  const plugins: Record<string, unknown> = {};
  installPaths.forEach((p, i) => {
    plugins[`plugin-${i}@test`] = [
      { scope: "user", installPath: p, version: "1.0.0" },
    ];
  });
  fs.writeFileSync(
    path.join(pluginsRoot, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins }, null, 2),
  );
}

test("loads plugin skills from installed_plugins.json and excludes doc mirrors", async () => {
  const sb = makeSandbox();
  try {
    const install = path.join(
      sb.home,
      ".claude/plugins/cache/mkt/my-plugin/1.0.0",
    );
    // Real plugin skill at <installPath>/skills/...
    writeSkill(install, "real-plugin-skill");
    // Localized documentation mirror that must NOT be loaded.
    writeSkill(path.join(install, "docs", "ja-JP"), "localized-mirror");
    writePluginManifest(sb.home, [install]);

    const skills = byName(await load(sb));
    assert.equal(
      skills.get("plugin/real-plugin-skill")?.scope,
      "plugin",
      "manifest install path skill should load under plugin scope",
    );
    assert.ok(
      !skills.get("plugin/localized-mirror"),
      "docs/<locale> mirror must not be treated as an installed skill",
    );
  } finally {
    cleanup(sb);
  }
});

test("falls back to a cache scan (excluding docs) when no manifest exists", async () => {
  const sb = makeSandbox();
  try {
    const install = path.join(
      sb.home,
      ".claude/plugins/cache/mkt/plug/2.0.0",
    );
    writeSkill(install, "cache-skill");
    writeSkill(path.join(install, "docs", "ko-KR"), "cache-doc-mirror");
    // No installed_plugins.json → deep scan of cache/.

    const skills = byName(await load(sb));
    assert.ok(skills.get("plugin/cache-skill"));
    assert.ok(!skills.get("plugin/cache-doc-mirror"));
  } finally {
    cleanup(sb);
  }
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test("keeps same-named skills from different scopes as distinct entries", async () => {
  const sb = makeSandbox();
  try {
    writeSkill(path.join(sb.project, ".freecode"), "shared", {
      description: "project version",
    });
    writeSkill(path.join(sb.home, ".freecode"), "shared", {
      description: "global version",
    });

    const skills = byName(await load(sb));
    // Different scopes → different ids; the registry resolves precedence later.
    assert.equal(skills.get("repo/shared")?.description, "project version");
    assert.equal(skills.get("user/shared")?.description, "global version");
  } finally {
    cleanup(sb);
  }
});

// ---------------------------------------------------------------------------
// loadSkill (single, scoped)
// ---------------------------------------------------------------------------

test("loadSkill resolves a project-local skill by name and scope", async () => {
  const sb = makeSandbox();
  try {
    writeSkill(path.join(sb.project, ".claude"), "solo", {
      description: "just this one",
    });
    const skill = await loadSkill("solo", "repo", sb.project);
    assert.ok(skill);
    assert.equal(skill!.description, "just this one");
    assert.equal(skill!.scope, "repo");
    assert.equal(await loadSkill("nope", "repo", sb.project), null);
  } finally {
    cleanup(sb);
  }
});
