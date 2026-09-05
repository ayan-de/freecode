import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import {
  ANTHROPIC_OAUTH,
  CLAUDE_CODE_BILLING_BLOCK,
  CLAUDE_CODE_IDENTITY,
  anthropicOAuthForbidden,
  isOAuthForbiddenBody,
  markAnthropicOAuthForbidden,
  createAnthropicOAuthFetch,
  importClaudeCodeCredentials,
  refreshAnthropicTokens,
  getAnthropicAccessToken,
  resetAnthropicOAuthState,
  withClaudeCodeIdentity,
} from "./anthropic-oauth.js";
import { readAnthropicOAuth } from "./auth-store.js";
import { buildGenerateOptions } from "./generic-provider.js";
import { resolveCatalogue } from "./catalogue.js";
import { priceUsd, totalUsd } from "./pricing.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "freecode-oauth-test-"));
}

function writeClaudeCreds(
  dir: string,
  overrides: Record<string, unknown> = {},
): string {
  const file = path.join(dir, ".credentials.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "at-imported",
        refreshToken: "rt-imported",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["user:profile", "user:inference"],
        subscriptionType: "max",
        ...overrides,
      },
    }),
  );
  return file;
}

/**
 * A one-endpoint token server. `respond` sees each parsed request body and
 * returns { status, body }; every call is recorded for assertions.
 */
