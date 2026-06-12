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
  current?: {
    provider: string;
    model: string;
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
};

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

export function hasApiKey(providerId: string): boolean {
  const config = readConfig();
  if (config.providers?.[providerId]?.apiKey) return true;
  const baseProvider = providerId.replace(/-coding-plan$/, "");
  const envKey = ENV_KEYS[baseProvider];
  if (envKey && process.env[envKey]) return true;
  return false;
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
