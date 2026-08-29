// =============================================================================
// Gemini web session — transport
//
// One POST per turn against the batchexecute endpoint, plus a cached scrape of
// the front end's build label. No SDK, no proxy process, no extra dependency:
// fetch and a sha1 are the whole surface.
// =============================================================================

import { logger } from "../../utils/logger.js";
import { createTimeoutFetch } from "../fetch-timeout.js";
import { loadGeminiWebSettings } from "./settings.js";
import { buildHeaders, buildPayload, requestUrl, USER_AGENT, ORIGIN } from "./protocol.js";
import { DeltaFold, extractResponseText, findUpstreamError } from "./parse.js";
import { resolveGeminiWebModel } from "./models.js";

// A pinned fallback for when the scrape fails (offline, or the page changed).
// It WILL rot — the label moves every few weeks — which is exactly why it is a
// fallback and not the source of truth. Observed live: 20260827.05_p0.
const FALLBACK_BUILD_LABEL = "boq_assistant-bard-web-server_20260827.05_p0";
const BUILD_LABEL_TTL_MS = 60 * 60 * 1000;
const BUILD_LABEL_PATTERN = /(boq_assistant-bard-web-server_\d+\.\d+_p\d+)/;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

// Same timeouts every other provider gets: a stalled body is the failure mode
// that otherwise hangs a turn forever with no output and no error.
const timeoutFetch = createTimeoutFetch();

let cached: { label: string; at: number } | undefined;

/** The build label the live front end is serving, cached for an hour. */
export async function getBuildLabel(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cached && Date.now() - cached.at < BUILD_LABEL_TTL_MS) {
    return cached.label;
  }
  try {
    const html = await timeoutFetch(`${ORIGIN}/app`, {
      headers: { "User-Agent": USER_AGENT },
    }).then((r) => r.text());
    const label = html.match(BUILD_LABEL_PATTERN)?.[1];
    if (label) {
      if (cached && cached.label !== label) {
        logger.debug(`[gemini-web] build label moved: ${cached.label} -> ${label}`);
      }
      cached = { label, at: Date.now() };
      return label;
    }
  } catch (error) {
    logger.debug("[gemini-web] build label scrape failed", { error });
  }
  // Keep a previously-good label over the pinned one: a transient scrape
  // failure should not downgrade a session that was working a minute ago.
  return cached?.label ?? FALLBACK_BUILD_LABEL;
}

export interface GenerateOptions {
  prompt: string;
  model?: string;
  signal?: AbortSignal;
}

async function post(
  options: GenerateOptions,
  forceLabelRefresh: boolean,
): Promise<Response> {
  const settings = loadGeminiWebSettings();
  const resolved = resolveGeminiWebModel(options.model);
  const label = await getBuildLabel(forceLabelRefresh);
  return timeoutFetch(requestUrl(label, settings), {
    method: "POST",
    headers: buildHeaders(settings),
    body: buildPayload(
      { prompt: options.prompt, mode: resolved.mode, think: resolved.think },
      settings,
    ),
    signal: options.signal,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `attempt` up to MAX_ATTEMPTS times. A 4xx refreshes the build label
 * before retrying: a stale label is the single most common cause of a sudden
 * 400/405 on a session that worked yesterday, and it is fixed by re-scraping,
 * not by waiting.
 */
async function withRetry<T>(
  signal: AbortSignal | undefined,
  attempt: (forceLabelRefresh: boolean) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  let refreshLabel = false;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      return await attempt(refreshLabel);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      refreshLabel = error instanceof HttpStatusError && error.status < 500;
      if (i < MAX_ATTEMPTS - 1) {
        logger.debug(`[gemini-web] retry ${i + 1}/${MAX_ATTEMPTS}`, { error });
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Gemini web returned HTTP ${status}`);
  }
}

/** One non-streaming turn. */
export async function generate(options: GenerateOptions): Promise<string> {
  return withRetry(options.signal, async (refresh) => {
    const response = await post(options, refresh);
    if (!response.ok) throw new HttpStatusError(response.status);
    return extractResponseText(await response.text());
  });
}

/** One streaming turn, yielding incremental text. */
export async function* generateStream(
  options: GenerateOptions,
): AsyncGenerator<string> {
  // Retry wraps only the connect + first byte. Once text has reached the
  // caller a retry would replay it, and the fold rejects a reply that is not
  // an extension of what was already shown.
  const response = await withRetry(options.signal, async (refresh) => {
    const res = await post(options, refresh);
    if (!res.ok) throw new HttpStatusError(res.status);
    return res;
  });

  const fold = new DeltaFold();
  const decoder = new TextDecoder();
  let buffer = "";

  const body = response.body;
  if (!body) {
    yield extractResponseText(await response.text());
    return;
  }

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const upstream = findUpstreamError(buffer);
    if (upstream) throw new Error(upstream);

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const delta = fold.push(line);
      if (delta) yield delta;
    }
  }
  const tail = fold.push(buffer);
  if (tail) yield tail;
}
