// =============================================================================
// MiniMax web session — request signing
//
// Every call to agent.minimaxi.com carries three derived headers plus a signed
// query string. The scheme is the web client's own; it is reproduced here, not
// worked around:
//
//   x-timestamp  unix seconds
//   x-signature  md5(timestamp + jwt + body)
//   yy           md5(encodeURIComponent(path?query) + "_" + body + md5(unixMs) + "ooui")
//
// The query string is the client's device descriptor, and it is part of what
// `yy` covers — so the fields below are load-bearing for the signature, not
// fingerprint dressing. Changing one silently invalidates every request.
// =============================================================================

import { createHash, randomUUID } from "crypto";

// .com, not .io — agent.minimaxi.io has no DNS record. Origin and Referer are
// also derived from this, so a wrong host fails as a CORS rejection rather than
// as an obvious connection error.
export const AGENT_ORIGIN = "https://agent.minimaxi.com";
export const DEVICE_REGISTER_PATH = "/v1/api/user/device/register";
export const SEND_MESSAGE_PATH = "/matrix/api/v1/chat/send_msg";

// The header set the web client sends. Same posture as gemini-web's UA: match
// what the real client sends, and go no further — no rotation, no randomising,
// no attempt to defeat detection.
export const CLIENT_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  "Cache-Control": "no-cache",
  Origin: AGENT_ORIGIN,
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
};

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

export function newUuid(): string {
  return randomUUID();
}

export interface DeviceDescriptor {
  uuid: string;
  userId: string;
  jwtToken: string;
  /** Milliseconds, as a string — it is hashed, so the exact text matters. */
  unixMs: string;
  deviceId?: string;
}

/**
 * The signed query string. Key ORDER is significant: it is concatenated and
 * hashed, so an object literal with reordered fields produces a different `yy`
 * and every request 401s.
 */
export function deviceQueryString(device: DeviceDescriptor): string {
  const fields: Array<[string, string | number | undefined]> = [
    ["device_platform", "web"],
    ["biz_id", 3],
    ["app_id", 3001],
    ["version_code", 22201],
    ["uuid", device.uuid],
    ["device_id", device.deviceId],
    ["os_name", "Mac"],
    ["browser_name", "chrome"],
    ["device_memory", 8],
    ["cpu_core_num", 11],
    ["browser_language", "zh-CN"],
    ["browser_platform", "MacIntel"],
    ["user_id", device.userId],
    ["screen_width", 1920],
    ["screen_height", 1080],
    ["unix", device.unixMs],
    ["lang", "zh"],
    ["token", device.jwtToken],
    ["timezone_offset", 28800],
    ["sys_language", "zh"],
    ["client", "web"],
  ];
  return fields
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export interface SignedRequest {
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** Signs one request. `body` is hashed verbatim, so it is serialised once here
 *  and the same string must be what goes on the wire. */
export function signRequest(
  uri: string,
  payload: unknown,
  device: DeviceDescriptor,
  accept = "application/json, text/plain, */*",
): SignedRequest {
  const body = JSON.stringify(payload);
  const query = deviceQueryString(device);
  const path = `${uri}?${query}`;
  const timestamp = Math.floor(Date.now() / 1000);

  return {
    path,
    body,
    headers: {
      ...CLIENT_HEADERS,
      "Content-Type": "application/json",
      Referer: `${AGENT_ORIGIN}/`,
      token: device.jwtToken,
      "x-timestamp": String(timestamp),
      "x-signature": md5(`${timestamp}${device.jwtToken}${body}`),
      // Accept last: it overrides the value in CLIENT_HEADERS, which matters
      // for the streaming call.
      Accept: accept,
      yy: md5(
        `${encodeURIComponent(path)}_${body}${md5(device.unixMs)}ooui`,
      ),
    },
  };
}

/** The send_msg payload. One prompt string; the site owns no thread we use. */
export function chatPayload(text: string): Record<string, unknown> {
  return {
    msg_type: 1,
    text,
    chat_type: 1,
    attachments: [],
    selected_mcp_tools: [],
    backend_config: {},
    sub_agent_ids: [],
  };
}
