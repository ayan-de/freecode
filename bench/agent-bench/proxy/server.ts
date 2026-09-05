// Pass-through recording proxy. Spec §6.4: no caching, no retries, no
// rewriting. Tokens come off the wire; the log is also the isolation audit.

import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { isModelEndpoint } from "./audit.js";
import { destUrl, isHopByHop, outboundHeaders } from "./forward.js";
import { parseUsage, usageFromSse, type Usage } from "./usage.js";

export interface LoggedCall {
  ts: string;
  method: string;
  path: string;
  host: string;
  status: number;
  durationMs: number;
  requestBytes: number;
  responseBytes: number;
  model?: string;
  usage?: Usage;
  /** False when the path is not a model API — a leak, or an attempt at one. */
  modelEndpoint: boolean;
}

export interface ProxyOptions {
  /** Origin + path prefix the agent thinks it is talking to, e.g. MiniMax /anthropic. */
  upstream: string;
  logPath: string;
  /**
   * Bind address. Default loopback; isolated trials bind the internal docker
   * network's gateway instead, the one address an agent container can reach.
   */
  host?: string;
}

export interface RecordingProxy {
  origin: string;
  port: number;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function modelFrom(body: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(body.toString("utf-8"));
    return typeof parsed?.model === "string" ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

function usageFrom(body: Buffer, contentType: string | undefined): Usage | undefined {
  const text = body.toString("utf-8");
  if (contentType?.includes("event-stream") || text.startsWith("event:")) {
    return usageFromSse(text);
  }
  try {
    return parseUsage(JSON.parse(text));
  } catch {
    return usageFromSse(text);
  }
}

function appendLog(file: string, row: LoggedCall): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n");
}

export async function startProxy(opts: ProxyOptions): Promise<RecordingProxy> {
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const reqUrl = req.url ?? "/";
    const dest = destUrl(opts.upstream, reqUrl);
    const method = req.method ?? "GET";
    let status = 502;
    let responseBytes = 0;
    let requestBytes = 0;
    let model: string | undefined;
    let usage: Usage | undefined;
    try {
      const body = await readBody(req);
      requestBytes = body.length;
      model = modelFrom(body);
      const init: RequestInit = {
        method,
        headers: outboundHeaders(req, dest),
      };
      if (method !== "GET" && method !== "HEAD") init.body = new Uint8Array(body);
      const up = await fetch(dest, init);
      status = up.status;
      for (const [name, value] of up.headers) {
        if (isHopByHop(name)) continue;
        res.setHeader(name, value);
      }
      res.statusCode = status;
      const chunks: Buffer[] = [];
      if (up.body) {
        for await (const chunk of up.body) {
          const buf = Buffer.from(chunk);
          chunks.push(buf);
          responseBytes += buf.length;
          res.write(buf);
        }
      }
      res.end();
      usage = usageFrom(Buffer.concat(chunks), up.headers.get("content-type") ?? undefined);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end(String((err as Error).message));
      } else {
        res.end();
      }
    } finally {
      const pathname = new URL(reqUrl, "http://proxy.local").pathname;
      appendLog(opts.logPath, {
        ts: new Date().toISOString(),
        method,
        path: pathname,
        host: dest.host,
        status,
        durationMs: Date.now() - started,
        requestBytes,
        responseBytes,
        model,
        usage,
        modelEndpoint: isModelEndpoint(pathname),
      });
    }
  });

  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("proxy: no port");
  return {
    origin: `http://${host}:${addr.port}`,
    port: addr.port,
    close: () =>
      new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
