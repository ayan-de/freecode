// apps/core/src/providers/config.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const CONFIG_DIR = path.join(os.homedir(), ".freecode");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface ProviderCredentials {
  apiKey: string;
  model?: string;
}

export interface Config {
  providers?: Record<string, ProviderCredentials>;
  /**
   * Web-session providers, kept apart from `providers` on purpose.
   *
   * `providers` holds metered API keys. `browsers` holds whatever a browser
   * session needs instead — a JWT lifted from a signed-in tab, a cookie, or
   * nothing at all. They are different kinds of credential with different
   * lifetimes and different blast radius, and mixing them makes it impossible
   * to tell by looking whether an entry costs money.
   */
  browsers?: Record<string, ProviderCredentials>;
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

const ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  zai: "ZAI_API_KEY",
};

/**
 * A web-session provider's config entry: `browsers` first, then `providers`.
 *
 * The fallback is not permanent kindness — it is what stops an existing setup
 * breaking the moment `browsers` landed, and what makes the TUI's key prompt
 * work regardless of which block the user filled in.
 */
export function readSessionCredential(
  providerId: string,
  config: Config = readConfig(),
): Record<string, unknown> {
  const browsers = config.browsers?.[providerId] as
    | Record<string, unknown>
    | undefined;
  if (browsers && Object.keys(browsers).length > 0) return browsers;
  return (config.providers?.[providerId] ?? {}) as Record<string, unknown>;
}

export function getApiKey(providerId: string): string {
  const config = readConfig();

  // Try exact match first
  const configKey = config.providers?.[providerId]?.apiKey;
  if (configKey) return configKey;

  // Try base provider (e.g., "minimax-coding-plan" -> "minimax")
  const baseProvider = providerId.replace(/-coding-plan$/, "");
  const baseConfigKey = config.providers?.[baseProvider]?.apiKey;
  if (baseConfigKey) return baseConfigKey;

  // Priority 2: environment variable
  const envKey = ENV_KEYS[providerId];
  if (envKey) {
    const envValue = process.env[envKey];
    if (envValue) return envValue;
  }

  // Try base provider env key
  const baseEnvKey = ENV_KEYS[baseProvider];
  if (baseEnvKey) {
    const envValue = process.env[baseEnvKey];
    if (envValue) return envValue;
  }

  // Error — provide helpful message
  const configPathHint = `~/${path.join(".freecode", "config.json")}`;
  throw new Error(
    `API key for "${providerId}" not found. Set in ${configPathHint} under providers.${providerId}.apiKey ` +
      `or set ${ENV_KEYS[baseProvider] || baseProvider.toUpperCase() + "_API_KEY"} environment variable.`,
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
  // `browsers` first: a web session's credential lives there, and reporting it
  // as missing makes the model picker demand a key the user already supplied.
  if (config.browsers?.[providerId]?.apiKey) return true;
  if (config.providers?.[providerId]?.apiKey) return true;
  const baseProvider = providerId.replace(/-coding-plan$/, "");
  const envKey = ENV_KEYS[baseProvider];
  if (envKey && process.env[envKey]) return true;
  return false;
}

/**
 * Merges rather than replaces. Wholesale assignment dropped every sibling
 * field, so re-entering a key through the TUI silently discarded a
 * hand-written `realUserID` or `cookieFile` next to it.
 */
export function mergeCredential(
  existing: ProviderCredentials | undefined,
  apiKey: string,
  model?: string,
): ProviderCredentials {
  return { ...existing, apiKey, ...(model && { model }) };
}

export function setApiKey(
  providerId: string,
  apiKey: string,
  model?: string,
  scope: "providers" | "browsers" = "providers",
): void {
  const config = readConfig();
  const block = (config[scope] ??= {});
  block[providerId] = mergeCredential(block[providerId], apiKey, model);
  writeConfig(config);
}
