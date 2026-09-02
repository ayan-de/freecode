// apps/core/src/models-dev.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import https from "https";
import { OUTPUT_TOKEN_CAP } from "./providers/utils.js";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const CACHE_DIR = path.join(os.homedir(), ".freecode", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "models-dev.json");

/** Token limits for a model, as reported by models.dev. */
export interface ModelLimit {
  /** Context-window size (max input tokens). */
  context: number;
  /** Max output tokens per response. */
  output: number;
}

export interface ProviderModel {
  id: string;
  name: string;
  description?: string;
  /** Present when models.dev reports limits for this model. */
  limit?: ModelLimit;
  /** Input modalities, e.g. ["text", "image", "pdf"]. Absent if unreported. */
  inputModalities?: string[];
}

export interface Provider {
  id: string;
  name: string;
  description?: string;
  models: ProviderModel[];
  /**
   * SDK package name, custom endpoint, and env var names, as models.dev
   * publishes them. Carried through so `providers/catalogue.ts` can construct
   * a provider from this data instead of a hand-maintained table; absent on a
   * cache written before that existed.
   */
  npm?: string;
  api?: string;
  env?: string[];
}

let cache: { data: Provider[]; timestamp: number } | null = null;

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadFromDisk(): Provider[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const content = fs.readFileSync(CACHE_FILE, "utf-8");
    const cached = JSON.parse(content);
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function saveToDisk(providers: Provider[]): void {
  ensureCacheDir();
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ data: providers, timestamp: Date.now() }, null, 2),
  );
}

/**
 * The disk cache regardless of its TTL, for callers that need an answer
 * without a network round trip.
 *
 * `loadFromDisk` returns null once the cache is 5 minutes old, which is right
 * for the model picker — a stale model list is a wrong model list. It is wrong
 * for provider *identity*, which changes on the order of months: a five-minute
 * expiry there would mean falling back to the shipped snapshot on almost every
 * run, discarding a cache that is still correct.
 */
export function readCachedProviders(): Provider[] | null {
  if (cache) return cache.data;
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    return Array.isArray(cached?.data) ? (cached.data as Provider[]) : null;
  } catch {
    return null;
  }
}

