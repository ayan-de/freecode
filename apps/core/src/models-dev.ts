// apps/core/src/models-dev.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OUTPUT_TOKEN_CAP } from "./providers/utils.js";
import { canonicalProviderId } from "./providers/canonical-id.js";

/**
 * Where the catalogue comes from. `FREECODE_MODELS_URL` redirects it — for an
 * air-gapped install pointing at an internal mirror, and for tests that must
 * not reach the network. (opencode carries the same seam as
 * `OPENCODE_MODELS_URL`, and defaults to a mirror it controls rather than
 * models.dev directly.)
 */
function modelsUrl(): string {
  return process.env.FREECODE_MODELS_URL ?? "https://models.dev/api.json";
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Give up on a single attempt after this long.
 *
 * `FREECODE_MODELS_TIMEOUT_MS` overrides it.
 *
 * Without it a hung connection hangs forever: `https.get` has no default
 * timeout, and this feed is now on the path of the model picker, provider
 * identity, and pricing. A stalled socket would leave all three waiting on a
 * response that never comes, with no error to fall back from.
 */
function fetchTimeoutMs(): number {
  const raw = Number(process.env.FREECODE_MODELS_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}

/** Attempts per fetch. Transient 5xx and dropped sockets are common enough
 *  that one failure should not push every caller onto the stale-cache path. */
const FETCH_ATTEMPTS = 3;

const CACHE_DIR = path.join(os.homedir(), ".freecode", "cache");

/**
 * Where the models.dev response is cached.
 *
 * `FREECODE_MODELS_CACHE_FILE` redirects it, which is what makes anything
 * reading this cache testable — `providers/pricing.ts` now derives rates from
 * it, and a test that asserts a price must not depend on whether the developer
 * running it happens to have opened the model picker. (opencode carries the
 * same seam as `OPENCODE_MODELS_PATH`.) Resolved per call, not once at import,
 * so a test can set it after this module is loaded.
 */
function cacheFile(): string {
  return (
    process.env.FREECODE_MODELS_CACHE_FILE ??
    path.join(CACHE_DIR, "models-dev.json")
  );
}

/** Token limits for a model, as reported by models.dev. */
export interface ModelLimit {
  /** Context-window size (max input tokens). */
  context: number;
  /** Max output tokens per response. */
  output: number;
}

/** USD per million tokens, as models.dev publishes them. */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ProviderModel {
  id: string;
  name: string;
  description?: string;
  /** Present when models.dev reports limits for this model. */
  limit?: ModelLimit;
  /** Present when models.dev publishes a rate card for this model. */
  cost?: ModelCost;
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
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, "utf-8");
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
    cacheFile(),
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
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    const cached = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(cached?.data) ? (cached.data as Provider[]) : null;
  } catch {
    return null;
  }
}

/** When the disk cache was written, or null when there is none. */
export function readCachedProvidersWrittenAt(): Date | null {
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    const cached = JSON.parse(fs.readFileSync(file, "utf-8"));
    return typeof cached?.timestamp === "number"
      ? new Date(cached.timestamp)
      : null;
  } catch {
    return null;
  }
}

/**
 * One attempt: GET the catalogue as text, or throw.
 *
 * `fetch` rather than `https.get` — it carries a real timeout via
 * `AbortSignal.timeout` instead of the socket-timeout dance, and it honours
 * whatever protocol `FREECODE_MODELS_URL` names. That matters: an internal
 * mirror for an air-gapped install is as likely to be plain http on a private
 * network as it is to be https.
 */
async function fetchOnce(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(fetchTimeoutMs()),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`models.dev returned ${res.status}`);
  }
  return await res.text();
}

async function fetchFromNetwork(): Promise<Provider[]> {
  const url = modelsUrl();
  let lastError: unknown;
  let body: string | undefined;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      body = await fetchOnce(url);
      break;
    } catch (err) {
      lastError = err;
      // Exponential backoff, so a provider having a bad second is not treated
      // the same as one that is down.
      if (attempt < FETCH_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
  }
  if (body === undefined) throw lastError;
  return parseCatalogue(body);
}

/** models.dev's api.json -> the shape the rest of freecode reads. */
function parseCatalogue(body: string): Provider[] {
  const raw = JSON.parse(body);
  const providers: Provider[] = [];

  for (const [rawProviderId, providerData] of Object.entries(raw)) {
    const p = providerData as any;
    if (!p || !p.models) continue;
    // models.dev calls Google's provider "google"; freecode's ids
    // are its own (pricing keys, config.json, rollout history), so
    // the rename happens here at the boundary. The table lives in
    // providers/catalogue.ts — a second copy of it here is how one
    // rename becomes two vocabularies again, which is the bug this
    // whole subsystem exists to have ended.
    const providerId = canonicalProviderId(rawProviderId);

    const models: ProviderModel[] = [];
    for (const [modelId, modelData] of Object.entries(
      p.models as Record<string, any>,
    )) {
      if (!modelData) continue;
      models.push({
        id: modelId,
        name: modelData.name || modelId,
        description: modelData.description || modelData.name || modelId,
        limit:
          modelData.limit && typeof modelData.limit.context === "number"
            ? {
                context: modelData.limit.context,
                output: modelData.limit.output ?? 0,
              }
            : undefined,
        cost:
          modelData.cost &&
          typeof modelData.cost.input === "number" &&
          typeof modelData.cost.output === "number"
            ? {
                input: modelData.cost.input,
                output: modelData.cost.output,
                cacheRead:
                  typeof modelData.cost.cache_read === "number"
                    ? modelData.cost.cache_read
                    : undefined,
                cacheWrite:
                  typeof modelData.cost.cache_write === "number"
                    ? modelData.cost.cache_write
                    : undefined,
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

  return providers;
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
