// =============================================================================
// Anthropic OAuth (Claude Pro/Max subscription) — Phase 0.
//
// Spec: `docs/superpowers/specs/2026-09-05-anthropic-oauth-provider.md`.
// Read §0.1 before touching this file: the subscription endpoint only answers
// requests that look like Claude Code, so this module impersonates it — Claude
// Code's OAuth client id, its User-Agent, its beta headers, and its identity
// string as the first system block. That impersonation is quarantined to the
// OAuth path; a request authenticated with a real API key must never carry any
// of it (tested in `anthropic-oauth.test.ts`).
//
// Phase 0 ships no login flow. Credentials come from importing the official
// Claude Code CLI's own login (`~/.claude/.credentials.json`) and are kept
// fresh by the refresh path below. Phase 1 adds `freecode auth login`.
// =============================================================================

import * as fs from "fs";
import type { SystemBlock } from "./types.js";
import {
  AUTH_FILE,
  CLAUDE_CODE_CREDENTIALS_FILE,
  type StoredAnthropicOAuth,
  readAnthropicOAuth,
  saveAnthropicOAuth,
} from "./auth-store.js";

/**
 * Claude Code's OAuth surface. Constants copied from jcode
 * (`crates/jcode-base/src/auth/oauth.rs`), which copied them from Claude Code.
 * The version strings rot as Claude Code ships (spec §9 Q2) — if OAuth
 * requests start failing, check these first.
 */
export const ANTHROPIC_OAUTH = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  refreshScopes:
    "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
  /**
   * Start minimal (spec §3.4): just the two betas the endpoint requires.
   * Extend only on observed rejection — jcode's full current list lives in
   * its `jcode-provider-core/src/anthropic.rs` if that day comes.
   */
  betas: "claude-code-20250219,oauth-2025-04-20",
  userAgent: "claude-cli/2.1.257 (external, sdk-cli)",
} as const;

