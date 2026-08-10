// Covers the CLAUDE.md tool-registration checklist items that are easy to
// silently miss: absent from READONLY_TOOLS (so it's blocked in plan/review/
// explore, not just build/danger) and present in DISPLAY_NAMES (so permission
// prompts show "Distill", not the raw tool id). Named after the spec's own
// testing section for Phase 2: "Tool registration: refine [distill] is
// absent from READONLY_TOOLS, present in DISPLAY_NAMES."
import test from "node:test";
import assert from "node:assert/strict";
import { getTool, listTools } from "./index.js";
import { toolKind } from "../permission/mode-policy.js";
import { suggestRule } from "../permission/suggest.js";

test("distill is registered and discoverable via getTool/listTools", () => {
  const tool = getTool("distill");
  assert.ok(tool, "distill should be registered in the tools map");
  assert.ok(listTools().some((t) => t.id === "distill"));
});

test("distill classifies as mutating, so it is blocked in plan/review/explore", () => {
  assert.equal(toolKind("distill"), "mutating");
});

test("distill gets a human-readable display name in permission prompts, not the raw id", () => {
  assert.equal(suggestRule("distill", {}, "/tmp"), "Distill");
});

test("distill's schema declares a type on every property (CLAUDE.md tool checklist item — MiniMax sends untyped fields as strings and reject-loops otherwise)", () => {
  const tool = getTool("distill");
  const properties = tool?.schemas.parameters.properties;
  assert.equal(properties?.scope?.type, "string");
  assert.equal(properties?.instructions?.type, "string");
  assert.equal(properties?.rollback_id?.type, "string");
});
