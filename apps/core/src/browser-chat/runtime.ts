// =============================================================================
// Browser Chat — shared runtime helpers for the CLI entry points
//
// Only reached through dynamic imports (cli.ts handlers), so importing the
// transport — and therefore Playwright — at module scope here is fine.
// =============================================================================

import { readBrowserChatConfig } from "./config.js";
import { getSiteAdapter } from "./sites/index.js";
import { CdpTransport } from "./transport/cdp.js";
import type { RawChunk, ThreadHandle } from "./transport/types.js";
import type { SiteId } from "./types.js";

export interface OpenThreadResult {
  transport: CdpTransport;
  handle: ThreadHandle;
}

/** What collectResponse needs — satisfied by both transports. */
export interface StreamingTransport {
  receive(handle: ThreadHandle, signal?: AbortSignal): AsyncIterable<RawChunk>;
  sawCompletionRequest(handle: ThreadHandle): boolean;
}

export async function openBrowserThread(
  siteId: SiteId,
): Promise<OpenThreadResult> {
  const config = readBrowserChatConfig();
  const transport = new CdpTransport(config.cdpUrl, {
    autoLaunch: config.autoLaunch,
    profileDir: config.profileDir,
    binary: config.binary,
    headless: config.headless,
  });
  await transport.connect();
  const handle = await transport.openThread(getSiteAdapter(siteId));
  return { transport, handle };
}

export interface CollectResult {
  text: string;
  /** Set when the site reported a limit rather than answering. */
  limit?: Extract<RawChunk, { type: "limit" }>;
  /** Latest quota telemetry, reported by the site on every reply. */
  quota?: Extract<RawChunk, { type: "quota" }>;
  error?: string;
  /** False ⇒ no completion request was ever observed: the adapter is stale. */
  sawCompletionRequest: boolean;
  timedOut: boolean;
}

/**
 * Reads one response. The first-chunk timeout is the inline shape check from
 * the spec: if nothing arrives, the interesting question is not "is the model
 * slow" but "did we fail to recognise the request at all", which
 * `sawCompletionRequest` answers.
 */
export async function collectResponse(
  transport: StreamingTransport,
  handle: ThreadHandle,
  opts: { onDelta?: (text: string) => void; firstChunkTimeoutMs?: number } = {},
): Promise<CollectResult> {
  const firstChunkTimeoutMs = opts.firstChunkTimeoutMs ?? 45_000;
  const result: CollectResult = {
    text: "",
    sawCompletionRequest: false,
    timedOut: false,
  };

  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined = setTimeout(() => {
    result.timedOut = true;
    abort.abort();
  }, firstChunkTimeoutMs);
  const clearFirstChunkTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  try {
    for await (const chunk of transport.receive(handle, abort.signal)) {
      clearFirstChunkTimer();
      if (chunk.type === "delta") {
        result.text += chunk.text;
        opts.onDelta?.(chunk.text);
      } else if (chunk.type === "limit") {
        result.limit = chunk;
      } else if (chunk.type === "quota") {
        result.quota = chunk;
      } else if (chunk.type === "error") {
        result.error = chunk.message;
      }
    }
  } finally {
    clearFirstChunkTimer();
    result.sawCompletionRequest = transport.sawCompletionRequest(handle);
  }
  return result;
}
