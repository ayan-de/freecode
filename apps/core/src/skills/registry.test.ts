import test from "node:test";
import assert from "node:assert/strict";
import { createSkillRegistry } from "./registry.js";
import type { Skill, SkillScope } from "./types.js";

function skill(name: string, scope: SkillScope, description?: string): Skill {
  return {
    name,
    scope,
    description,
    content: `body:${scope}/${name}`,
    location: `/tmp/${scope}/${name}/SKILL.md`,
    id: `${scope}/${name}`,
    loadedAt: Date.now(),
  };
}

test("registers and retrieves by id and by name+scope", () => {
  const reg = createSkillRegistry();
  reg.register(skill("commit", "user"));
  assert.equal(reg.get("user/commit")?.name, "commit");
  assert.equal(reg.getByNameAndScope("commit", "user")?.scope, "user");
  assert.equal(reg.get("user/missing"), undefined);
});

test("findByName resolves scopes in precedence order repo > user > plugin > system > admin", () => {
  const reg = createSkillRegistry();
  // Same name present in several scopes.
  reg.register(skill("dup", "system", "system"));
  reg.register(skill("dup", "plugin", "plugin"));
  reg.register(skill("dup", "user", "user"));
  reg.register(skill("dup", "repo", "repo"));

  assert.equal(reg.findByName("dup")?.description, "repo");

  reg.remove("repo/dup");
  assert.equal(reg.findByName("dup")?.description, "user", "user beats plugin");

  reg.remove("user/dup");
  assert.equal(reg.findByName("dup")?.description, "plugin", "plugin beats system");

  reg.remove("plugin/dup");
  assert.equal(reg.findByName("dup")?.description, "system");
});

test("tracks plugin scope in the scope index and counts", () => {
  const reg = createSkillRegistry();
  reg.registerMany([
    skill("a", "plugin"),
    skill("b", "plugin"),
    skill("c", "repo"),
  ]);
  assert.equal(reg.countByScope("plugin"), 2);
  assert.equal(reg.countByScope("repo"), 1);
  assert.deepEqual(
    reg.getByScope("plugin").map((s) => s.name).sort(),
    ["a", "b"],
  );
});

test("re-registering the same id replaces without leaking scope-index entries", () => {
  const reg = createSkillRegistry();
  reg.register(skill("x", "plugin", "old"));
  reg.register(skill("x", "plugin", "new"));
  assert.equal(reg.size(), 1);
  assert.equal(reg.get("plugin/x")?.description, "new");
  assert.equal(reg.countByScope("plugin"), 1);
});

test("removeByScope clears only that scope", () => {
  const reg = createSkillRegistry();
  reg.registerMany([skill("a", "plugin"), skill("b", "repo")]);
  assert.equal(reg.removeByScope("plugin"), 1);
  assert.equal(reg.has("plugin/a"), false);
  assert.equal(reg.has("repo/b"), true);
});
