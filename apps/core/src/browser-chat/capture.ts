// =============================================================================
// Browser Chat — `freecode browser capture`
//
// Records the raw body of the next response into sites/fixtures/, so a live
// capture becomes a regression test instead of a one-off observation. You send
// the message yourself: capture must exercise the site's ordinary path, not a
// synthetic one.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getSiteAdapter } from "./sites/index.js";
import { readBrowserChatConfig } from "./config.js";
import { ExtensionTransport } from "./transport/extension.js";
import type { SiteId } from "./types.js";

export interface CaptureOptions {
  site: SiteId;
  name: string;
  timeoutMs?: number;
}

export async function runCapture(opts: CaptureOptions): Promise<number> {
  const config = readBrowserChatConfig();
  const transport = new ExtensionTransport(config.bridgePort);
  await transport.connect();

  console.error("Waiting for a browser tab with the FreeCode extension…");
  if (!(await transport.waitForBrowser(60_000))) {
    console.error("[error] no tab checked in. Load the extension and reload the tab.");
    await transport.disconnect();
    return 1;
  }

  const frames: string[] = [];
  transport.onRawFrame = (frame) => frames.push(frame);

  const handle = await transport.openThread(getSiteAdapter(opts.site));
  console.error(
    "\nConnected. Now send a message in the browser tab yourself.\n" +
      "Recording the reply…\n",
  );

  const abort = new AbortController();
  const timeout = setTimeout(() => {
    console.error("\n[error] timed out waiting for a response.");
    abort.abort();
  }, opts.timeoutMs ?? 120_000);

  try {
    // Keep listening until a stream ENDS THAT ACTUALLY PRODUCED FRAMES. An
    // `end` with nothing behind it means we mirrored something that was not a
    // reply; stopping there would abandon the capture before the user typed.
    while (!abort.signal.aborted) {
      for await (const chunk of transport.receive(handle, abort.signal)) {
        if (chunk.type === "delta") process.stderr.write(".");
        if (chunk.type === "end") break;
      }
      if (frames.length > 0) break;
    }
  } finally {
    clearTimeout(timeout);
  }

  if (frames.length === 0) {
    console.error(
      "\n[error] no frames captured. Either nothing was sent, or the URL " +
        "patterns in sites/ missed the endpoint.",
    );
    await transport.disconnect();
    return 1;
  }

  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "sites",
    "fixtures",
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${opts.site}-${opts.name}.txt`);
  // Frames are re-joined with the SSE separator so the file is a faithful
  // response body, which is what the splitter is fed in the test.
  fs.writeFileSync(file, frames.join("\n\n") + "\n\n", "utf-8");

  console.error(`\n\nwrote ${frames.length} frames to ${file}`);
  console.error(
    "Review it for anything identifying before committing — this is a real " +
      "response from your account.",
  );
  await transport.disconnect();
  return 0;
}
