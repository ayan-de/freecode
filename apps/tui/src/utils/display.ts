export function getModelDisplayString(provider?: string | null, model?: string | null): string {
	return provider && model ? `${provider}/${model}` : "not selected";
}

export function getDisplayDirectory(): string {
	return process.cwd().replace(process.env.HOME || "", "~");
}
