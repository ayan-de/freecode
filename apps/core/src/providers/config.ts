// apps/core/src/providers/config.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { envKeysFor as catalogueEnvKeys } from "./catalogue.js";
import { hasStoredAnthropicOAuth } from "./auth-store.js";
import { logger } from "../utils/logger.js";

export const CONFIG_DIR = path.join(os.homedir(), ".freecode");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface ProviderCredentials {
  apiKey: string;
  model?: string;
  /**
   * Anthropic only: "oauth" authenticates with a stored Claude Pro/Max
   * subscription login instead of a metered key. Opt-in, never the default —
   * see spec `2026-09-05-anthropic-oauth-provider.md` §0.1 for why.
   */
  authMode?: "oauth" | "api-key";
}

/**
 * What a web-session provider needs to authenticate, if anything.
 *
 * Every field is optional, and an absent entry is the normal case: a session
 * that works anonymously has nothing to store. Absence means "anonymous", never
 * "misconfigured" — see `hasWebCredential`.
 */
export interface WebCredentials {
  /** Raw Cookie header value from a signed-in tab. */
  cookie?: string;
  /** Path to a file holding that header, when it is too long to paste. */
  cookieFile?: string;
  /** Account index, when the signed-in URL carries one (`/u/<n>/app`). */
  authUser?: string;
  /** Page XSRF token, sent as a form field by some endpoints. */
  xsrfToken?: string;
  /** A bearer token lifted from a signed-in tab, for sessions that use one. */
  apiKey?: string;
}

