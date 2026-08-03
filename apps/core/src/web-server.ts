// =============================================================================
// HTTP server for the FreeCode web SPA + JSON-RPC + SSE.
//
// Auth: when the bind host is non-loopback, every /api and /events request
// must present the bearer token from ~/.freecode/web-token. Loopback binds
// stay open unless --require-auth is set, preserving today's desktop flow.
// On a non-loopback bind the server starts regardless of auth status — the
// server prints the QR pairing URL and the failure response is 401 with no
// timing difference between "no token" and "wrong token" (see web/auth.ts).
//
// CORS: an origin header is echoed only when it is loopback or matches the
// configured bind host. A wildcard + credentials is the classic path to a
// drive-by that pivots through the browser of anyone on the network, so
// the previous `Access-Control-Allow-Origin: *` is gone.
//
// SSE: per-session subscriber set with a heartbeat + idle reaper (see
// web/stream-subscribers.ts). Each new /events connection adds to the set
// instead of overwriting, so a phone can attach while the desktop TUI is
// also attached.
// =============================================================================

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { handleRequest } from "./server.js";
import {
  addSubscriber,
  removeSubscriber,
  disposeSession,
} from "./web/stream-subscribers.js";
import {
  compareTokens,
  extractToken,
  isAuthRequired,
  loadOrCreateToken,
} from "./web/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface WebServerOptions {
  /** Loopback bind (default) skips auth. Non-loopback requires it. */
  requireAuth?: boolean;
  /** Test hook — pass the token rather than reading/disk. */
  _token?: string;
}

export function startWebServer(
  port: number,
  host: string = "127.0.0.1",
  options: WebServerOptions = {},
): http.Server {
  const distDir = path.join(__dirname, "..", "..", "web-app", "dist");
  const requireAuth = options.requireAuth ?? false;
  const authOn = isAuthRequired(host, requireAuth);
  const token: string = options._token ?? loadOrCreateToken();

  // Barebones loopback check for CORS echo — anything on 127/::1/0.0.0.0
  // is treated as local, but a non-loopback bind echoes only its own host.
  const isLocalOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true; // missing origin (curl, native, server-side)
    try {
      const u = new URL(origin);
      return (
        u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.hostname === "::1" ||
        u.hostname === host
      );
    } catch {
      return false;
    }
  };

  const unauthorized = (res: http.ServerResponse): void => {
    // Same body, same headers, same code path whether the token was missing
    // or wrong. The auth module guarantees no timing difference either way.
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
      }),
    );
  };

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "", `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    // CORS: echo the request origin only when it's loopback or matches the
    // configured bind host. No wildcards; no credentials; no preflight cache.
    const origin = req.headers.origin;
    if (origin && isLocalOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Last-Event-ID",
      );
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth gate — applies to /api and /events only. Static SPA assets are
    // not gated because once a user has the token, they load the SPA with
    // it and the SPA then attaches Authorization to its own fetch calls.
    // (Gating the SPA itself would block the very page that sends the
    // token.) The bearer token is checked via constant-time compare.
    if (authOn && (pathname === "/api" || pathname === "/events")) {
      const presented = extractToken(
        req.headers as Record<string, string | string[] | undefined>,
        parsedUrl,
      );
      if (!compareTokens(presented, token)) {
        unauthorized(res);
        return;
      }
    }

    // 1. JSON-RPC API Endpoint
    if (req.method === "POST" && pathname === "/api") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const request = JSON.parse(body);
          const response = await handleRequest(request);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } catch (err: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32700, message: "Parse error / Invalid JSON" },
            }),
          );
        }
      });
      return;
    }

    // 2. Server-Sent Events Endpoint for real-time agent stream
    if (req.method === "GET" && pathname === "/events") {
      const sessionId = parsedUrl.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing sessionId parameter");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // The first frame is a comment so the client sees the connection open
      // before any data event. Real heartbeats are emitted every 15s by the
      // reaper in stream-subscribers.ts — see HEARTBEAT_MS.
      res.write(": connected\n\n");

      // Wire format `data: <json>\n\n` is owned by stream-subscribers so
      // the caller doesn't need to pass a writer. The module also binds
      // req/res close+error and prunes on backpressure or destroyed
      // sockets — no req.on("close") handler needed here.
      addSubscriber(sessionId, req, res);

      // Reference keepalive — these are exported for callers (e.g. tests)
      // that need to dispose a session or remove a subscriber directly.
      void removeSubscriber;
      void disposeSession;
      return;
    }

    // 3. Serve Static Files from apps/web-app/dist
    if (req.method === "GET" || req.method === "HEAD") {
      // Clean up path
      let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
      if (safePath === "/" || safePath === "\\") {
        safePath = "index.html";
      }

      let filePath = path.join(distDir, safePath);

      // Check if file exists, fallback to index.html for SPA routing
      let exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      if (!exists) {
        filePath = path.join(distDir, "index.html");
        exists = fs.existsSync(filePath);
      }

      if (!exists) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      res.writeHead(200, { "Content-Type": contentType });
      if (req.method === "GET") {
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.end();
      }
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}/`;
    console.log(`[Server] Web interface running at ${url}`);

    // Only print the pairing QR + URL when auth is actually required —
    // loopback binds print nothing because there's no second device to
    // pair (and printing 43 base64 chars into every TTY run is noise).
    if (authOn) {
      console.log(`[Server] Pair URL: freecode://${host}:${port}/?token=${token}`);
      console.log(`[Server] Web URL:  ${url}?token=${token}`);
      try {
        // qrcode-terminal is ~1 dependency; failure here is non-fatal —
        // the URL is still printed above.
        // Dynamic import keeps the dep optional for environments where
        // the printout is suppressed (tests, loopback).
        import("qrcode-terminal").then((mod) => {
          // qrcode-terminal exports a function under .generate in CJS, or
          // .default in ESM. Both are runtime-checked here so the package's
          // own types — which are surprisingly particular — don't surface
          // errors. We treat the callback API as the contract.
          const candidate: unknown = (mod as unknown as { generate?: unknown }).generate
            ?? (mod as unknown as { default?: unknown }).default;
          if (typeof candidate === "function") {
            (
              candidate as (
                cb: (s: string) => void,
                opts: object,
              ) => void
            )(
              (qr: string) => {
                console.log(
                  `\n[Server] Scan to pair (terminal must support UTF-8):\n${qr}`,
                );
              },
              { small: true },
            );
          }
        }).catch(() => {
          // qrcode-terminal not available — URL above is the fallback.
        });
      } catch {
        // Same.
      }
    }
  });

  return server;
}
