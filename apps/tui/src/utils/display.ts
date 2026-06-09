import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getModelDisplayString(provider?: string | null, model?: string | null): string {
	return provider && model ? `${provider}/${model}` : "not selected";
}

export function getDisplayDirectory(): string {
	return process.cwd().replace(process.env.HOME || "", "~");
}

export function getVersion(): string {
	try {
		const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
		return pkg.version || "unknown";
	} catch {
		return "unknown";
	}
}
