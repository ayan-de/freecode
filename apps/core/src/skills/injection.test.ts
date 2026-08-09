import test from "node:test";
import assert from "node:assert/strict";
import { scoreSkill, rankSkills } from "./injection.js";
import type { Skill } from "./types.js";

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    id: `user/${overrides.name ?? "skill"}`,
    name: "skill",
    scope: "user",
    content: "",
    location: "",
    loadedAt: 0,
    ...overrides,
  };
}

test("scoreSkill: exact name match scores 1.0", () => {
  const skill = makeSkill({ name: "commit" });
  assert.equal(scoreSkill(skill, "commit"), 1.0);
});

test("scoreSkill: trigger regex match scores 1.0 even without name overlap", () => {
  const skill = makeSkill({ name: "deploy", trigger: "ship it" });
  assert.equal(scoreSkill(skill, "ship it please"), 1.0);
});

test("scoreSkill: description overlap scores between 0.4 and 0.6", () => {
  const skill = makeSkill({
    name: "unrelated-name",
    description: "Generate a git commit message",
  });
  const score = scoreSkill(skill, "write a commit message");
  assert.ok(score >= 0.4 && score <= 0.6, `expected 0.4-0.6, got ${score}`);
});

test("scoreSkill: no overlap scores 0", () => {
  const skill = makeSkill({ name: "unrelated", description: "does something else" });
  assert.equal(scoreSkill(skill, "commit"), 0);
});

test("scoreSkill: empty query scores 0", () => {
  const skill = makeSkill({ name: "commit" });
  assert.equal(scoreSkill(skill, ""), 0);
});

test("scoreSkill: invalid trigger regex does not throw", () => {
  const skill = makeSkill({ name: "broken", trigger: "(unclosed" });
  assert.doesNotThrow(() => scoreSkill(skill, "broken"));
});

test("rankSkills: sorts by descending score, stable on ties", () => {
  const commit = makeSkill({ name: "commit", description: "Generate a git commit message" });
  const deploy = makeSkill({ name: "deploy", trigger: "ship it" });
  const unrelated = makeSkill({ name: "unrelated", description: "does something else" });

  // commit scores 1.0 for query "commit"; deploy and unrelated both score 0
  // and must keep their relative input order (unrelated before deploy).
  const ranked = rankSkills([unrelated, deploy, commit], "commit");
  assert.deepEqual(
    ranked.map((s) => s.name),
    ["commit", "unrelated", "deploy"],
  );
});
