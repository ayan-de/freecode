// =============================================================================
// Memory Graph Explorer — HTTP server (spec: docs/superpowers/specs/2026-08-04-
// memory-graph-explorer-design.md).
//
// Two responsibilities:
//   1. Serve the addon pages from ~/.freecode/addons/graph-ui/ if present.
//      (The addon is an optional opt-in download, NOT bundled into the binary;
//      see apps/core/src/cli/commands/memory/ui.ts.)
//   2. Expose the JSON API (graph-explorer/api.ts) over plain Node http.
//
// Singleton: one server per (host, port) — a second /graph invocation in the
// same session reuses the running listener instead of EADDRINUSE-ing.
//
// Port fallback: tries the requested port, then walks upward until one binds
// (matches the spec's "4097, 4098, 4099, …"). The URL we return matches the
// port we actually bound to so the browser opens the right page.
// =============================================================================

import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MemoryGraphService } from "../memory/graph/index.js";
import { dispatchApi, writeApiResult, type ApiResult } from "./api.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4097;
const MAX_PORT_TRIES = 16; // 4097 .. 4112

// Pure helper — exported so tests can stub the addon path without touching fs.
// Returns the absolute path the addon is expected at, per the spec.
export function addonDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".freecode", "addons", "graph-ui");
}

export function addonInstalled(homeDir?: string): boolean {
  try {
    const dir = addonDir(homeDir);
    // The addon ships with index.html — its presence is the contract.
    return fs.existsSync(path.join(dir, "index.html"));
  } catch {
    return false;
  }
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Resolve a /path under the addon dir, with traversal protection. Returns
// null if the resolved path escapes the dir or doesn't exist.
function safeJoin(rootDir: string, requestPath: string): string | null {
  // Strip query string if any (Node has already parsed it, so we receive the
  // path-only form via IncomingMessage.url).
  const cleaned = path
    .normalize(decodeURIComponent(requestPath))
    .replace(/^(\.\.[\/\\])+/, "");
  const resolved = path.join(rootDir, cleaned);
  // Defence-in-depth: refuse anything that resolved outside the addon dir.
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    return null;
  }
  return resolved;
}

interface RunningServer {
  host: string;
  port: number;
  server: http.Server;
}

let running: RunningServer | null = null;

// Try to bind to `port`, walking upward up to MAX_PORT_TRIES. Resolves with
// the listener that won the race; rejects only when every port failed.
function bindWithFallback(
  host: string,
  port: number,
  onListening: (server: http.Server) => void,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let lastErr: unknown = null;

    const tryOne = (): void => {
      if (attempt >= MAX_PORT_TRIES) {
        reject(
          lastErr instanceof Error
            ? lastErr
            : new Error(`could not bind any port near ${port}`),
        );
        return;
      }
      const tryPort = port + attempt;
      const server = http.createServer();
      let settled = false;
      server.once("error", (err) => {
        if (settled) return;
        settled = true;
        // EADDRINUSE → bump and retry; anything else bubbles up immediately.
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
          lastErr = err;
          attempt += 1;
          tryOne();
          return;
        }
        reject(err);
      });
      server.once("listening", () => {
        if (settled) return;
        settled = true;
        resolve({ server, port: tryPort });
        onListening(server);
      });
      server.listen(tryPort, host);
    };
    tryOne();
  });
}

export interface ExploreResult {
  url: string;
}

export interface ExploreError {
  error: "not-installed";
}

// Start (or reuse) the explorer and open the browser. The TUI / CLI call this
// from the `graph.explore` IPC method.
//
// `service` is the project's MemoryGraphService — typically `getMemoryGraphService(process.cwd())`.
// `openBrowser` is injected so tests can stub it and so the same util the
// `web` command uses is the one called here.
export async function startGraphExplorer(
  service: MemoryGraphService,
  options: {
    homeDir?: string;
    host?: string;
    port?: number;
    openBrowser?: (url: string) => void;
    now?: () => Date;
  } = {},
): Promise<ExploreResult | ExploreError> {
  const homeDir = options.homeDir ?? os.homedir();
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;

  // Reuse the singleton if it's already running on the same host+port. The
  // (host, port) tuple is unique enough — the only two callers are /graph and
  // (eventually) tests, and tests get their own service.
  if (running && running.host === host && running.port === port) {
    const url = `http://${host}:${running.port}/`;
    options.openBrowser?.(url);
    return { url };
  }

  if (!addonInstalled(homeDir)) {
    return { error: "not-installed" };
  }

  const addonRoot = addonDir(homeDir);

  // Hand the listening server a closure over the service so the API handlers
  // always see the same graph state (it's a per-process singleton in
  // graph/index.ts anyway).
  const { server: httpServer, port: boundPort } = await bindWithFallback(
    host,
    port,
    () => {},
  );

  const deps = { service };

  httpServer.on("request", async (req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://${host}:${boundPort}`);
    const pathname = parsedUrl.pathname;

    // Local helper: serve a static file from the addon dir, with traversal
    // protection. Returns true if it handled the response.
    const serveStatic = (): boolean => {
      const target = safeJoin(addonRoot, pathname);
      if (!target) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return true;
      }
      // Default to index.html for the root.
      let filePath = target;
      if (
        pathname === "/" ||
        pathname.endsWith("/") ||
        !fs.existsSync(target)
      ) {
        filePath = path.join(addonRoot, "index.html");
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return true;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filePath).pipe(res);
      return true;
    };

    try {
      const apiResult: ApiResult | null = await dispatchApi(
        req,
        parsedUrl,
        res,
        deps,
      );
      if (apiResult) {
        writeApiResult(res, apiResult);
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        serveStatic();
        return;
      }
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
    } catch (err) {
      // Hand-dispatch errors a 500 rather than letting an unhandled rejection
      // take down the listener.
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  running = { host, port: boundPort, server: httpServer };

  // Log the actual port we landed on (useful when the requested one was busy).
  process.stderr.write(
    `[freecode] graph explorer listening at http://${host}:${boundPort}/\n`,
  );

  const url = `http://${host}:${boundPort}/`;
  options.openBrowser?.(url);
  return { url };
}

// Tear down the running server (tests / process shutdown). Safe to call when
// nothing is running.
export async function stopGraphExplorer(): Promise<void> {
  if (!running) return;
  const srv = running.server;
  running = null;
  await new Promise<void>((resolve, reject) => {
    srv.close((err) => (err ? reject(err) : resolve()));
  });
}

// Read-only accessor for the current binding — used by tests to assert
// fallback behaviour without re-parsing logs.
export function currentBinding(): { host: string; port: number } | null {
  return running ? { host: running.host, port: running.port } : null;
}