export interface Config {
  providers?: Record<string, ProviderCredentials>;
  /**
   * Web-session providers, deliberately kept out of `providers`.
   *
   * `providers` holds metered API keys — a key there bills a card. `web` holds
   * whatever a browser session needs instead: a cookie, a JWT lifted from a
   * signed-in tab, or nothing at all. Different secrets, different lifetimes,
   * different blast radius, and one block means you cannot tell by looking
   * whether an entry costs money.
   */
  web?: Record<string, WebCredentials>;
  current?: {
    provider: string;
    model: string;
  };
  lastAgentMode?: string;
  // Phase 4 recovery: providers to fall back to (in order) when the current
  // provider exhausts its retry budget or hits a fatal error.
  recovery?: {
    fallbackProviders?: string[];
  };
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

let warnedMalformedConfig = false;

export function readConfig(): Config {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  const content = fs.readFileSync(CONFIG_FILE, "utf-8");
  try {
    const parsed = JSON.parse(content) as Config;
    warnedMalformedConfig = false;
    return parsed;
  } catch (err) {
    // A stray comma from a hand edit must degrade to "no provider configured",
    // not take down loop construction — every other settings loader warns and
    // falls back. Once per breakage, not once per turn: readConfig runs at
    // least once per turn and stderr reaches the TUI as a system message.
    if (!warnedMalformedConfig) {
      warnedMalformedConfig = true;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Malformed ${CONFIG_FILE} (${msg}); treating as empty until it parses again`,
      );
    }
    return {};
  }
}

export function writeConfig(config: Config): void {
  ensureConfigDir();
  // Never clobber a file that no longer parses: every mutator here is a
  // read-modify-write, and a malformed read degrades to `{}` above — writing
  // that back would silently destroy every stored API key mid-hand-edit.
  // Preserve the original alongside first.
  if (fs.existsSync(CONFIG_FILE)) {
    const existing = fs.readFileSync(CONFIG_FILE, "utf-8");
    try {
      JSON.parse(existing);
    } catch {
      const backup = `${CONFIG_FILE}.invalid`;
      fs.copyFileSync(CONFIG_FILE, backup);
      try {
        fs.chmodSync(backup, 0o600); // it still holds the keys
      } catch {
        // Best effort.
      }
      logger.warn(
        `Overwriting malformed ${CONFIG_FILE}; original preserved as ${backup}`,
      );
    }
  }
  // config.json holds every API key and any web-session cookie; owner-only.
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  // Lock down again — `mode` applies only at create time, so a pre-existing
  // file (or a platform that lets the umask widen perms on rewrite) keeps
  // whatever mode it already had without this.
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Best effort.
  }
}

export type ProviderId = string; // Can be "anthropic", "openai", "gemini", "minimax", "minimax-coding-plan", etc.

/**
 * Env var names for a provider, from the models.dev-derived catalogue, falling
 * back to the conventional `<PROVIDER>_API_KEY` for ids the catalogue does not
 * carry (web-session providers, `-coding-plan` variants).
 */
function envKeysFor(providerId: string): string[] {
  const keys = catalogueEnvKeys(providerId);
  if (keys.length > 0) return keys;
  return [`${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`];
}

/**
 * The configured key for a provider: config file first, then env vars.
 *
 * `envKeys` is passed in by the caller that already has the catalogue entry
 * (the generic provider); callers without one fall back to looking it up.
 * Either way the names come from models.dev rather than a hand-kept table —
 * a second table is how `zai` ended up reading ZAI_API_KEY while models.dev
 * published ZHIPU_API_KEY, with nothing to notice the disagreement.
 */
export function getApiKey(providerId: string, envKeys?: string[]): string {
  const config = readConfig();

  // Try exact match first
  const configKey = config.providers?.[providerId]?.apiKey;
  if (configKey) return configKey;

  // Try base provider (e.g., "minimax-coding-plan" -> "minimax")
  const baseProvider = providerId.replace(/-coding-plan$/, "");
  const baseConfigKey = config.providers?.[baseProvider]?.apiKey;
  if (baseConfigKey) return baseConfigKey;

  // Priority 2: environment variables, in the catalogue's own precedence order
  const candidates =
    envKeys && envKeys.length > 0 ? envKeys : envKeysFor(baseProvider);
  for (const key of candidates) {
    const envValue = process.env[key];
    if (envValue) return envValue;
  }

  // Error — provide helpful message
  const configPathHint = `~/${path.join(".freecode", "config.json")}`;
  throw new Error(
    `API key for "${providerId}" not found. Set in ${configPathHint} under providers.${providerId}.apiKey ` +
      `or set the ${candidates.join(" or ")} environment variable.`,
  );
}

export function getCurrentModel():
  | { provider: string; model: string }
  | undefined {
  const config = readConfig();
  return config.current;
}

export function setCurrentModel(provider: string, model: string): void {
  const config = readConfig();
  config.current = { provider, model };
  writeConfig(config);
}

export function getLastAgentMode(): string | undefined {
  return readConfig().lastAgentMode;
}

export function setLastAgentMode(mode: string): void {
  const config = readConfig();
  config.lastAgentMode = mode;
  writeConfig(config);
}

export function hasApiKey(providerId: string): boolean {
  // OAuth stands in for a key: provider listing must show anthropic as
  // configured when a subscription login is on file, or the UI would demand a
  // key the request path will never read.
  if (
    providerId === "anthropic" &&
    anthropicAuthMode() === "oauth" &&
    hasStoredAnthropicOAuth()
  ) {
    return true;
  }
  return hasConfiguredKey(providerId);
}

/**
 * A real API key, ignoring OAuth. `hasApiKey` deliberately answers true for an
 * anthropic subscription login; the OAuth→API-key fallback needs the narrower
 * question, "is there a key to fall back TO?".
 */
export function hasConfiguredKey(providerId: string): boolean {
  const config = readConfig();
  if (config.providers?.[providerId]?.apiKey) return true;
  const baseProvider = providerId.replace(/-coding-plan$/, "");
  return envKeysFor(baseProvider).some((key) => Boolean(process.env[key]));
}

export type AnthropicAuthMode = "oauth" | "api-key";

function normalizeAuthMode(value: string | undefined): AnthropicAuthMode | undefined {
  if (value === "oauth") return "oauth";
  if (value === "api-key" || value === "apiKey") return "api-key";
  return undefined;
}

/**
 * How the `anthropic` provider authenticates. Resolution:
 * `FREECODE_ANTHROPIC_AUTH` env pin → `providers.anthropic.authMode` in
 * config → default. The default is API-key whenever one exists — a machine
 * with a key never silently switches to the subscription — and falls back to
 * OAuth only when no key is configured but a login is already stored in
 * `~/.freecode/auth.json` (mirrors jcode's resolution, keeps zero-config
 * working after a login). Note import from Claude Code does NOT count here:
 * OAuth without an explicit opt-in requires freecode's own stored login.
 */
export function anthropicAuthMode(): AnthropicAuthMode {
  const pinned = normalizeAuthMode(process.env.FREECODE_ANTHROPIC_AUTH);
  if (pinned) return pinned;
  const configured = normalizeAuthMode(
    readConfig().providers?.["anthropic"]?.authMode,
  );
  if (configured) return configured;
  if (hasConfiguredKey("anthropic")) return "api-key";
  return hasStoredAnthropicOAuth() ? "oauth" : "api-key";
}

export function setApiKey(
  providerId: string,
  apiKey: string,
  model?: string,
): void {
  const config = readConfig();
  if (!config.providers) config.providers = {};

  config.providers[providerId] = { apiKey, ...(model && { model }) };
  writeConfig(config);
}

/**
 * A web-session provider's stored credential: the `web` block, then
 * `providers` as a fallback.
 *
 * The fallback is not permanent kindness. `gemini-web` shipped documenting its
 * cookie under `providers["gemini-web"]`, so dropping that read would make an
 * existing cookie silently stop applying — which surfaces as Pro quietly
 * serving Flash, not as an error.
 */
export function readWebCredential(
  providerId: string,
  config: Config = readConfig(),
): WebCredentials {
  const web = config.web?.[providerId];
  if (web && Object.keys(web).length > 0) return web;
  return (config.providers?.[providerId] ?? {}) as WebCredentials;
}

/**
 * Is a credential actually on file for this web provider?
 *
 * `authUser` and `xsrfToken` deliberately do not count: they modify a session
 * rather than authenticate one, so an entry holding only those is still
 * anonymous and should say so.
 */
export function hasWebCredential(providerId: string): boolean {
  const credential = readWebCredential(providerId);
  return Boolean(
    credential.cookie || credential.cookieFile || credential.apiKey,
  );
}

/** Merges, rather than replaces, so saving a cookie keeps `authUser` beside it. */
export function setWebCredential(
  providerId: string,
  credential: WebCredentials,
): void {
  const config = readConfig();
  if (!config.web) config.web = {};
  config.web[providerId] = { ...config.web[providerId], ...credential };
  writeConfig(config);
}

/**
 * Pin (or, with undefined, un-pin) how `anthropic` authenticates. Written by
 * `freecode auth login/logout` — an explicit login is one of the two opt-ins
 * §0.1 of the OAuth spec allows, and an explicit logout takes it back.
 */
export function setAnthropicAuthMode(mode: AnthropicAuthMode | undefined): void {
  const config = readConfig();
  if (!config.providers) config.providers = {};
  const entry = config.providers["anthropic"] ?? {};
  if (mode) entry.authMode = mode;
  else delete entry.authMode;
  config.providers["anthropic"] = entry;
  writeConfig(config);
}

/**
 * "oauth" when a call to this provider right now is billed to a subscription
 * rather than a key — stamped onto `model.response` so the cost of a recorded
 * call never depends on how the machine reading the log is configured.
 */
export function subscriptionAuth(providerId: string): "oauth" | undefined {
  return providerId === "anthropic" && anthropicAuthMode() === "oauth"
    ? "oauth"
    : undefined;
}

/**
 * `Config` with every secret replaced by whether it is set.
 *
 * `apiKey`, and each of the four secret-bearing `WebCredentials` fields, are
 * the whole reason this shape exists: nothing that authenticates is worth
 * sending anywhere, and the only question a caller ever asked of them was
 * "is one configured". `hasApiKey`/`hasCredential` answer that.
 */
export interface RedactedConfig {
  providers?: Record<
    string,
    { hasApiKey: boolean; model?: string; authMode?: AnthropicAuthMode }
  >;
  web?: Record<string, { hasCredential: boolean }>;
  current?: Config["current"];
  lastAgentMode?: string;
  recovery?: Config["recovery"];
}

/**
 * The safe view of `config.json`, for anything that leaves the process.
 *
 * Built field by field rather than by deleting known secrets from a spread: a
 * blocklist is wrong the day a credential field is added, and this file's
 * `WebCredentials` has grown one twice.
 */
export function redactConfig(config: Config = readConfig()): RedactedConfig {
  const redacted: RedactedConfig = {};
  if (config.providers) {
    redacted.providers = Object.fromEntries(
      Object.entries(config.providers).map(([id, entry]) => [
        id,
        {
          hasApiKey: Boolean(entry?.apiKey),
          ...(entry?.model ? { model: entry.model } : {}),
          ...(entry?.authMode ? { authMode: entry.authMode } : {}),
        },
      ]),
    );
  }
  if (config.web) {
    redacted.web = Object.fromEntries(
      Object.entries(config.web).map(([id, credential]) => [
        id,
        {
          hasCredential: Boolean(
            credential?.cookie || credential?.cookieFile || credential?.apiKey,
          ),
        },
      ]),
    );
  }
  if (config.current) redacted.current = config.current;
  if (config.lastAgentMode) redacted.lastAgentMode = config.lastAgentMode;
  if (config.recovery) redacted.recovery = config.recovery;
  return redacted;
}
