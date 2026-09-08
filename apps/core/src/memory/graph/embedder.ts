// =============================================================================
// Embedder - Lazy ONNX embedding singleton (fastembed / onnxruntime-node)
// Model loads on first embed(), not at startup, so cold CLI launches stay fast.
// Degrades gracefully: if fastembed/onnxruntime is unavailable, available()
// flips to false and callers fall back to the keyword path (spec D6).
//
// That fallback is PERMANENT for the process, so what latches it matters. Two
// failure classes reach this module and only one of them is forever:
//   - the native addon is missing or won't dlopen (see the note below). It
//     never becomes available inside a running process → latch on sight.
//   - anything past the import — above all the first-run model download into
//     MODELS_DIR — is ordinary I/O and can fail transiently. Latching on the
//     first of those turned one flaky moment into a silently keyword-only
//     session until the daemon restarted, so these are retried instead.
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

/**
 * Consecutive retryable failures tolerated before the backend is declared
 * dead. Bounded so a backend that is genuinely broken past the import — a
 * native session that constructs and then throws on every embed — still stops
 * being retried on every turn, just not after a single stumble.
 */
const MAX_RETRYABLE_FAILURES = 3;

interface EmbeddingModel {
  embed: (texts: string[], batch?: number) => AsyncIterable<Float32Array[]>;
}

interface FastembedModule {
  FlagEmbedding: {
    init: (opts: {
      model: unknown;
      cacheDir: string;
    }) => Promise<EmbeddingModel>;
  };
  EmbeddingModel: Record<string, unknown>;
}

let load: () => Promise<FastembedModule> = () =>
  import("fastembed") as unknown as Promise<FastembedModule>;

let initPromise: Promise<EmbeddingModel> | null = null;
let broken = false;
let failures = 0;

async function getModel(): Promise<EmbeddingModel> {
  if (!initPromise) {
    initPromise = (async () => {
      let mod: FastembedModule;
      try {
        // Dynamic import: fastembed pulls a native addon that may be missing on
        // minimal installs or arch mismatches. It is required at module load,
        // so a dlopen failure surfaces HERE and nowhere later.
        mod = await load();
      } catch (err) {
        broken = true; // never recoverable in-process → keyword fallback
        throw err;
      }
      return mod.FlagEmbedding.init({
        model: mod.EmbeddingModel.AllMiniLML6V2,
        cacheDir: MODELS_DIR,
      });
    })().catch((err) => {
      // Drop the memoized rejection so a retryable failure (the download) gets
      // a fresh attempt. Nothing to reset once `broken` latched.
      if (!broken) initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

// True until an init/embed attempt proves the backend is unavailable.
export function available(): boolean {
  return !broken;
}

/**
 * Embed a single string. A missing native backend marks the embedder
 * unavailable at once; a retryable failure only does so after
 * MAX_RETRYABLE_FAILURES in a row, and one success clears the count. Callers
 * fall back to the keyword path (spec D6) once available() is false.
 */
export async function embed(text: string): Promise<Float32Array> {
  try {
    const model = await getModel();
    for await (const batch of model.embed([text], 1)) {
      if (batch[0]) {
        failures = 0;
        return batch[0];
      }
    }
    throw new Error("embedder returned no vector");
  } catch (err) {
    // `broken` is already set for the unrecoverable class; counting there
    // would only overwrite a verdict that is final.
    if (!broken && ++failures >= MAX_RETRYABLE_FAILURES) broken = true;
    throw err;
  }
}

/** Test seam: clear the latch/memoized model, optionally with a stub loader. */
export function resetEmbedderForTests(
  loader?: () => Promise<FastembedModule>,
): void {
  load =
    loader ??
    (() => import("fastembed") as unknown as Promise<FastembedModule>);
  initPromise = null;
  broken = false;
  failures = 0;
}
