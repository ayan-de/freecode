import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import {
  ANTHROPIC_OAUTH_LOGIN,
  buildAuthorizeUrl,
  exchangeAnthropicCode,
  generatePkce,
  parseAuthCodeInput,
  redirectUriForInput,
  startCallbackServer,
} from "./anthropic-oauth-login.js";
import { ANTHROPIC_OAUTH } from "./anthropic-oauth.js";
import { readAnthropicOAuth } from "./auth-store.js";

function tmpAuthFile(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "freecode-oauth-login-")),
    "auth.json",
  );
}

/** A fetch stub standing in for the token endpoint. */
function tokenEndpoint(
  respond: (body: Record<string, unknown>) => {
    status: number;
    body: unknown;
  },
): { fetchImpl: typeof fetch; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push(body);
    const { status, body: out } = respond(body);
    const text = typeof out === "string" ? out : JSON.stringify(out);
    return new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const OK_TOKENS = {
  access_token: "at-new",
  refresh_token: "rt-new",
  expires_in: 3600,
  scope: "user:profile user:inference",
};

test("PKCE verifier is 64 alphanumerics and the challenge is its sha256", () => {
  const { verifier, challenge } = generatePkce();
  assert.equal(verifier.length, 64);
  assert.match(verifier, /^[A-Za-z0-9]{64}$/);
  assert.equal(
    challenge,
    crypto.createHash("sha256").update(verifier).digest("base64url"),
  );
  assert.ok(!challenge.includes("="), "challenge must be unpadded base64url");
  assert.notEqual(generatePkce().verifier, verifier);
});

test("authorize URL targets the claude.ai surface with state bound to the verifier", () => {
  const { verifier, challenge } = generatePkce();
  const url = new URL(
    buildAuthorizeUrl("http://localhost:9999/callback", challenge, verifier),
  );
  assert.equal(
    `${url.origin}${url.pathname}`,
    ANTHROPIC_OAUTH_LOGIN.authorizeUrl,
    // The console surface mints tokens the inference API refuses (spec §3.1).
  );
  assert.equal(url.searchParams.get("client_id"), ANTHROPIC_OAUTH.clientId);
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), verifier);
  assert.equal(url.searchParams.get("code"), "true");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://localhost:9999/callback",
  );
  assert.ok(url.searchParams.get("scope")?.includes("user:inference"));
});

test("parseAuthCodeInput accepts a bare code, a callback URL, a query string, and code#state", () => {
  assert.deepEqual(parseAuthCodeInput("  abc123 "), {
    code: "abc123",
    state: undefined,
  });
  assert.deepEqual(
    parseAuthCodeInput("https://platform.claude.com/oauth/code/callback?code=abc&state=xyz"),
    { code: "abc", state: "xyz" },
  );
  assert.deepEqual(parseAuthCodeInput("code=abc&state=xyz"), {
    code: "abc",
    state: "xyz",
  });
  assert.deepEqual(parseAuthCodeInput("abc#xyz"), { code: "abc", state: "xyz" });
  assert.throws(() => parseAuthCodeInput("   "), /No authorization code/);
});

test("redirectUriForInput picks the manual URI only for a manual callback paste", () => {
  const local = "http://localhost:1234/callback";
  assert.equal(
    redirectUriForInput(
      "https://platform.claude.com/oauth/code/callback?code=abc",
      local,
    ),
    ANTHROPIC_OAUTH_LOGIN.manualRedirectUri,
  );
  assert.equal(
    redirectUriForInput(
      "https://console.anthropic.com/oauth/code/callback?code=abc",
      local,
    ),
    ANTHROPIC_OAUTH_LOGIN.manualRedirectUri,
  );
  assert.equal(redirectUriForInput("plain-code", local), local);
  assert.equal(
    redirectUriForInput("http://localhost:1234/callback?code=abc", local),
    local,
  );
});

