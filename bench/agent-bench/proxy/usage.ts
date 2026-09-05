// Parse token usage off the wire. Anthropic Messages and OpenAI Chat
// Completions only — those are the two shapes MiniMax's /anthropic shim and
// a native openai-compatible agent both emit. Spec §6.4: one meter, not four
// self-reports.

export interface Usage {
  /**
   * INCLUSIVE of cache reads and writes, whatever the wire said. OpenAI's
   * `prompt_tokens` already is; Anthropic's `input_tokens` is exclusive
   * (cache_read/cache_creation are separate additive fields), so the
   * Anthropic parser adds them in. price.ts subtracts the cache fields back
   * out — normalizing here is what makes that subtraction correct for both
   * shapes.
   */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function take(usage: Record<string, unknown>, wire: string, field: keyof Usage): Partial<Usage> {
  return wire in usage ? { [field]: num(usage[wire]) } : {};
}

/** Only fields the payload actually carried — a delta must not zero the rest. */
function fromAnthropicPartial(usage: Record<string, unknown>): Partial<Usage> {
  const partial: Partial<Usage> = {
    ...take(usage, "input_tokens", "inputTokens"),
    ...take(usage, "output_tokens", "outputTokens"),
    ...take(usage, "cache_read_input_tokens", "cacheReadTokens"),
    ...take(usage, "cache_creation_input_tokens", "cacheWriteTokens"),
  };
  // Anthropic's input_tokens EXCLUDES cache tokens; Usage.inputTokens is
  // inclusive. The cache fields ride the same payload (message_start), so
  // normalizing per-payload survives the SSE overlay in usageFromSse.
  if (partial.inputTokens !== undefined) {
    partial.inputTokens +=
      (partial.cacheReadTokens ?? 0) + (partial.cacheWriteTokens ?? 0);
  }
  return partial;
}

function complete(partial: Partial<Usage>): Usage {
  return {
    inputTokens: partial.inputTokens ?? 0,
    outputTokens: partial.outputTokens ?? 0,
    cacheReadTokens: partial.cacheReadTokens ?? 0,
    cacheWriteTokens: partial.cacheWriteTokens ?? 0,
  };
}

function fromOpenAi(usage: Record<string, unknown>): Usage | undefined {
  if (usage.prompt_tokens === undefined && usage.completion_tokens === undefined) {
    return undefined;
  }
  const details = usage.prompt_tokens_details;
  const cached =
    details && typeof details === "object"
      ? num((details as Record<string, unknown>).cached_tokens)
      : 0;
  return {
    inputTokens: num(usage.prompt_tokens),
    outputTokens: num(usage.completion_tokens),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

function usageFields(body: unknown): Partial<Usage> | undefined {
  if (!body || typeof body !== "object") return undefined;
  const rec = body as Record<string, unknown>;
  const usage = rec.usage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    if ("input_tokens" in u || "output_tokens" in u) return fromAnthropicPartial(u);
    const openai = fromOpenAi(u);
    if (openai) return openai;
  }
  const nested = rec.message;
  if (nested && typeof nested === "object") return usageFields(nested);
  return undefined;
}

/** Usage object nested on a JSON response (or an SSE `data:` payload). */
export function parseUsage(body: unknown): Usage | undefined {
  const fields = usageFields(body);
  if (!fields || Object.keys(fields).length === 0) return undefined;
  return complete(fields);
}

/** Walk an SSE buffer; later events overlay only the fields they carry. */
export function usageFromSse(text: string): Usage | undefined {
  let acc: Partial<Usage> | undefined;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("");
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = usageFields(JSON.parse(data));
      if (parsed && Object.keys(parsed).length > 0) acc = { ...acc, ...parsed };
    } catch {
      // A truncated frame is not a usage event.
    }
  }
  return acc ? complete(acc) : undefined;
}
