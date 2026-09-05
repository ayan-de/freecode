import type { IncomingMessage } from "http";

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

export function isHopByHop(name: string): boolean {
  return HOP.has(name.toLowerCase());
}

/** Join the incoming path onto the upstream prefix without collapsing it. */
export function destUrl(upstream: string, reqUrl: string): URL {
  const prefix = new URL(upstream);
  const incoming = new URL(reqUrl, "http://proxy.local");
  const base = prefix.pathname.replace(/\/$/, "");
  return new URL(base + incoming.pathname + incoming.search, prefix.origin);
}

export function outboundHeaders(req: IncomingMessage, dest: URL): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (!value || isHopByHop(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("host", dest.host);
  return headers;
}
