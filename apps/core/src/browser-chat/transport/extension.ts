// =============================================================================
// Browser Chat — extension transport
//
// Drives a tab in the user's OWN browser through the FreeCode extension. There
// is no automation attached to that browser, which is why it works where CDP is
// blocked (spec, 2026-08-20 finding).
//
// Differences from the CDP transport, by design:
//  - it does not open or navigate tabs; it uses the conversation the user
//    already has on screen. Thread management lands with the site's new-chat
//    control, not before the send path is proven.
//  - site knowledge still lives in core: selectors travel WITH the command, so
//    the extension stays a dumb executor.
// =============================================================================

import { randomUUID } from "crypto";
import type { SiteAdapter } from "../sites/types.js";
import { createSseSplitter, parseSseFrame } from "../sites/sse.js";
import { ChunkQueue } from "./queue.js";
import { ExtensionServer, type BridgeMessage } from "./extension-server.js";
import type { BrowserTransport, RawChunk, ThreadHandle } from "./types.js";

export class ExtensionTransport implements BrowserTransport {
  private server: ExtensionServer;
  private queue = new ChunkQueue<RawChunk>();
  private feed = createSseSplitter();
  private site: SiteAdapter | null = null;
  private saw = false;
  private urls: string[] = [];
  private connected = false;
  private seq = 0;

  onRawFrame?: (frame: string) => void;

  constructor(private readonly port = 8765) {
    this.server = new ExtensionServer(this.port);
    this.server.handle((message) => this.onMessage(message));
  }

  async connect(): Promise<void> {
    await this.server.start();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.queue.close();
    await this.server.stop();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Resolves once a tab with the extension has checked in. */
  waitForBrowser(timeoutMs = 60_000): Promise<boolean> {
    return this.server.waitForClient(timeoutMs);
  }

  async openThread(
    site: SiteAdapter,
    opts?: { newChat?: boolean },
  ): Promise<ThreadHandle> {
    this.site = site;
    if (opts?.newChat) {
      // Navigation tears the content script down and back up, so we wait for
      // the new page to check in rather than sleeping and hoping.
      const before = Date.now();
      const result = await this.server.sendCommand({
        id: randomUUID(),
        kind: "navigate",
        url: site.newChatUrl(),
      });
      if (!result.ok) {
        throw new Error(
          `browser-chat: could not open a new chat — ${result.error ?? "unknown"}`,
        );
      }
      if (!(await this.server.waitForHello(before, 30_000))) {
        throw new Error(
          "browser-chat: the tab did not come back after opening a new chat.",
        );
      }
      this.saw = false;
      this.urls = [];
      this.feed = createSseSplitter();
    }
    return { id: `extension-${++this.seq}`, site };
  }

  async closeThread(): Promise<void> {
    // The tab belongs to the user; closing it is not ours to do.
  }

  async send(handle: ThreadHandle, text: string): Promise<void> {
    const result = await this.server.sendCommand({
      id: randomUUID(),
      kind: "send",
      text,
      composerSelectors: handle.site.composerSelectors,
      submitSelectors: handle.site.submitSelectors,
    });
    if (!result.ok) {
      throw new Error(
        `browser-chat: the extension could not send the message — ` +
          `${result.error ?? "unknown error"}`,
      );
    }
  }

  async *receive(
    _handle: ThreadHandle,
    signal?: AbortSignal,
  ): AsyncIterable<RawChunk> {
    for await (const chunk of this.queue.drain(signal)) {
      yield chunk;
      if (chunk.type === "end") return;
    }
  }

  sawCompletionRequest(): boolean {
    return this.saw;
  }

  seenUrls(): string[] {
    return this.urls;
  }

  private onMessage(message: BridgeMessage): void {
    switch (message.kind) {
      case "seen": {
        const url = message.url ?? "";
        if (url && this.urls.length < 60 && !this.urls.includes(url)) {
          this.urls.push(url);
        }
        break;
      }
      case "start":
        this.saw = true;
        // Drop leftovers from the previous response, notably a stale `end`.
        this.feed = createSseSplitter();
        this.queue.clear();
        break;
      case "chunk": {
        if (!message.text || !this.site) break;
        for (const raw of this.feed(message.text)) {
          this.onRawFrame?.(raw);
          const chunk = this.site.decodeFrame(parseSseFrame(raw));
          if (chunk) this.queue.push(chunk);
        }
        break;
      }
      case "end":
        this.queue.push({ type: "end" });
        break;
      case "error":
        this.queue.push({
          type: "error",
          message: message.message ?? "bridge error",
        });
        break;
      case "hello":
        break;
    }
  }
}