async function tokenServer(
  respond: (
    body: Record<string, unknown>,
    callIndex: number,
  ) => { status: number; body: unknown },
): Promise<{
  url: string;
  calls: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}> {
  const calls: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const body = JSON.parse(data) as Record<string, unknown>;
      calls.push(body);
      const { status, body: responseBody } = respond(body, calls.length - 1);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}/v1/oauth/token`,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

const freshTokenResponse = {
  access_token: "at-fresh",
  refresh_token: "rt-rotated",
  expires_in: 3600,
  scope: "user:profile user:inference",
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

test("import: Claude Code credentials land in the auth store, file at 0600", () => {
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  const stored = importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  assert.equal(stored?.access_token, "at-imported");
  assert.equal(stored?.refresh_token, "rt-imported");
  assert.deepEqual(readAnthropicOAuth(authFile), stored);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(authFile).mode & 0o777, 0o600);
  }
});

test("import: absent file is undefined, malformed file is a clear error", () => {
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  assert.equal(
    importClaudeCodeCredentials(path.join(dir, "nope.json"), authFile),
    undefined,
  );

  const malformed = path.join(dir, "malformed.json");
  fs.writeFileSync(malformed, JSON.stringify({ claudeAiOauth: { nope: 1 } }));
  assert.throws(
    () => importClaudeCodeCredentials(malformed, authFile),
    /no usable claudeAiOauth entry/,
  );
});

test("import: a token without an inference scope is refused, not stored", () => {
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  const creds = writeClaudeCreds(dir, { scopes: ["user:profile"] });
  assert.throws(
    () => importClaudeCodeCredentials(creds, authFile),
    /without an inference scope/,
  );
  assert.equal(readAnthropicOAuth(authFile), undefined);
});

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

test("refresh: rotates the refresh token and persists it", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  const server = await tokenServer(() => ({
    status: 200,
    body: freshTokenResponse,
  }));
  try {
    const next = await refreshAnthropicTokens("rt-imported", {
      tokenUrl: server.url,
      authFile,
    });
    assert.equal(next.access_token, "at-fresh");
    assert.equal(next.refresh_token, "rt-rotated");
    assert.equal(readAnthropicOAuth(authFile)?.refresh_token, "rt-rotated");

    // Request shape: JSON body with Claude Code's client id and scopes.
    assert.equal(server.calls.length, 1);
    assert.equal(server.calls[0].grant_type, "refresh_token");
    assert.equal(server.calls[0].client_id, ANTHROPIC_OAUTH.clientId);
    assert.equal(server.calls[0].scope, ANTHROPIC_OAUTH.refreshScopes);
  } finally {
    await server.close();
  }
});

test("refresh: concurrent callers share one network call", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  const server = await tokenServer(() => ({
    status: 200,
    body: freshTokenResponse,
  }));
  try {
    const [a, b] = await Promise.all([
      refreshAnthropicTokens("rt-imported", { tokenUrl: server.url, authFile }),
      refreshAnthropicTokens("rt-imported", { tokenUrl: server.url, authFile }),
    ]);
    assert.equal(server.calls.length, 1);
    assert.equal(a.access_token, b.access_token);
  } finally {
    await server.close();
  }
});

test("refresh: a fresher stored token wins without a network call (rotation guard)", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  const server = await tokenServer(() => {
    throw new Error("must not be called");
  });
  try {
    // Caller observed a stale token; the store already has a fresh one.
    const result = await refreshAnthropicTokens("rt-stale-observation", {
      tokenUrl: server.url,
      authFile,
    });
    assert.equal(result.refresh_token, "rt-imported");
    assert.equal(server.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("refresh: invalid_scope falls back to a scopeless retry", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  const server = await tokenServer((_body, i) =>
    i === 0
      ? { status: 400, body: { error: "invalid_scope" } }
      : { status: 200, body: freshTokenResponse },
  );
  try {
    const next = await refreshAnthropicTokens("rt-imported", {
      tokenUrl: server.url,
      authFile,
    });
    assert.equal(next.access_token, "at-fresh");
    assert.equal(server.calls.length, 2);
    assert.equal("scope" in server.calls[1], false);
  } finally {
    await server.close();
  }
});

test("refresh: a permanent rejection is terminal — no second round-trip", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  const server = await tokenServer(() => ({
    status: 401,
    body: { error: "invalid_grant" },
  }));
  try {
    await assert.rejects(
      refreshAnthropicTokens("rt-imported", { tokenUrl: server.url, authFile }),
      /refresh failed \(HTTP 401\)/,
    );
    await assert.rejects(
      refreshAnthropicTokens("rt-imported", { tokenUrl: server.url, authFile }),
      /refresh failed \(HTTP 401\)/,
    );
    assert.equal(server.calls.length, 1);
  } finally {
    await server.close();
  }
});

test("refresh: a token that comes back without an inference scope is refused", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  const server = await tokenServer(() => ({
    status: 200,
    body: { ...freshTokenResponse, scope: "user:profile" },
  }));
  try {
    await assert.rejects(
      refreshAnthropicTokens("rt-imported", { tokenUrl: server.url, authFile }),
      /without an inference scope/,
    );
  } finally {
    await server.close();
  }
});

test("getAnthropicAccessToken: fresh token is returned as-is, near-expiry token is refreshed", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);
  assert.equal(await getAnthropicAccessToken({ authFile }), "at-imported");

  // Second store: expires inside the refresh margin.
  const dir2 = tmpDir();
  const authFile2 = path.join(dir2, "auth.json");
  importClaudeCodeCredentials(
    writeClaudeCreds(dir2, { expiresAt: Date.now() + 60_000 }),
    authFile2,
  );
  const server = await tokenServer(() => ({
    status: 200,
    body: freshTokenResponse,
  }));
  try {
    assert.equal(
      await getAnthropicAccessToken({ tokenUrl: server.url, authFile: authFile2 }),
      "at-fresh",
    );
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Request rewriting
// ---------------------------------------------------------------------------

test("oauth fetch: bearer replaces x-api-key, betas merge, Claude Code UA set", async () => {
  let seen: Headers | undefined;
  const oauthFetch = createAnthropicOAuthFetch(
    async (_input, init) => {
      seen = new Headers(init?.headers);
      return new Response("{}");
    },
    async () => "at-test",
  );

  await oauthFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": "oauth-subscription",
      "anthropic-beta": "prompt-caching-2024-07-31,oauth-2025-04-20",
    },
  });

  assert.ok(seen);
  assert.equal(seen.get("x-api-key"), null);
  assert.equal(seen.get("authorization"), "Bearer at-test");
  assert.equal(seen.get("user-agent"), ANTHROPIC_OAUTH.userAgent);
  // Ours lead, the SDK's own betas survive, duplicates collapse.
  assert.equal(
    seen.get("anthropic-beta"),
    "claude-code-20250219,oauth-2025-04-20,prompt-caching-2024-07-31",
  );
});

// ---------------------------------------------------------------------------
// Identity block — the §0.1 invariant
// ---------------------------------------------------------------------------

test("withClaudeCodeIdentity: identity leads, caller's blocks and cache flags survive", () => {
  const lead = [
    { text: CLAUDE_CODE_BILLING_BLOCK },
    { text: CLAUDE_CODE_IDENTITY },
  ];
  assert.deepEqual(withClaudeCodeIdentity(undefined), lead);
  assert.deepEqual(withClaudeCodeIdentity("be helpful"), [
    ...lead,
    { text: "be helpful" },
  ]);
  assert.deepEqual(withClaudeCodeIdentity([{ text: "be helpful", cache: true }]), [
    ...lead,
    { text: "be helpful", cache: true },
  ]);
});

const anthropicEntry = resolveCatalogue().find((e) => e.id === "anthropic")!;

test("OAuth mode: the system param leads with the identity block, even with no system prompt", () => {
  process.env.FREECODE_ANTHROPIC_AUTH = "oauth";
  try {
    const opts = buildGenerateOptions(anthropicEntry, {}, {
      system: "be helpful",
      prompt: "hi",
    });
    assert.equal(opts.system[0].content, CLAUDE_CODE_BILLING_BLOCK);
    assert.equal(opts.system[1].content, CLAUDE_CODE_IDENTITY);
    assert.equal(opts.system[2].content, "be helpful");

    const bare = buildGenerateOptions(anthropicEntry, {}, { prompt: "hi" });
    assert.equal(bare.system[0].content, CLAUDE_CODE_BILLING_BLOCK);
    assert.equal(bare.system[1].content, CLAUDE_CODE_IDENTITY);
  } finally {
    delete process.env.FREECODE_ANTHROPIC_AUTH;
  }
});

test("API-key mode: the request never carries the identity block (spec §0.1)", () => {
  process.env.FREECODE_ANTHROPIC_AUTH = "api-key";
  try {
    const opts = buildGenerateOptions(anthropicEntry, {}, {
      system: "be helpful",
      prompt: "hi",
    });
    const wire = JSON.stringify(opts);
    assert.equal(wire.includes(CLAUDE_CODE_IDENTITY), false);
    // The billing attribution is impersonation too: a metered API-key request
    // must not claim to be Claude Code usage.
    assert.equal(wire.includes("x-anthropic-billing-header"), false);
  } finally {
    delete process.env.FREECODE_ANTHROPIC_AUTH;
  }
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

test("a subscription call prices as undefined, never $0 (spec §5)", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1000 };
  assert.equal(
    priceUsd("anthropic", "claude-sonnet-4-5", usage, "oauth"),
    undefined,
  );
  assert.notEqual(
    priceUsd("anthropic", "claude-sonnet-4-5", usage, "api-key"),
    undefined,
  );
  // The stamp is per-call, so it is provider-agnostic by design; nothing
  // stamps a metered provider, and an unstamped call prices normally.
  assert.notEqual(priceUsd("openai", "gpt-4o", usage), undefined);
});

test("cost is a property of the recorded call, not of the reader's config", () => {
  // Pricing used to read the live auth mode, so logging in repriced every
  // historical API-key session as "subscription" — and the price of a span
  // depended on which machine folded the log.
  const usage = { inputTokens: 1_000_000, outputTokens: 1000 };
  for (const mode of ["oauth", "api-key"]) {
    process.env.FREECODE_ANTHROPIC_AUTH = mode;
    try {
      assert.notEqual(
        priceUsd("anthropic", "claude-sonnet-4-5", usage),
        undefined,
        `an unstamped call must price normally regardless of config (${mode})`,
      );
    } finally {
      delete process.env.FREECODE_ANTHROPIC_AUTH;
    }
  }
});

test("a mixed session totals only the API-key calls, and says it is partial", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1000 };
  const total = totalUsd([
    { provider: "anthropic", model: "claude-sonnet-4-5", ...usage },
    {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      authMode: "oauth" as const,
      ...usage,
    },
  ]);
  assert.ok(total);
  assert.equal(total.partial, true);
  assert.equal(
    total.usd,
    priceUsd("anthropic", "claude-sonnet-4-5", usage, "api-key"),
  );
});

// ---------------------------------------------------------------------------
// Phase 2 — hardening: Cloudflare diagnosis and the org-forbidden fallback
// ---------------------------------------------------------------------------

test("refresh: a Cloudflare challenge is diagnosed and NOT marked terminal", async () => {
  resetAnthropicOAuthState();
  const dir = tmpDir();
  const authFile = path.join(dir, "auth.json");
  importClaudeCodeCredentials(writeClaudeCreds(dir), authFile);

  const server = await tokenServer((_body, callIndex) =>
    callIndex === 0
      ? {
          status: 403,
          body: "<html><title>Just a moment...</title>/cdn-cgi/challenge-platform</html>",
        }
      : { status: 200, body: freshTokenResponse },
  );
  try {
    await assert.rejects(
      refreshAnthropicTokens("rt-imported", { tokenUrl: server.url, authFile }),
      /blocked by Cloudflare/,
    );
    // The token is fine — the network was not. A retry must still go out,
    // which is exactly what the terminal-rejection latch would have prevented.
    const tokens = await refreshAnthropicTokens("rt-imported", {
      tokenUrl: server.url,
      authFile,
    });
    assert.equal(tokens.access_token, "at-fresh");
    assert.equal(server.calls.length, 2);
  } finally {
    await server.close();
  }
});

test("forbidden: only a 403 carrying Anthropic's OAuth refusal matches", () => {
  assert.equal(
    isOAuthForbiddenBody(
      403,
      '{"type":"error","error":{"type":"permission_error","message":"OAuth authentication is currently not allowed for this organization."}}',
    ),
    true,
  );
  assert.equal(isOAuthForbiddenBody(403, '{"error":{"type":"permission_error"}}'), true);
  assert.equal(isOAuthForbiddenBody(429, "rate limited"), false);
  assert.equal(isOAuthForbiddenBody(403, '{"error":{"type":"not_found_error"}}'), false);
  assert.equal(isOAuthForbiddenBody(200, "permission_error"), false);
});

test("forbidden: the oauth fetch latches the 403 and leaves the body readable", async () => {
  resetAnthropicOAuthState();
  const forbidden =
    '{"type":"error","error":{"type":"permission_error","message":"OAuth authentication is currently not allowed for this organization."}}';
  const oauthFetch = createAnthropicOAuthFetch(
    async () => new Response(forbidden, { status: 403 }),
    async () => "at-test",
  );

  assert.equal(anthropicOAuthForbidden(), undefined);
  const resp = await oauthFetch("https://api.anthropic.com/v1/messages");
  // The SDK still has to be able to read the body it was handed.
  assert.equal(await resp.text(), forbidden);
  assert.match(anthropicOAuthForbidden() ?? "", /not allowed for this organization/);
  resetAnthropicOAuthState();
});

test("billing attribution leads the OAuth system param, before the identity", () => {
  // The official CLI's order (jcode's `build_system_param_split`): billing
  // attribution, identity, then the real prompt.
  const blocks = withClaudeCodeIdentity([{ text: "real prompt", cache: true }]);
  assert.equal(blocks[0].text, CLAUDE_CODE_BILLING_BLOCK);
  assert.equal(blocks[1].text, CLAUDE_CODE_IDENTITY);
  assert.equal(blocks[2].text, "real prompt");
  // Neither prepended block may carry a cache marker: Anthropic caches up to
  // the marked block, so a marker here would cut the caller's prefix short.
  assert.equal(blocks[0].cache, undefined);
  assert.equal(blocks[1].cache, undefined);
  assert.equal(blocks[2].cache, true);
  assert.equal(ANTHROPIC_OAUTH.userAgent.includes("2.1.257"), true);
  assert.equal(CLAUDE_CODE_BILLING_BLOCK.includes("cc_version=2.1.257"), true);
});

test("forbidden: a latched 403 drops the identity block, keeping the §0.1 invariant", () => {
  resetAnthropicOAuthState();
  process.env.FREECODE_ANTHROPIC_AUTH = "oauth";
  try {
    const before = buildGenerateOptions(anthropicEntry, {}, { prompt: "hi" });
    assert.equal(before.system[1].content, CLAUDE_CODE_IDENTITY);

    markAnthropicOAuthForbidden("org refuses OAuth");

    // The fallback request goes out on the API key, so it must carry none of
    // the Claude Code impersonation.
    const after = JSON.stringify(
      buildGenerateOptions(anthropicEntry, {}, { prompt: "hi" }),
    );
    assert.equal(after.includes(CLAUDE_CODE_IDENTITY), false);
    assert.equal(after.includes("x-anthropic-billing-header"), false);
  } finally {
    delete process.env.FREECODE_ANTHROPIC_AUTH;
    resetAnthropicOAuthState();
  }
});
