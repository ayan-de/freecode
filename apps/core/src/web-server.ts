import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { handleRequest, sessionEventCallbacks } from "./server.js";

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

export function startWebServer(
  port: number,
  host: string = "127.0.0.1",
): http.Server {
  const distDir = path.join(__dirname, "..", "..", "web-app", "dist");

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "", `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    // CORS Headers for development/local use
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
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

      // Write heartbeat comment to keep connection alive
      res.write(": heartbeat\n\n");

      const callback = (event: any) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Register listener
      sessionEventCallbacks.set(sessionId, callback);

      req.on("close", () => {
        sessionEventCallbacks.delete(sessionId);
      });
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
    console.log(`[Server] Web interface running at http://${host}:${port}/`);
  });

  return server;
}
