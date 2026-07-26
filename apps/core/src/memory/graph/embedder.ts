// =============================================================================
// Embedder - Lazy ONNX embedding singleton (fastembed / onnxruntime-node)
// Model loads on first embed(), not at startup, so cold CLI launches stay fast.
// Degrades gracefully: if fastembed/onnxruntime is unavailable, available()
// flips to false and callers fall back to the keyword path (spec D6).
// =============================================================================

import * as os from "os";
import * as path from "path";

// Pinned by the Phase 0 spike: fastembed's AllMiniLML6V2 → 384-dim Float32Array.
// dims are NOT hard-coded downstream — vector-store reads them from the vectors.
export const MODEL_ID = "fast-all-MiniLM-L6-v2";

const MODELS_DIR = path.join(os.homedir(), ".freecode", "models");

let initPromise: Promise<unknown> | null = null;
let broken = false;

async function getModel(): Promise<{
  embed: (texts: string[], batch?: number) => AsyncIterable<Float32Array[]>;
}> {
  if (!initPromise) {
    initPromise = (async () => {
      // Dynamic import: fastembed pulls a native addon that may be missing on
      // minimal installs or arch mismatches. Failure here → keyword fallback.
      const mod = await import("fastembed");
      return mod.FlagEmbedding.init({
        model: mod.EmbeddingModel.AllMiniLML6V2,
        cacheDir: MODELS_DIR,
      });
    })().catch((err) => {
      broken = true;
      throw err;
    });
  }
  return initPromise as Promise<{
    embed: (texts: string[], batch?: number) => AsyncIterable<Float32Array[]>;
  }>;
}

// True until an init/embed attempt proves the backend is unavailable.
export function available(): boolean {
  return !broken;
}

// Embed a single string. Throws if the backend is unavailable (caller catches).
export async function embed(text: string): Promise<Float32Array> {
  const model = await getModel();
  for await (const batch of model.embed([text], 1)) {
    if (batch[0]) return batch[0];
  }
  throw new Error("embedder returned no vector");
}
