// =============================================================================
// Anthropic OAuth login (PKCE) — Phase 1 of
// `docs/superpowers/specs/2026-09-05-anthropic-oauth-provider.md`.
//
// Phase 0 borrowed the official Claude Code CLI's login; this module mints our
// own, so freecode works on a machine that never ran Claude Code. Protocol only
// — no printing, no prompting: the CLI (`cli/commands/auth.ts`) owns the user
// interaction, this file owns the wire format.
//
// Read §0.1 before touching it: the whole flow impersonates Claude Code, and
// that impersonation stays quarantined to the OAuth path.
// =============================================================================

import * as crypto from "crypto";
import * as http from "http";
import { AddressInfo } from "net";
import {
  ANTHROPIC_OAUTH,
  CLOUDFLARE_CHALLENGE_MESSAGE,
  ensureInferenceScope,
  looksLikeCloudflareChallenge,
  type AnthropicOAuthOptions,
} from "./anthropic-oauth.js";
import {
  AUTH_FILE,
  type StoredAnthropicOAuth,
  saveAnthropicOAuth,
} from "./auth-store.js";

export const ANTHROPIC_OAUTH_LOGIN = {
  /**
   * The claude.ai surface — NOT `platform.claude.com/oauth/authorize`. The
   * console endpoint mints tokens that refresh fine but are refused at
   * inference time (spec §3.1); jcode learned this the hard way.
   */
  authorizeUrl: "https://claude.com/cai/oauth/authorize",
  manualRedirectUri: "https://platform.claude.com/oauth/code/callback",
  /** Older Claude Code builds redirected here; still accepted on paste. */
  legacyRedirectUri: "https://console.anthropic.com/oauth/code/callback",
  scopes:
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
} as const;

const PKCE_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** 64 alphanumeric chars; challenge is unpadded base64url(sha256(verifier)). */
export function generatePkce(): Pkce {
  const bytes = crypto.randomBytes(64);
  let verifier = "";
  for (const byte of bytes) verifier += PKCE_CHARSET[byte % PKCE_CHARSET.length];
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * `state` is the verifier itself (jcode's convention): Anthropic's token
 * endpoint requires a `state`, and reusing the verifier binds it to the PKCE
 * secret without a second piece of state to carry around.
 */
export function buildAuthorizeUrl(
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const q = new URLSearchParams({
    code: "true",
    client_id: ANTHROPIC_OAUTH.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ANTHROPIC_OAUTH_LOGIN.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${ANTHROPIC_OAUTH_LOGIN.authorizeUrl}?${q.toString()}`;
}

export interface ParsedAuthCode {
  code: string;
  state?: string;
}

/**
 * Accepts what a user can plausibly paste: a bare code, a full callback URL or
 * query string carrying `code=`, or OpenCode-style `code#state`.
 */
export function parseAuthCodeInput(input: string): ParsedAuthCode {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("No authorization code provided.");

  let raw = trimmed;
  let state: string | undefined;
  if (trimmed.includes("code=")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      url = new URL(`https://example.com?${trimmed.replace(/^\?/, "")}`);
    }
    const code = url.searchParams.get("code");
    if (!code) throw new Error("No authorization code found in that URL.");
    raw = code;
    state = url.searchParams.get("state") ?? undefined;
  }

  // A `code#state` pair wins over any `state` query param — it is the fragment
  // the authorize page actually handed the user.
  const hash = raw.indexOf("#");
  if (hash !== -1) {
    state = raw.slice(hash + 1);
    raw = raw.slice(0, hash);
  }
  if (!raw.trim()) throw new Error("No authorization code provided.");
  return { code: raw.trim(), state: state?.trim() || undefined };
}

/**
 * Which redirect_uri the exchange must claim. The token endpoint matches it
 * against the one the code was minted for: a pasted manual-callback URL means
 * the manual URI, anything else means the localhost callback we served.
 */
export function redirectUriForInput(input: string, fallback: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return fallback;
  }
  const manual = [
    ANTHROPIC_OAUTH_LOGIN.manualRedirectUri,
    ANTHROPIC_OAUTH_LOGIN.legacyRedirectUri,
  ].some((candidate) => {
    const expected = new URL(candidate);
    return url.origin === expected.origin && url.pathname === expected.pathname;
  });
  return manual ? ANTHROPIC_OAUTH_LOGIN.manualRedirectUri : fallback;
}

export interface ExchangeOptions extends AnthropicOAuthOptions {
  verifier: string;
  /** Raw user/callback input: code, callback URL, or `code#state`. */
  input: string;
  redirectUri: string;
}

/**
 * Trade an authorization code for tokens and persist them (spec §3.2 step 4).
 * JSON body, not form-encoded — Anthropic's endpoint wants JSON.
 */
export async function exchangeAnthropicCode(
  opts: ExchangeOptions,
): Promise<StoredAnthropicOAuth> {
  const { code, state: callbackState } = parseAuthCodeInput(opts.input);
  if (callbackState && callbackState !== opts.verifier) {
    throw new Error(
      "OAuth state mismatch. Start the login again and use the newest callback URL or code.",
    );
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const resp = await fetchImpl(opts.tokenUrl ?? ANTHROPIC_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: opts.redirectUri,
      client_id: ANTHROPIC_OAUTH.clientId,
      code_verifier: opts.verifier,
      state: opts.verifier,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 403 && looksLikeCloudflareChallenge(text)) {
      throw new Error(CLOUDFLARE_CHALLENGE_MESSAGE);
    }
    throw new Error(`Token exchange failed (HTTP ${resp.status}): ${text}`);
  }

  const body = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  };
  const scopes = body.scope ? body.scope.split(/\s+/).filter(Boolean) : [];
  ensureInferenceScope(scopes, "token exchange");

  const tokens: StoredAnthropicOAuth = {
    type: "oauth",
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
    scopes,
  };
  saveAnthropicOAuth(tokens, opts.authFile ?? AUTH_FILE);
  return tokens;
}

export interface CallbackServer {
  port: number;
  redirectUri: string;
  /** Resolves with the raw code once the browser hits /callback. */
  waitForCode(expectedState: string, timeoutMs: number): Promise<string>;
  close(): void;
}

function respond(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/html",
    "content-length": Buffer.byteLength(body),
    connection: "close",
  });
  res.end(body);
}

