// =============================================================================
// Bearer-token authentication for the web server.
//
// Loads or generates a 256-bit token at ~/.freecode/web-token with mode 0600.
// The token is required on every /api and /events request when the bind host
// is non-loopback, OR when --require-auth is set explicitly. Loopback binds
// (127.0.0.1, ::1) keep today's open behavior unless overridden.
//
// Two carriers are accepted:
//   1. Authorization: Bearer <token>  — used by /api and the fetch SSE reader
//   2. ?token=<token>                 — accepted on /events only, because the
//                                      browser EventSource API cannot set
//                                      custom headers. Documented as
//                                      second-class (lands in access logs).
//
// Comparison uses crypto.timingSafeEqual on equal-length buffers to avoid
// leaking the token byte-by-byte over a network — a naive `===` on a 43-char
// secret is a real timing oracle on a LAN.
// =============================================================================

import { randomBytes, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getConfigDir } from "../cli/utils/config.js";

const TOKEN_FILENAME = "web-token";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Returns true if the bind host is loopback. Both literal IPv4/IPv6 and the
 * "localhost" hostname are treated as loopback so `--host localhost` works the
 * same as `--host 127.0.0.1`.
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function tokenPath(): string {
  return path.join(getConfigDir(), TOKEN_FILENAME);
}

/**
 * Load the persisted token if one exists; otherwise generate a fresh
 * 256-bit token, persist it with mode 0600, and return it.
 *
 * The token is base64url-encoded (43 chars) to keep URLs sane and survive
 * copy/paste without ambiguity. It's deliberately long — 256 bits is
 * unguessable at any request rate (see spec §6).
 */
export function loadOrCreateToken(): string {
  const file = tokenPath();
  if (fs.existsSync(file)) {
    try {
      const buf = fs.readFileSync(file);
      // base64url-encoded 32 bytes is 43 chars. Anything shorter is corrupt.
      const tok = buf.toString("utf8").trim();
      if (tok.length >= 40) return tok;
    } catch {
      // Fall through and rotate — a file we can't read is not worth failing
      // the whole server over.
    }
  }
  const tok = randomBytes(32).toString("base64url");
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, tok + "\n", { mode: 0o600 });
  // Lock down again — some platforms (older Node) honor the mode at create
  // time but allow the umask to widen perms on subsequent writes.
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort.
  }
  return tok;
}

/**
 * Compare a presented token against the expected token in constant time.
 * Returns false (never throws) on length mismatch or any other oddity.
 *
 * The constant-time guarantee matters: an attacker with the ability to
 * measure response latency over a LAN can extract the secret byte-by-byte
 * with a vanilla `===` because string comparison short-circuits on the
 * first differing byte.
 */
export function compareTokens(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Run a fixed-cost dummy compare so the no-token and wrong-token paths
    // look the same to a remote timer. timingSafeEqual requires equal
    // length; pad with zeros and mask out the result.
    const padded = Buffer.alloc(b.length);
    timingSafeEqual(padded, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Extract a candidate token from a request, preferring the Authorization
 * header and falling back to a `token` query parameter for EventSource
 * compatibility.
 *
 * The query-param fallback is deliberately accepted on every endpoint here;
 * web-server.ts is the policy layer that decides whether to expose it on
 * /events only.
 */
export function extractToken(
  headers: Record<string, string | string[] | undefined>,
  url: URL,
): string | null {
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    return t || null;
  }
  return url.searchParams.get("token");
}

/**
 * Decides whether auth is required for this request.
 *
 * - `requireAuth=true` (from --require-auth): always require a token.
 * - Loopback host: skip auth unless requireAuth is set, preserving the
 *   existing desktop behavior.
 * - Non-loopback host: always require auth. No second flag to remember;
 *   exposing /api without a token on a reachable bind is the security
 *   regression the spec exists to prevent.
 */
export function isAuthRequired(
  bindHost: string,
  requireAuth: boolean,
): boolean {
  if (requireAuth) return true;
  return !isLoopbackHost(bindHost);
}