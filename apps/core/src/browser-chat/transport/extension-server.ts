// =============================================================================
// Browser Chat — local bridge server for the extension transport
//
// HTTP long-polling rather than WebSocket: it needs no dependency (node:http is
// built in) and no hand-rolled RFC6455 framing, which is a notorious source of
// subtle bugs. The traffic here is one command per turn and a stream of small
// chunk posts, so polling latency is irrelevant.
//
// Binds 127.0.0.1 only. This speaks to a browser extension on the same machine
// and must never be reachable from the network.
// =============================================================================

import * as http from "http";
import { logger } from "../../utils/logger.js";

export interface BridgeMessage {
  kind: "hello" | "seen" | "start" | "chunk" | "end" | "error";
  text?: string;
  url?: string;
  message?: string;
}

export type BridgeCommand =
  | {
      id: string;
      kind: "send";
      text: string;
      composerSelectors: string[];
      submitSelectors: string[];
    }
  | { id: string; kind: "navigate"; url: string };

export interface CommandResult {
  id: string;
  ok: boolean;
  error?: string;
}

const POLL_TIMEOUT_MS = 25_000;

export class ExtensionServer {
  private server: http.Server | null = null;
  private pendingPolls: Array<(cmd: BridgeCommand | null) => void> = [];
  private queuedCommands: BridgeCommand[] = [];
  private resultWaiters = new Map<string, (r: CommandResult) => void>();
  private onMessage: (msg: BridgeMessage) => void = () => {};
  private clientSeen = false;
  private clientWaiters: Array<() => void> = [];
  private lastHelloAt = 0;
  private helloWaiters: Array<{ after: number; resolve: () => void }> = [];

  constructor(private readonly port: number) {}

  handle(listener: (msg: BridgeMessage) => void): void {
    this.onMessage = listener;
  }

  get hasClient(): boolean {
    return this.clientSeen;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => {
      void this.route(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EADDRINUSE") return reject(error);
        // Core is a daemon that outlives the TUI, so a crashed run leaves this
        // port bound. The raw errno tells the user nothing about that.
        reject(
          new Error(
            `browser-chat: port ${this.port} is already in use. A previous ` +
              `FreeCode core process is probably still running — its daemon ` +
              `outlives the TUI. Stop it with:\n` +
              `  pkill -f "freecode.*core/dist/server.js"\n` +
              `or set browser.bridgePort in ~/.freecode/config.json.`,
          ),
        );
      });
      server.listen(this.port, "127.0.0.1", () => resolve());
    });
    this.server = server;
    logger.info("browser-chat: extension bridge listening", {
      port: this.port,
    });
  }

  async stop(): Promise<void> {
    for (const poll of this.pendingPolls) poll(null);
    this.pendingPolls = [];
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  /** Resolves once a browser tab with the extension has checked in. */
  waitForClient(timeoutMs: number): Promise<boolean> {
    if (this.clientSeen) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.clientWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Queues a command for the extension and waits for its acknowledgement. */
  async sendCommand(
    command: BridgeCommand,
    timeoutMs = 30_000,
  ): Promise<CommandResult> {
    const result = new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(
        () =>
          resolve({
            id: command.id,
            ok: false,
            error: "the extension did not acknowledge the command",
          }),
        timeoutMs,
      );
      this.resultWaiters.set(command.id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });

    const waiting = this.pendingPolls.shift();
    if (waiting) waiting(command);
    else this.queuedCommands.push(command);
    return result;
  }

  /**
   * Resolves when a tab checks in AFTER `after`. Navigation tears down the
   * content script, so this is how we know the new page's relay is live again
   * rather than guessing with a sleep.
   */
  waitForHello(after: number, timeoutMs: number): Promise<boolean> {
    if (this.lastHelloAt > after) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.helloWaiters.push({
        after,
        resolve: () => {
          clearTimeout(timer);
          resolve(true);
        },
      });
    });
  }

  noteHello(): void {
    this.lastHelloAt = Date.now();
    const ready = this.helloWaiters.filter((w) => this.lastHelloAt > w.after);
    this.helloWaiters = this.helloWaiters.filter(
      (w) => !(this.lastHelloAt > w.after),
    );
    for (const waiter of ready) waiter.resolve();
  }

  private markClient(): void {
    if (this.clientSeen) return;
    this.clientSeen = true;
    for (const waiter of this.clientWaiters) waiter();
    this.clientWaiters = [];
  }

  private async route(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // The extension's service worker calls this from a page origin, so CORS
    // applies even though everything is local.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = req.url ?? "/";
    this.markClient();

    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url === "/commands" && req.method === "GET") {
      const queued = this.queuedCommands.shift();
      if (queued) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(queued));
        return;
      }
      // Long-poll: hold the request open so a command dispatches immediately
      // instead of waiting for the next poll interval.
      const timer = setTimeout(() => {
        this.pendingPolls = this.pendingPolls.filter((p) => p !== resolver);
        res.writeHead(204).end();
      }, POLL_TIMEOUT_MS);
      const resolver = (cmd: BridgeCommand | null): void => {
        clearTimeout(timer);
        if (!cmd) return void res.writeHead(204).end();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(cmd));
      };
      this.pendingPolls.push(resolver);
      req.on("close", () => {
        clearTimeout(timer);
        this.pendingPolls = this.pendingPolls.filter((p) => p !== resolver);
      });
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      if (url === "/events") {
        const parsed = safeParse(body) as { messages?: BridgeMessage[] } | null;
        for (const message of parsed?.messages ?? []) {
          if (message.kind === "hello") this.noteHello();
          this.onMessage(message);
        }
        res.writeHead(204).end();
        return;
      }
      if (url === "/results") {
        const result = safeParse(body) as CommandResult | null;
        if (result?.id) {
          this.resultWaiters.get(result.id)?.(result);
          this.resultWaiters.delete(result.id);
        }
        res.writeHead(204).end();
        return;
      }
    }

    res.writeHead(404).end();
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 8_000_000) req.destroy(); // refuse absurd payloads
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
