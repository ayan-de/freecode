import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getModelDisplayString(
  provider?: string | null,
  model?: string | null,
): string {
  return provider && model ? `${provider}/${model}` : "not selected";
}

export function getDisplayDirectory(): string {
  return process.cwd().replace(process.env.HOME || "", "~");
}

export function getVersion(): string {
  // Baked in at bundle time by the SEA build (build.config.mjs define) —
  // inside a single-file binary there is no package.json on disk to read.
  if (process.env.FREECODE_BUILD_VERSION) {
    return process.env.FREECODE_BUILD_VERSION;
  }
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"),
    );
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}
