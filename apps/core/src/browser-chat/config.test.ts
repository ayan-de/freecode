import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_CHAT_DEFAULTS,
  resolveBrowserChatConfig,
} from "./config.js";

test("an absent browser block yields the defaults", () => {
  assert.deepEqual(resolveBrowserChatConfig({}), BROWSER_CHAT_DEFAULTS);
});

test("explicit values override the defaults", () => {
  const cfg = resolveBrowserChatConfig({
    cdpUrl: "http://localhost:9333",
    threadPoolSize: 4,
    headless: true,
  });
  assert.equal(cfg.cdpUrl, "http://localhost:9333");
  assert.equal(cfg.threadPoolSize, 4);
  assert.equal(cfg.headless, true);
  // untouched keys still come from the defaults
  assert.equal(
    cfg.threadBudgetChars,
    BROWSER_CHAT_DEFAULTS.threadBudgetChars,
  );
});

test("hand-edited strings coerce to numbers and booleans", () => {
  const cfg = resolveBrowserChatConfig({
    threadPoolSize: "3",
    headless: "true",
  });
  assert.equal(cfg.threadPoolSize, 3);
  assert.equal(cfg.headless, true);
});

test("nonsense values fall back rather than propagating", () => {
  const cfg = resolveBrowserChatConfig({
    threadPoolSize: 0,
    ledgerMaxAgeChars: -1,
    maxToolResultChars: "not-a-number",
    cdpUrl: "",
    subagentProvider: 42,
  });
  assert.equal(cfg.threadPoolSize, BROWSER_CHAT_DEFAULTS.threadPoolSize);
  assert.equal(
    cfg.ledgerMaxAgeChars,
    BROWSER_CHAT_DEFAULTS.ledgerMaxAgeChars,
  );
  assert.equal(
    cfg.maxToolResultChars,
    BROWSER_CHAT_DEFAULTS.maxToolResultChars,
  );
  assert.equal(cfg.cdpUrl, BROWSER_CHAT_DEFAULTS.cdpUrl);
  assert.equal(
    cfg.subagentProvider,
    BROWSER_CHAT_DEFAULTS.subagentProvider,
  );
});

test("unknown keys are ignored", () => {
  const cfg = resolveBrowserChatConfig({ somethingElse: "x" });
  assert.deepEqual(cfg, BROWSER_CHAT_DEFAULTS);
});
