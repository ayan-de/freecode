// =============================================================================
// Browser Chat — CDP transport
//
// Attaches to the Chrome the user already has open. We never launch a browser:
// FreeCode's marginal footprint is a WebSocket, and the user's existing login
// is what makes this work at all.
//
// This is the first module in the chain that imports Playwright, and it is only
// ever reached through a dynamic import — keeping the browser stack off the
// cold-start path (spec, delink section).
// =============================================================================

import { chromium, type Browser, type Page } from "playwright";
import { logger } from "../../utils/logger.js";
import type { SiteAdapter } from "../sites/types.js";
import { createSseSplitter, parseSseFrame } from "../sites/sse.js";
import { buildBridgeScript } from "./inject.js";
import { launchBrowser } from "./launch.js";
import { resolveFirst, type SelectorMatch } from "./selectors.js";
import { ChunkQueue } from "./queue.js";
import type { BrowserTransport, RawChunk, ThreadHandle } from "./types.js";

const BINDING = "__freecodeBridge";

interface BridgeMessage {
  kind: "start" | "chunk" | "end" | "error" | "seen";
  text?: string;
  url?: string;
  message?: string;
}

/** Cap: a chat page issues a lot of telemetry we do not care about. */
const MAX_SEEN_URLS = 60;

interface ThreadState {
  handle: ThreadHandle;
  page: Page;
  queue: ChunkQueue<RawChunk>;
  feed: (chunk: string) => string[];
  /** Inline shape check: did we ever see a matching completion request? */
  sawCompletionRequest: boolean;
  /** Every request URL the page made, for diagnosing a moved endpoint. */
  seenUrls: string[];
  composer?: SelectorMatch;
  submit?: SelectorMatch;
}

export interface CdpOptions {
  autoLaunch: boolean;
  profileDir: string;
  binary?: string;
  headless: boolean;
}

export class CdpTransport implements BrowserTransport {
  private browser: Browser | null = null;
  private threads = new Map<string, ThreadState>();
  private seq = 0;

  /**
   * Raw frame tap, before decoding. This is how real captures get turned into
   * the test fixtures the site adapters need (`browser doctor --raw`), and the
   * only way to correct a provisional decoder without guessing.
   */
  onRawFrame?: (frame: string) => void;

  constructor(
    private readonly cdpUrl: string,
    private readonly options?: CdpOptions,
  ) {}

  /** True when connect() had to start a browser rather than reuse one. */
  launchedBrowser = false;

  async connect(): Promise<void> {
    try {
      this.browser = await chromium.connectOverCDP(this.cdpUrl);
      logger.info("browser-chat: connected over CDP", { url: this.cdpUrl });
      return;
    } catch {
      // Nothing listening. Chromium cannot be told to open a debugging port
      // after the fact, so the only way to get one is to start a browser.
      if (!this.options?.autoLaunch) {
        throw new Error(
          `Nothing is listening at ${this.cdpUrl}, and browser.autoLaunch is ` +
            `off. Either enable it, or start your browser with ` +
            `--remote-debugging-port=9222.`,
        );
      }
    }

    await launchBrowser({
      cdpUrl: this.cdpUrl,
      profileDir: this.options.profileDir,
      binary: this.options.binary || undefined,
      headless: this.options.headless,
    });
    this.launchedBrowser = true;
    this.browser = await chromium.connectOverCDP(this.cdpUrl);
    logger.info("browser-chat: launched and connected", { url: this.cdpUrl });
  }

  async disconnect(): Promise<void> {
    for (const state of this.threads.values()) state.queue.close();
    this.threads.clear();
    // Only detaches our CDP session; the user's Chrome keeps running.
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }

  isConnected(): boolean {
    return this.browser !== null;
  }