export const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * Claude Code's billing-attribution line, which the official CLI carries as
 * the FIRST system block on the subscription path (jcode:
 * `jcode-provider-anthropic/src/lib.rs`, `OAUTH_BILLING_HEADER`, "observed in
 * the official CLI's system prompt blocks"). Despite the `x-anthropic-` name
 * it is a system block, not an HTTP header.
 *
 * `cc_version` matches `ANTHROPIC_OAUTH.userAgent` and rots with it — bump
 * both together (spec §9 Q2). `cch` is an opaque Claude Code build hash,
 * copied verbatim.
 */
export const CLAUDE_CODE_BILLING_BLOCK =
  "x-anthropic-billing-header: cc_version=2.1.257; cc_entrypoint=sdk-cli; cch=33f85;";

/**
 * Scopes the inference API accepts, per jcode's `claude_scopes_have_inference`.
 * The console authorize surface mints tokens that refresh fine but carry none
 * of these — storing one would 403 at request time, so exchange and refresh
 * both fail loudly instead (spec §3.1).
 */
const INFERENCE_SCOPES = new Set([
  "user:inference",
  "user:ccr_inference",
  "user:voice",
  "org:service_key_inference",
  "workspace:developer",
  "workspace:inference",
]);

export function ensureInferenceScope(scopes: string[], action: string): void {
  // Empty means the endpoint reported nothing, not that inference is missing.
  if (scopes.length === 0 || scopes.some((s) => INFERENCE_SCOPES.has(s))) {
    return;
  }
  throw new Error(
    `Anthropic OAuth ${action} returned a token without an inference scope ` +
      `(scopes: ${scopes.join(" ")}). Run \`freecode auth login anthropic\` to ` +
      `mint a token from the claude.ai surface — the console surface issues ` +
      `tokens the inference API refuses.`,
  );
}

export interface AnthropicOAuthOptions {
  tokenUrl?: string;
  authFile?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Phase 0 credential source: the official Claude Code CLI's own login.
 *
 * Parses a file owned by another program, so it schema-guards every field and
 * fails with a "re-login in Claude Code" message rather than a crash when the
 * format drifts (spec §9 Q3). Returns undefined only when the file is absent —
 * a present-but-unreadable file is an error worth surfacing.
 */
export function importClaudeCodeCredentials(
  credentialsFile: string = CLAUDE_CODE_CREDENTIALS_FILE,
  authFile: string = AUTH_FILE,
): StoredAnthropicOAuth | undefined {
  if (!fs.existsSync(credentialsFile)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(credentialsFile, "utf-8"));
  } catch {
    throw new Error(
      `${credentialsFile} is not valid JSON. Re-login in the official Claude Code CLI, then retry.`,
    );
  }
  const oauth = (parsed as { claudeAiOauth?: Record<string, unknown> })
    .claudeAiOauth;
  if (
    !oauth ||
    typeof oauth.accessToken !== "string" ||
    typeof oauth.refreshToken !== "string" ||
    typeof oauth.expiresAt !== "number"
  ) {
    throw new Error(
      `${credentialsFile} has no usable claudeAiOauth entry (the format may have ` +
        `changed). Re-login in the official Claude Code CLI, then retry.`,
    );
  }
  const scopes = Array.isArray(oauth.scopes)
    ? oauth.scopes.filter((s): s is string => typeof s === "string")
    : [];
  ensureInferenceScope(scopes, "import");

  const stored: StoredAnthropicOAuth = {
    type: "oauth",
    access_token: oauth.accessToken,
    refresh_token: oauth.refreshToken,
    expires_at: oauth.expiresAt,
    scopes,
  };
  saveAnthropicOAuth(stored, authFile);
  return stored;
}

// -----------------------------------------------------------------------------
// Refresh. Anthropic ROTATES refresh tokens: two concurrent refreshes can
// persist a dead token and permanently break the login (spec §3.3). Hence:
//  - single-flight per auth file — concurrent callers share one network call;
//  - rotation guard — re-read the store first, and if someone else already
//    refreshed (stored token differs, expiry fresh), use theirs, no network;
//  - terminal rejections — a token the endpoint permanently rejected is
//    remembered and never retried in this process.
// -----------------------------------------------------------------------------

const refreshFlights = new Map<string, Promise<StoredAnthropicOAuth>>();
const terminalRejections = new Map<string, string>();

/** Fresh enough that another process's refresh clearly just happened. */
function expiryIsFresh(expiresAt: number): boolean {
  return expiresAt - Date.now() > 60_000;
}

/**
 * Anthropic's token endpoint sits behind Cloudflare, which challenges some
 * networks and IPs before the request ever reaches Anthropic. jcode carries a
 * dedicated message for this because the raw 403 reads like a rejected login
 * and sends users to re-authenticate forever. Scar tissue from enforcement,
 * not theory (spec §0.1).
 */
export function looksLikeCloudflareChallenge(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("cf-challenge") ||
    lower.includes("cloudflare") ||
    lower.includes("just a moment") ||
    lower.includes("/cdn-cgi/challenge-platform")
  );
}

export const CLOUDFLARE_CHALLENGE_MESSAGE =
  "Anthropic's token endpoint was blocked by Cloudflare before it answered. " +
  "This network or IP is being challenged, not your login — switch network " +
  "(or VPN exit) and retry `freecode auth login anthropic --no-browser`, " +
  "pasting the callback URL.";

function isInvalidScopeError(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("invalid_scope") || lower.includes("scope is invalid");
}

async function postRefresh(
  refreshToken: string,
  scope: string | undefined,
  opts: AnthropicOAuthOptions,
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return fetchImpl(opts.tokenUrl ?? ANTHROPIC_OAUTH.tokenUrl, {
    method: "POST",
    // JSON, not form-encoded — Anthropic's token endpoint wants JSON.
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTHROPIC_OAUTH.clientId,
      ...(scope && { scope }),
    }),
  });
}

