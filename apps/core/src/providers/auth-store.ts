// =============================================================================
// OAuth token storage — `~/.freecode/auth.json`.
//
// A separate file from `config.json` on purpose (spec
// `2026-09-05-anthropic-oauth-provider.md` §3.5): config is user-edited and
// sometimes committed to dotfiles; this file holds machine-written secrets and
// is kept at mode 0600. Nothing in here talks to the network — the protocol
// lives in `anthropic-oauth.ts`, and both `config.ts` and the OAuth module
// import this so neither has to import the other.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const AUTH_FILE = path.join(os.homedir(), ".freecode", "auth.json");

/** The official Claude Code CLI's own login, importable as Phase 0 auth. */
export const CLAUDE_CODE_CREDENTIALS_FILE = path.join(
  os.homedir(),
  ".claude",
  ".credentials.json",
);

export interface StoredAnthropicOAuth {
  type: "oauth";
  access_token: string;
  refresh_token: string;
  /** ms since epoch. */
  expires_at: number;
  scopes: string[];
}

function readAuthFile(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    // A corrupt auth file must not brick every provider call; treat it as
    // empty and let the next save rewrite it whole.
    return {};
  }
}

export function readAnthropicOAuth(
  file: string = AUTH_FILE,
): StoredAnthropicOAuth | undefined {
  const entry = readAuthFile(file)["anthropic"] as
    | Partial<StoredAnthropicOAuth>
    | undefined;
  if (
    entry &&
    entry.type === "oauth" &&
    typeof entry.access_token === "string" &&
    typeof entry.refresh_token === "string" &&
    typeof entry.expires_at === "number"
  ) {
    return {
      type: "oauth",
      access_token: entry.access_token,
      refresh_token: entry.refresh_token,
      expires_at: entry.expires_at,
      scopes: Array.isArray(entry.scopes) ? entry.scopes : [],
    };
  }
  return undefined;
}

/** Merges under the `anthropic` key so future providers can share the file. */
export function saveAnthropicOAuth(
  tokens: StoredAnthropicOAuth,
  file: string = AUTH_FILE,
): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const all = readAuthFile(file);
  all["anthropic"] = tokens;
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
  // `mode` only applies at creation; an existing file keeps its old bits.
  fs.chmodSync(file, 0o600);
}

export function hasStoredAnthropicOAuth(file: string = AUTH_FILE): boolean {
  return readAnthropicOAuth(file) !== undefined;
}

export function hasImportableClaudeCodeLogin(
  file: string = CLAUDE_CODE_CREDENTIALS_FILE,
): boolean {
  return fs.existsSync(file);
}

/** Drops the anthropic entry (`freecode auth logout`), leaving other providers. */
export function deleteAnthropicOAuth(file: string = AUTH_FILE): boolean {
  const all = readAuthFile(file);
  if (!("anthropic" in all)) return false;
  delete all["anthropic"];
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return true;
}
