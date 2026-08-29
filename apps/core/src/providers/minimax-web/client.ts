// =============================================================================
// MiniMax web session — transport
//
// Two calls. First a device registration, whose returned deviceId is cached for
// three hours and must appear in the signed query string of every later call.
// Then send_msg, which streams SSE.
//
// send_msg goes over HTTP/2 explicitly (node:http2) rather than fetch: undici,
// which backs Node's fetch, speaks HTTP/1.1 only, and the reference client
// reached this endpoint over h2. Registration is a plain request and works
// through fetch, so only the streaming path pays the extra complexity.
// =============================================================================

import http2 from "http2";
import { logger } from "../../utils/logger.js";
import { loadMiniMaxWebSettings } from "./settings.js";
import {
  AGENT_ORIGIN,
  DEVICE_REGISTER_PATH,
  SEND_MESSAGE_PATH,
  chatPayload,
  newUuid,
  signRequest,
  type DeviceDescriptor,
} from "./protocol.js";
import { MiniMaxFold, splitEvents } from "./parse.js";

const DEVICE_TTL_MS = 3 * 60 * 60 * 1000;
const STREAM_TIMEOUT_MS = 120_000;

interface CachedDevice {
  deviceId: string;
  realUserID: string;
  expiresAt: number;
}

// Keyed by token so switching accounts does not reuse a device id registered
// against the previous one.
const devices = new Map<string, CachedDevice>();

/** Drops cached registrations. Exported for tests and for a forced re-auth. */
export function resetDeviceCache(): void {
  devices.clear();
}

function credentials(): { jwtToken: string; realUserID: string } {
  const settings = loadMiniMaxWebSettings();
  if (!settings.jwtToken) {
    throw new Error(
      'MiniMax web needs a JWT. Set browsers["minimax-web"].apiKey in ' +
        "~/.freecode/config.json to the `_token` value from a signed-in " +
        "agent.minimaxi.com tab (DevTools -> Application -> Local Storage).",
    );
  }
  return settings;
}

async function registerDevice(signal?: AbortSignal): Promise<CachedDevice> {
  const { jwtToken, realUserID } = credentials();
  const cached = devices.get(jwtToken);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const uuid = newUuid();
  const device: DeviceDescriptor = {
    uuid,
    userId: realUserID,
    jwtToken,
    unixMs: String(Date.now()),
  };
  const signed = signRequest(DEVICE_REGISTER_PATH, { uuid }, device);

  const response = await fetch(`${AGENT_ORIGIN}${signed.path}`, {
    method: "POST",
    headers: signed.headers,
    body: signed.body,
    signal,
  });
  const payload = (await response.json().catch(() => null)) as any;

  if (!response.ok || payload?.statusInfo?.code !== 0) {
    throw new Error(
      `MiniMax device registration failed (HTTP ${response.status}): ` +
        `${payload?.statusInfo?.message ?? "no detail"}`,
    );
  }

  // Registration does not authenticate. Probed live, it returns code 0 with a
  // real deviceID and an EMPTY realUserID for a valid token AND an invalid one
  // alike, so nothing here can be read as proof the JWT is good. `??` is also
  // wrong (it only falls back on null/undefined, and "" is neither), which is
  // why this is an explicit truthiness chain.
  const returnedUserId: string = payload?.data?.realUserID || "";
  const resolvedUserId = returnedUserId || realUserID;
  if (!resolvedUserId) {
    throw new Error(
      "No MiniMax user id: registration returned none and the JWT carries no " +
        "user.id. Use the browsers[\"minimax-web\"].apiKey = " +
        '"<realUserID>+<jwt>" form to supply it explicitly.',
    );
  }

  const fresh: CachedDevice = {
    deviceId: payload?.data?.deviceIDStr ?? "",
    realUserID: resolvedUserId,
    expiresAt: Date.now() + DEVICE_TTL_MS,
  };
  devices.set(jwtToken, fresh);
  logger.debug("[minimax-web] registered device", { deviceId: fresh.deviceId });
  return fresh;
}

/** One streaming turn, yielding incremental text. */
export async function* generateStream(options: {
  prompt: string;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const { jwtToken } = credentials();
  const registered = await registerDevice(options.signal);

  // uuid and user_id both carry the real user id on the chat call — only the
  // registration call uses a random uuid.
  const device: DeviceDescriptor = {
    uuid: registered.realUserID,
    userId: registered.realUserID,
    deviceId: registered.deviceId || undefined,
    jwtToken,
    unixMs: String(Date.now()),
  };
  const signed = signRequest(
    SEND_MESSAGE_PATH,
    chatPayload(options.prompt),
    device,
    "text/event-stream",
  );

  const session = http2.connect(AGENT_ORIGIN);
  try {
    yield* streamFrom(session, signed, options.signal);
  } finally {
    session.close();
  }
}

async function* streamFrom(
  session: http2.ClientHttp2Session,
  signed: { path: string; headers: Record<string, string>; body: string },
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const request = session.request({
    ":method": "POST",
    ":path": signed.path,
    ":scheme": "https",
    ...signed.headers,
  });
  request.setTimeout(STREAM_TIMEOUT_MS, () =>
    request.destroy(new Error("MiniMax stream timed out")),
  );
  const abort = () => request.destroy(new Error("aborted"));
  signal?.addEventListener("abort", abort);
  request.setEncoding("utf-8");
  request.end(signed.body);

  // Check :status before folding anything. Without this a rejected request is
  // indistinguishable from a successful empty one: a 401 carries no SSE frames,
  // so the fold yields nothing, the generator ends, and the turn reports
  // success with no text. Observed live — that is exactly how it presented.
  const status = await new Promise<number>((resolve, reject) => {
    request.on("response", (headers) => resolve(Number(headers[":status"])));
    request.on("error", reject);
  });
  if (status !== 200) {
    let body = "";
    for await (const chunk of request as unknown as AsyncIterable<string>) {
      body += chunk;
      if (body.length > 2000) break;
    }
    throw new Error(
      `MiniMax send_msg was rejected (HTTP ${status})` +
        (body.trim()
          ? `: ${body.slice(0, 300)}`
          : ". The body was empty, which usually means the JWT is not valid " +
            "for agent.minimaxi.com — re-copy `_token` from a signed-in tab " +
            "on that exact host."),
    );
  }

  const fold = new MiniMaxFold();
  let buffer = "";
  try {
    for await (const chunk of request as unknown as AsyncIterable<string>) {
      buffer += chunk;
      const { events, rest } = splitEvents(buffer);
      buffer = rest;
      for (const event of events) {
        const { delta, done } = fold.push(event);
        if (delta) yield delta;
        if (done) return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

/** One non-streaming turn — the stream, collected. */
export async function generate(options: {
  prompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  let text = "";
  for await (const delta of generateStream(options)) text += delta;
  return text;
}