async function doRefresh(
  observedRefreshToken: string,
  opts: AnthropicOAuthOptions,
): Promise<StoredAnthropicOAuth> {
  const authFile = opts.authFile ?? AUTH_FILE;

  // Rotation guard: prefer the newest stored refresh token over the caller's
  // possibly stale observation, and skip the network entirely when the store
  // shows a refresh already happened.
  const stored = readAnthropicOAuth(authFile);
  if (
    stored &&
    stored.refresh_token !== observedRefreshToken &&
    expiryIsFresh(stored.expires_at)
  ) {
    return stored;
  }
  const refreshToken = stored?.refresh_token || observedRefreshToken;

  const terminal = terminalRejections.get(refreshToken);
  if (terminal) throw new Error(terminal);

  let resp = await postRefresh(refreshToken, ANTHROPIC_OAUTH.refreshScopes, opts);
  if (!resp.ok) {
    const text = await resp.text();
    if (isInvalidScopeError(text)) {
      // Legacy tokens reject Claude Code's scope list; retry without one.
      resp = await postRefresh(refreshToken, undefined, opts);
      if (!resp.ok) {
        const fallbackText = await resp.text();
        throw new Error(
          `Anthropic OAuth token refresh failed with scopes (${text}) and without (${fallbackText}).`,
        );
      }
    } else if (resp.status === 403 && looksLikeCloudflareChallenge(text)) {
      // Not a credential problem, so deliberately NOT marked terminal: the
      // same token works from another network.
      throw new Error(CLOUDFLARE_CHALLENGE_MESSAGE);
    } else {
      const message =
        `Anthropic OAuth token refresh failed (HTTP ${resp.status}): ${text}. ` +
        `Run \`freecode auth login anthropic\` to log in again.`;
      if ([400, 401, 403].includes(resp.status)) {
        // A permanently rejected token cannot start working again; remember it
        // so every subsequent turn fails fast instead of re-paying a doomed
        // round-trip.
        terminalRejections.set(refreshToken, message);
      }
      throw new Error(message);
    }
  }

  const body = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  const scopes = body.scope
    ? body.scope.split(/\s+/).filter(Boolean)
    : (stored?.scopes ?? []);
  ensureInferenceScope(scopes, "refresh");

  const next: StoredAnthropicOAuth = {
    type: "oauth",
    access_token: body.access_token,
    // The response may omit the rotated token; the old one stays valid then.
    refresh_token: body.refresh_token || refreshToken,
    expires_at: Date.now() + body.expires_in * 1000,
    scopes,
  };
  saveAnthropicOAuth(next, authFile);
  return next;
}

export function refreshAnthropicTokens(
  observedRefreshToken: string,
  opts: AnthropicOAuthOptions = {},
): Promise<StoredAnthropicOAuth> {
  const authFile = opts.authFile ?? AUTH_FILE;
  const inFlight = refreshFlights.get(authFile);
  if (inFlight) return inFlight;
  const flight = doRefresh(observedRefreshToken, opts).finally(() =>
    refreshFlights.delete(authFile),
  );
  refreshFlights.set(authFile, flight);
  return flight;
}

/** Refresh this far before expiry, so a token never dies mid-request. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * A valid access token: stored → imported from Claude Code → refreshed.
 * The per-request entry point; `createAnthropicOAuthFetch` calls this.
 */
export async function getAnthropicAccessToken(
  opts: AnthropicOAuthOptions = {},
): Promise<string> {
  const authFile = opts.authFile ?? AUTH_FILE;
  let stored = readAnthropicOAuth(authFile);
  if (!stored) stored = importClaudeCodeCredentials(undefined, authFile);
  if (!stored) {
    throw new Error(
      "No Anthropic OAuth credentials found. Run `freecode auth login " +
        "anthropic` (or log in with the official Claude Code CLI, whose " +
        "~/.claude/.credentials.json freecode imports), or set an API key and " +
        'providers.anthropic.authMode: "api-key".',
    );
  }
  if (stored.expires_at - Date.now() > REFRESH_MARGIN_MS) {
    return stored.access_token;
  }
  const refreshed = await refreshAnthropicTokens(stored.refresh_token, opts);
  return refreshed.access_token;
}