  async openThread(site: SiteAdapter): Promise<ThreadHandle> {
    if (!this.browser) throw new Error("browser-chat: not connected");

    const context =
      this.browser.contexts()[0] ?? (await this.browser.newContext());
    const page = await context.newPage();
    const handle: ThreadHandle = { id: `thread-${++this.seq}`, site };
    const state: ThreadState = {
      handle,
      page,
      queue: new ChunkQueue<RawChunk>(),
      feed: createSseSplitter(),
      sawCompletionRequest: false,
      seenUrls: [],
    };
    this.threads.set(handle.id, state);

    // Binding first, then the init script that calls it, then navigate —
    // addInitScript only applies to subsequent navigations.
    await page.exposeBinding(BINDING, (_source, message) =>
      this.onBridgeMessage(state, message as BridgeMessage),
    );
    await page.addInitScript(
      buildBridgeScript(site.completionUrlPatterns, BINDING),
    );
    page.on("close", () => state.queue.close());

    await page.goto(site.newChatUrl(), { waitUntil: "domcontentloaded" });
    return handle;
  }

  async closeThread(handle: ThreadHandle): Promise<void> {
    const state = this.threads.get(handle.id);
    if (!state) return;
    state.queue.close();
    this.threads.delete(handle.id);
    await state.page.close().catch(() => {});
  }

  private onBridgeMessage(state: ThreadState, message: BridgeMessage): void {
    switch (message.kind) {
      case "seen": {
        const url = message.url ?? "";
        if (
          url &&
          state.seenUrls.length < MAX_SEEN_URLS &&
          !state.seenUrls.includes(url)
        ) {
          state.seenUrls.push(url);
        }
        break;
      }
      case "start":
        state.sawCompletionRequest = true;
        // A new response begins; drop any partial frame AND any leftover
        // chunk from the previous one (a stale `end` would end this turn
        // before it started).
        state.feed = createSseSplitter();
        state.queue.clear();
        break;
      case "chunk": {
        if (!message.text) break;
        for (const raw of state.feed(message.text)) {
          this.onRawFrame?.(raw);
          const chunk = state.handle.site.decodeFrame(parseSseFrame(raw));
          if (chunk) state.queue.push(chunk);
        }
        break;
      }
      case "end":
        state.queue.push({ type: "end" });
        break;
      case "error":
        state.queue.push({
          type: "error",
          message: message.message ?? "bridge error",
        });
        break;
    }
  }

  async send(handle: ThreadHandle, text: string): Promise<void> {
    const state = this.mustGet(handle);
    const { page, handle: h } = state;

    state.composer ??=
      (await resolveFirst(page, h.site.composerSelectors)) ?? undefined;
    if (!state.composer) {
      throw new Error(
        `browser-chat: composer not found on ${h.site.label} ` +
          `(adapter ${h.site.adapterVersion}) — run \`freecode browser doctor\`.`,
      );
    }

    await state.composer.locator.click();
    // insertText, not type(): a bootstrap message is thousands of characters
    // and keystroke emulation would take minutes. It also avoids ProseMirror
    // interpreting Enter as submit mid-message.
    await page.keyboard.insertText(text);

    state.submit ??=
      (await resolveFirst(page, h.site.submitSelectors, 5_000)) ?? undefined;
    if (!state.submit) {
      throw new Error(
        `browser-chat: send button not found on ${h.site.label} ` +
          `(adapter ${h.site.adapterVersion}) — run \`freecode browser doctor\`.`,
      );
    }
    await state.submit.locator.click();
  }

  async *receive(
    handle: ThreadHandle,
    signal?: AbortSignal,
  ): AsyncIterable<RawChunk> {
    const state = this.mustGet(handle);
    for await (const chunk of state.queue.drain(signal)) {
      yield chunk;
      if (chunk.type === "end") return;
    }
  }

  /** Inline shape check (spec): no completion request seen ⇒ adapter is stale. */
  sawCompletionRequest(handle: ThreadHandle): boolean {
    return this.mustGet(handle).sawCompletionRequest;
  }

  page(handle: ThreadHandle): Page {
    return this.mustGet(handle).page;
  }

  /** Distinct request URLs the page issued — used to locate a moved endpoint. */
  seenUrls(handle: ThreadHandle): string[] {
    return this.mustGet(handle).seenUrls;
  }

  matchedSelectors(handle: ThreadHandle): {
    composer?: SelectorMatch;
    submit?: SelectorMatch;
  } {
    const state = this.mustGet(handle);
    return { composer: state.composer, submit: state.submit };
  }

  private mustGet(handle: ThreadHandle): ThreadState {
    const state = this.threads.get(handle.id);
    if (!state) throw new Error(`browser-chat: unknown thread ${handle.id}`);
    return state;
  }
}
