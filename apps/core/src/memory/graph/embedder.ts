// =============================================================================
// Embedder - Lazy ONNX embedding singleton (fastembed / onnxruntime-node)
// Model loads on first embed(), not at startup, so cold CLI launches stay fast.
// Degrades gracefully: if fastembed/onnxruntime is unavailable, available()
// flips to false and callers fall back to the keyword path (spec D6).
// =============================================================================

import * as os from "os";
import * as path from "path";

// `bun build --compile` embeds onnxruntime_binding.node but not the shared
// library it dlopen()s at runtime (libonnxruntime.so.1 / .dylib) — the
// addon's RPATH doesn't survive bundling. build-bun.mjs ships that library as
// a loose file next to the compiled binary, and entry.ts re-execs the process
// with LD_LIBRARY_PATH/DYLD_LIBRARY_PATH pointed at it *before* any code here
// runs — the dynamic linker only reads that variable at process start, so
// setting it from within an already-running process (here) is too late.

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

// Embed a single string. On any failure the backend is marked permanently
// unavailable (e.g. a missing native lib in a compiled binary — the failure is
// process-fatal, not transient) so callers stop retrying and fall back to the
// keyword path (spec D6) instead of throwing on every turn.
export async function embed(text: string): Promise<Float32Array> {
  try {
    const model = await getModel();
    for await (const batch of model.embed([text], 1)) {
      if (batch[0]) return batch[0];
    }
    throw new Error("embedder returned no vector");
  } catch (err) {
    broken = true;
    throw err;
  }
}
