// apps/core/src/models-dev.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import https from "https";

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
}

export interface Provider {
  id: string;
  name: string;
  description?: string;
  models: ProviderModel[];
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

            for (const [providerId, providerData] of Object.entries(raw)) {
              const p = providerData as any;
              if (!p || !p.models) continue;

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
                });
              }

              providers.push({
                id: providerId,
                name: p.name || providerId,
                description: p.description || p.name || providerId,
                models,
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
  const models = await getProviderModels(providerId);
  const exact = models.find((m) => m.id === modelId);
  if (exact) return exact.limit?.context ?? 0;
  const lower = modelId.toLowerCase();
  const ci = models.find((m) => m.id.toLowerCase() === lower);
  return ci?.limit?.context ?? 0;
}
