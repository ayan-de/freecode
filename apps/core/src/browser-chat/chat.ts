// =============================================================================
// Browser Chat — `freecode browser chat "<prompt>"`
//
// One prompt, one turn, streamed to stdout. This is the verification path: it
// proves a transport end to end without any of the agent loop.
// =============================================================================

import { collectResponse, openBrowserThread } from "./runtime.js";
import { getSiteAdapter } from "./sites/index.js";
import { ExtensionTransport } from "./transport/extension.js";
import type { SiteId } from "./types.js";

export interface ChatOptions {
  site: SiteId;
  prompt: string;
  keepOpen?: boolean;
  transport?: "cdp" | "extension";
}

function report(result: {
  limit?: { kind: string; detail: string };
  quota?: { window: string; utilization: number; resetsAt?: number };
  error?: string;
  sawCompletionRequest: boolean;
  timedOut: boolean;
}): number {
  if (result.quota) {
    const pct = Math.round(result.quota.utilization * 100);
    const resets = result.quota.resetsAt
      ? `, resets ${new Date(result.quota.resetsAt).toLocaleTimeString()}`
      : "";
    console.error(`[quota] ${pct}% of the ${result.quota.window} window used${resets}`);
  }
  if (result.limit) {
    console.error(`\n[limit: ${result.limit.kind}] ${result.limit.detail}`);
    return 1;
  }
  if (result.error) {
    console.error(`\n[error] ${result.error}`);
    return 1;
  }
  if (!result.sawCompletionRequest) {
    console.error(
      "\n[error] the message was sent, but no completion request was seen.\n" +
        "        The URL patterns in sites/ do not match this site's endpoint.",
    );
    return 1;
  }
  if (result.timedOut) {
    console.error("\n[error] timed out waiting for the first chunk.");
    return 1;
  }
  return 0;
}

async function runViaExtension(opts: ChatOptions): Promise<number> {
  const transport = new ExtensionTransport();
  await transport.connect();
  console.error("Waiting for a browser tab with the FreeCode extension…");
  console.error("(open or reload https://claude.ai — the tab must stay focused)\n");

  if (!(await transport.waitForBrowser(60_000))) {
    console.error(
      "[error] no tab checked in within 60s. Is the extension loaded, and is\n" +
        "        a claude.ai tab open? Reload the tab after starting this.",
    );
    await transport.disconnect();
    return 1;
  }

  try {
    const handle = await transport.openThread(getSiteAdapter(opts.site));
    await transport.send(handle, opts.prompt);
    const result = await collectResponse(transport, handle, {
      onDelta: (text) => process.stdout.write(text),
    });
    process.stdout.write("\n");
    return report(result);
  } finally {
    await transport.disconnect();
  }
}

export async function runChat(opts: ChatOptions): Promise<number> {
  if (opts.transport === "extension") return runViaExtension(opts);

  const { transport, handle } = await openBrowserThread(opts.site);
  try {
    await transport.send(handle, opts.prompt);
    const result = await collectResponse(transport, handle, {
      onDelta: (text) => process.stdout.write(text),
    });
    process.stdout.write("\n");
    return report(result);
  } finally {
    if (!opts.keepOpen) {
      await transport.closeThread(handle).catch(() => {});
      await transport.disconnect().catch(() => {});
    }
  }
}
