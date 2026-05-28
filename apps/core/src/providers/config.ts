// apps/core/src/providers/config.ts
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export const CONFIG_DIR = path.join(os.homedir(), '.freecode')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export interface ProviderCredentials {
  apiKey: string
}

export interface Config {
  providers?: {
    anthropic?: ProviderCredentials
    openai?: ProviderCredentials
    gemini?: ProviderCredentials
    minimax?: ProviderCredentials
  }
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function readConfig(): Config {
  ensureConfigDir()
  if (!fs.existsSync(CONFIG_FILE)) {
    return {}
  }
  const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
  return JSON.parse(content) as Config
}

export function writeConfig(config: Config): void {
  ensureConfigDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

export type ProviderId = "anthropic" | "openai" | "gemini" | "minimax"

const ENV_KEYS: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  minimax: "MINIMAX_API_KEY",
}

export function getApiKey(providerId: ProviderId): string {
  // Priority 1: config file
  const config = readConfig()
  const configKey = config.providers?.[providerId]?.apiKey
  if (configKey) return configKey

  // Priority 2: environment variable
  const envKey = ENV_KEYS[providerId]
  const envValue = process.env[envKey]
  if (envValue) return envValue

  // Error — provide helpful message
  const configPathHint = `~/${path.join('.freecode', 'config.json')}`
  throw new Error(
    `API key for "${providerId}" not found. Set in ${configPathHint} under providers.${providerId}.apiKey ` +
    `or set ${envKey} environment variable.`
  )
}