test("exchange posts JSON with the verifier and persists the tokens", async () => {
  const authFile = tmpAuthFile();
  const { fetchImpl, calls } = tokenEndpoint(() => ({
    status: 200,
    body: OK_TOKENS,
  }));

  const tokens = await exchangeAnthropicCode({
    verifier: "v".repeat(64),
    input: "the-code",
    redirectUri: "http://localhost:1234/callback",
    authFile,
    fetchImpl,
  });

  assert.deepEqual(calls[0], {
    grant_type: "authorization_code",
    code: "the-code",
    redirect_uri: "http://localhost:1234/callback",
    client_id: ANTHROPIC_OAUTH.clientId,
    code_verifier: "v".repeat(64),
    state: "v".repeat(64),
  });
  assert.equal(tokens.access_token, "at-new");
  assert.deepEqual(readAnthropicOAuth(authFile), tokens);
  assert.ok(tokens.expires_at > Date.now());
});

test("exchange aborts on a state that is not the verifier, without calling the endpoint", async () => {
  const authFile = tmpAuthFile();
  const { fetchImpl, calls } = tokenEndpoint(() => ({
    status: 200,
    body: OK_TOKENS,
  }));
  await assert.rejects(
    exchangeAnthropicCode({
      verifier: "v".repeat(64),
      input: "the-code#someone-elses-state",
      redirectUri: "http://localhost:1234/callback",
      authFile,
      fetchImpl,
    }),
    /state mismatch/,
  );
  assert.equal(calls.length, 0);
  assert.equal(readAnthropicOAuth(authFile), undefined);
});

test("exchange refuses a token without an inference scope and stores nothing", async () => {
  const authFile = tmpAuthFile();
  const { fetchImpl } = tokenEndpoint(() => ({
    status: 200,
    body: { ...OK_TOKENS, scope: "user:profile org:create_api_key" },
  }));
  await assert.rejects(
    exchangeAnthropicCode({
      verifier: "v".repeat(64),
      input: "the-code",
      redirectUri: "http://localhost:1234/callback",
      authFile,
      fetchImpl,
    }),
    /without an inference scope/,
  );
  assert.equal(readAnthropicOAuth(authFile), undefined);
});

test("a Cloudflare 403 is diagnosed rather than reported as a raw HTTP error", async () => {
  const { fetchImpl } = tokenEndpoint(() => ({
    status: 403,
    body: "<html><title>Just a moment...</title>/cdn-cgi/challenge-platform</html>",
  }));
  await assert.rejects(
    exchangeAnthropicCode({
      verifier: "v".repeat(64),
      input: "the-code",
      redirectUri: "http://localhost:1234/callback",
      authFile: tmpAuthFile(),
      fetchImpl,
    }),
    /blocked by Cloudflare/,
  );
});

test("callback server returns the code only for the expected state", async () => {
  const server = await startCallbackServer();
  assert.ok(server, "callback server should bind an ephemeral port");
  try {
    const pending = server.waitForCode("expected-state", 5_000);

    // A mismatched state is rejected and the listener keeps waiting.
    const bad = await fetch(
      `http://localhost:${server.port}/callback?code=nope&state=wrong`,
    );
    assert.equal(bad.status, 400);

    const good = await fetch(
      `http://localhost:${server.port}/callback?code=good-code&state=expected-state`,
    );
    assert.equal(good.status, 200);
    assert.equal(await pending, "good-code");
  } finally {
    server.close();
  }
});

test("callback server surfaces a denied authorization", async () => {
  const server = await startCallbackServer();
  assert.ok(server);
  try {
    // Assert on the rejection before triggering it: the callback rejects
    // synchronously with the request, and an unattached rejection is a crash.
    const rejects = assert.rejects(
      server.waitForCode("expected-state", 5_000),
      /access_denied/,
    );
    await fetch(`http://localhost:${server.port}/callback?error=access_denied`);
    await rejects;
  } finally {
    server.close();
  }
});