function mergedBetas(existing: string | null): string {
  if (!existing) return ANTHROPIC_OAUTH.betas;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const beta of [
    ...ANTHROPIC_OAUTH.betas.split(","),
    ...existing.split(","),
  ]) {
    const trimmed = beta.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged.join(",");
}

// -----------------------------------------------------------------------------
// "OAuth authentication is currently not allowed for this organization."
//
// Some orgs (and some accounts Anthropic has actioned) accept the token but
// refuse it at `/v1/messages` with a 403. Retrying is pointless and the raw
// error reads like a bad login, so the first one latches for the rest of the
// process and `generic-provider.ts` falls back to the API key when one is
// configured (spec §6 Phase 2, jcode's `is_anthropic_oauth_forbidden`).
//
// Detection lives here, at the fetch, because this is the one place that sees
// the raw response body: by the time the AI SDK has wrapped it, the shape
// differs between the generateText and streamText paths.
// -----------------------------------------------------------------------------

let forbiddenReason: string | undefined;

export function isOAuthForbiddenBody(status: number, body: string): boolean {
  if (status !== 403) return false;
  return (
    body.includes("OAuth authentication is currently not allowed") ||
    body.includes("permission_error")
  );
}

export function markAnthropicOAuthForbidden(reason: string): void {
  forbiddenReason ??= reason;
}

/** The reason string once a 403 has latched, else undefined. */
export function anthropicOAuthForbidden(): string | undefined {
  return forbiddenReason;
}

/**
 * The OAuth request seam (spec §4): composed onto the timeout fetch instead of
 * touching the SDK's `apiKey`, because per-request is where token refresh has
 * to live anyway. Rewrites each request to what the subscription endpoint
 * expects — bearer auth (the SDK's placeholder `x-api-key` deleted), the OAuth
 * betas merged with whatever betas the SDK already set, Claude Code's
 * User-Agent.
 */
export function createAnthropicOAuthFetch(
  baseFetch: typeof fetch,
  getToken: () => Promise<string> = () => getAnthropicAccessToken(),
): typeof fetch {
  return async function oauthFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${token}`);
    headers.set("anthropic-beta", mergedBetas(headers.get("anthropic-beta")));
    headers.set("user-agent", ANTHROPIC_OAUTH.userAgent);
    const resp = await baseFetch(input, { ...init, headers });
    if (resp.status === 403) {
      // Clone so the caller still gets an unread body. Only on 403, so the
      // happy path pays nothing.
      const body = await resp.clone().text().catch(() => "");
      if (isOAuthForbiddenBody(resp.status, body)) {
        markAnthropicOAuthForbidden(
          "Anthropic refused OAuth for this account or organization: " + body,
        );
      }
    }
    return resp;
  };
}

/**
 * System blocks with the Claude Code identity leading (spec §3.4). The real
 * system prompt follows unchanged, cache flags intact — the identity block
 * itself carries no cache marker because Anthropic caches everything up to a
 * marked block, so it rides inside whatever prefix the caller already caches.
 *
 * OAuth path ONLY. The API-key path must never call this (spec §0.1).
 */
export function withClaudeCodeIdentity(
  system: string | SystemBlock[] | undefined,
): SystemBlock[] {
  const blocks: SystemBlock[] =
    system === undefined
      ? []
      : typeof system === "string"
        ? [{ text: system }]
        : system;
  // Order matters and mirrors the official CLI: billing attribution, then
  // identity, then the caller's real prompt. Neither prepended block carries a
  // cache marker — Anthropic caches everything up to a marked block, so they
  // ride inside whatever prefix the caller already caches.
  return [
    { text: CLAUDE_CODE_BILLING_BLOCK },
    { text: CLAUDE_CODE_IDENTITY },
    ...blocks,
  ];
}

/** Test-only: forget single-flight and terminal-rejection state. */
export function resetAnthropicOAuthState(): void {
  refreshFlights.clear();
  terminalRejections.clear();
  forbiddenReason = undefined;
}
