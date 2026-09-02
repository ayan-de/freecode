// apps/core/src/providers/config.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { envKeysFor as catalogueEnvKeys } from "./catalogue.js";

export const CONFIG_DIR = path.join(os.homedir(), ".freecode");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface ProviderCredentials {
  apiKey: string;
  model?: string;
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

export function readConfig(): Config {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  const content = fs.readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(content) as Config;
}

export function writeConfig(config: Config): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
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
  const config = readConfig();
  if (config.providers?.[providerId]?.apiKey) return true;
  const baseProvider = providerId.replace(/-coding-plan$/, "");
  return envKeysFor(baseProvider).some((key) => Boolean(process.env[key]));
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