async function fetchFromNetwork(): Promise<Provider[]> {
  return new Promise((resolve, reject) => {
    https
      .get(MODELS_DEV_URL, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const raw = JSON.parse(data);
            const providers: Provider[] = [];

            for (const [rawProviderId, providerData] of Object.entries(raw)) {
              const p = providerData as any;
              if (!p || !p.models) continue;
              // models.dev calls Google's provider "google"; our registry
              // registers it as "gemini" (providers/catalogue.ts).
              const providerId =
                rawProviderId === "google" ? "gemini" : rawProviderId;

              const models: ProviderModel[] = [];
              for (const [modelId, modelData] of Object.entries(
                p.models as Record<string, any>,
              )) {
                if (!modelData) continue;
                models.push({
                  id: modelId,
                  name: modelData.name || modelId,
                  description:
                    modelData.description || modelData.name || modelId,
                  limit:
                    modelData.limit &&
                    typeof modelData.limit.context === "number"
                      ? {
                          context: modelData.limit.context,
                          output: modelData.limit.output ?? 0,
                        }
                      : undefined,
                  inputModalities: Array.isArray(modelData.modalities?.input)
                    ? (modelData.modalities.input as string[])
                    : undefined,
                });
              }

              providers.push({
                id: providerId,
                name: p.name || providerId,
                description: p.description || p.name || providerId,
                models,
                ...(typeof p.npm === "string" ? { npm: p.npm } : {}),
                ...(typeof p.api === "string" ? { api: p.api } : {}),
                ...(Array.isArray(p.env) ? { env: p.env as string[] } : {}),
              });
            }

            resolve(providers);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

export async function getProviders(forceRefresh = false): Promise<Provider[]> {
  if (!forceRefresh && cache) {
    return cache.data;
  }

  const diskCache = loadFromDisk();
  if (diskCache && !forceRefresh) {
    cache = { data: diskCache, timestamp: Date.now() };
    return cache.data;
  }

  try {
    const providers = await fetchFromNetwork();
    cache = { data: providers, timestamp: Date.now() };
    saveToDisk(providers);
    return providers;
  } catch (err) {
    // If network fails but we have disk cache, use it
    if (diskCache) {
      cache = { data: diskCache, timestamp: Date.now() };
      return cache.data;
    }
    throw err;
  }
}

export async function getProviderModels(
  providerId: string,
): Promise<ProviderModel[]> {
  const providers = await getProviders();
  const provider = providers.find((p) => p.id === providerId);
  return provider?.models || [];
}

/**
 * The single source of truth for a model's context-window size. Reads the
 * limit models.dev reports for `providerId/modelId`; frontends call this over
 * IPC (`models.contextLimit`) instead of hardcoding their own tables.
 *
 * Matching is exact first, then case-insensitive on the model id, since
 * provider/model ids from config vary in casing. Returns `0` when the model
 * is unknown so callers can hide a context meter rather than divide by zero.
 */
export async function getModelContextLimit(
  providerId: string,
  modelId: string,
): Promise<number> {
  return (await findModelLimit(providerId, modelId))?.context ?? 0;
}

/**
 * The model's maximum reply length, as reported by models.dev. Returns `0`
 * when unknown so callers can fall back rather than reserve nothing.
 */
export async function getModelOutputLimit(
  providerId: string,
  modelId: string,
): Promise<number> {
  return (await findModelLimit(providerId, modelId))?.output ?? 0;
}

/**
 * How many tokens to reserve for the reply on a request to `providerId/modelId`.
 *
 * Providers charge `max_tokens` against the same context window as the input,
 * so this number is subtracted twice over: once from what the conversation may
 * occupy, and again by the API when it validates the request. It must
 * therefore be the *same* value at both sites — sending one number while
 * budgeting against another is how a session ends up rejected at a threshold
 * it believed it was under.
 *
 * The model's own ceiling wins when it is lower than the cap; an unknown model
 * (limit 0) falls back to the cap rather than reserving nothing.
 */
export async function resolveMaxOutputTokens(
  providerId: string,
  modelId: string | undefined,
): Promise<number> {
  if (!modelId) return OUTPUT_TOKEN_CAP;
  const limit = await getModelOutputLimit(providerId, modelId).catch(() => 0);
  return Math.min(limit || OUTPUT_TOKEN_CAP, OUTPUT_TOKEN_CAP);
}

// Exact match first, then case-insensitive: provider/model ids from config
// vary in casing.
async function findModelLimit(
  providerId: string,
  modelId: string,
): Promise<ModelLimit | undefined> {
  const models = await getProviderModels(providerId);
  const exact = models.find((m) => m.id === modelId);
  if (exact) return exact.limit;
  const lower = modelId.toLowerCase();
  return models.find((m) => m.id.toLowerCase() === lower)?.limit;
}

/**
 * Whether a model accepts image input. Vision is a *model* capability, not a
 * provider one — anthropic ships text-only models and some text-first
 * providers ship vision models — so this reads models.dev per model rather
 * than keeping a hardcoded provider allowlist.
 *
 * Unknown models return false: sending an image part to a text-only model is
 * a hard 400 from the provider, so failing closed with a message the user can
 * act on beats a request that dies on the wire.
 */
export async function modelSupportsImages(
  providerId: string,
  modelId: string | undefined,
): Promise<boolean> {
  if (!modelId) return false;
  const models = await getProviderModels(providerId).catch(() => []);
  const lower = modelId.toLowerCase();
  const match =
    models.find((m) => m.id === modelId) ??
    models.find((m) => m.id.toLowerCase() === lower);
  return match?.inputModalities?.includes("image") ?? false;
}