/**
 * Localhost callback listener on an ephemeral port. Returns undefined when the
 * port cannot be bound (locked-down machine, container) — the caller then falls
 * back to the manual paste flow rather than failing the login.
 */
export async function startCallbackServer(): Promise<CallbackServer | undefined> {
  const server = http.createServer();
  const bound = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => resolve(true));
  });
  if (!bound) return undefined;

  const port = (server.address() as AddressInfo).port;
  return {
    port,
    redirectUri: `http://localhost:${port}/callback`,
    close: () => server.close(),
    waitForCode(expectedState, timeoutMs) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          server.removeListener("request", onRequest);
          reject(new Error("Timed out waiting for the OAuth callback."));
        }, timeoutMs);

        function finish(err: Error | undefined, code?: string): void {
          clearTimeout(timer);
          server.removeListener("request", onRequest);
          if (err) reject(err);
          else resolve(code!);
        }

        function onRequest(
          req: http.IncomingMessage,
          res: http.ServerResponse,
        ): void {
          const url = new URL(req.url ?? "/", `http://localhost:${port}`);
          const error = url.searchParams.get("error");
          if (error) {
            respond(res, 400, "<h1>Login cancelled</h1>");
            finish(new Error(`Anthropic returned an OAuth error: ${error}`));
            return;
          }
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code || !state) {
            // Favicon and stray probes land here; keep listening.
            respond(res, 400, "<h1>Missing code or state</h1>");
            return;
          }
          if (state !== expectedState) {
            respond(res, 400, "<h1>OAuth state mismatch</h1>");
            return;
          }
          respond(
            res,
            200,
            "<h1>Signed in</h1><p>You can close this window and return to freecode.</p>",
          );
          finish(undefined, code);
        }

        server.on("request", onRequest);
      });
    },
  };
}
