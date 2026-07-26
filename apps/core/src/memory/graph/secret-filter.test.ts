import test from "node:test";
import assert from "node:assert/strict";
import { containsSecret } from "./secret-filter.js";

test("flags credential-bearing text", () => {
  const cases = [
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz...",
    "export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123",
    "the anthropic key is sk-ant-api03-AbCdEf012345_zzz",
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    "token: ghp_0123456789abcdefABCDEF0123456789abcd",
    "SLACK_BOT_TOKEN=xoxb-1234567890-abcdefghij",
    "password = hunter2secret",
    "client_secret: 9f8e7d6c5b4a3210zzzz",
  ];
  for (const c of cases) {
    assert.ok(containsSecret(c), `should flag: ${c.slice(0, 40)}`);
  }
});

test("does not flag ordinary memory prose", () => {
  const cases = [
    "The user prefers PostgreSQL for the analytics service.",
    "Standup is at 9am; sprints are two weeks long.",
    "We link related notes with [[wikilinks]] and tag them infra.",
    "The token bucket rate limiter resets every minute.", // 'token' but no assignment
    "Remember to run pnpm lint before claiming done.",
  ];
  for (const c of cases) {
    assert.ok(!containsSecret(c), `should not flag: ${c}`);
  }
});
