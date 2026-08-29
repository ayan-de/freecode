// =============================================================================
// MiniMax web session — credentials
//
// Unlike gemini-web, this one genuinely needs a credential: a JWT lifted from a
// signed-in agent.minimaxi.com tab (DevTools -> Application -> Local Storage).
// There is no anonymous mode.
//
// The API signs requests against a user id as well as the token. That id is
// normally carried inside the JWT payload as `user.id`, but some accounts need
// a different one, so two extra shapes are accepted:
//
// Read from the `browsers` block of ~/.freecode/config.json — web sessions are
// kept out of `providers`, which is for metered API keys. `providers` is still
// consulted as a fallback so an older config keeps working.
//
//   browsers["minimax-web"].apiKey = "<jwt>"               → id from the JWT
//   browsers["minimax-web"].apiKey = "<realUserID>+<jwt>"  → id given inline
//   browsers["minimax-web"].realUserID = "..."             → id given apart
// =============================================================================

import { readSessionCredential } from "../config.js";

export interface MiniMaxWebSettings {
  jwtToken: string;
  realUserID: string;
}

/**
 * The `user.id` claim from a JWT payload, or "" if it cannot be read.
 *
 * Not a verification — we are reading a token we were handed, not trusting an
 * untrusted one, so the signature is irrelevant here and only the payload is
 * decoded.
 */
export function parseJwtUserId(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length !== 3) return "";

  let payload: string;
  try {
    payload = Buffer.from(parts[1], "base64url").toString("utf-8");
  } catch {
    return "";
  }

  // Read the id out of the RAW TEXT rather than via JSON.parse.
  //
  // MiniMax user ids are 18-digit numbers — one real token carries
  // 502526392868712457 — which is past Number.MAX_SAFE_INTEGER. When the JWT
  // encodes it as a JSON *number*, JSON.parse rounds it to 502526392868712450
  // and every request is then signed against a user that does not exist. The
  // id is concatenated into the signed query string, so the failure surfaces
  // as an auth rejection with nothing pointing at the last two digits.
  const user = payload.match(/"user"\s*:\s*\{/);
  if (user) {
    const id = payload
      .slice(user.index)
      .match(/"id"\s*:\s*(?:"([^"]*)"|(-?\d+))/);
    if (id) return id[1] ?? id[2] ?? "";
  }
  return "";
}

/** Splits the three accepted credential shapes into token + user id. */
export function parseCredential(
  rawToken: string,
  explicitUserId?: string,
): MiniMaxWebSettings {
  const raw = rawToken.trim().replace(/^Bearer /, "");

  if (explicitUserId?.trim()) {
    return { jwtToken: raw, realUserID: explicitUserId.trim() };
  }
  // A JWT is base64url, which never contains "+", so a "+" is unambiguously
  // the realUserID separator rather than part of the token.
  const plus = raw.indexOf("+");
  if (plus !== -1) {
    return {
      realUserID: raw.slice(0, plus),
      jwtToken: raw.slice(plus + 1),
    };
  }
  return { jwtToken: raw, realUserID: parseJwtUserId(raw) };
}

export function loadMiniMaxWebSettings(): MiniMaxWebSettings {
  const entry = readSessionCredential("minimax-web") as {
    apiKey?: string;
    realUserID?: string;
  };
  return parseCredential(entry.apiKey ?? "", entry.realUserID);
}
