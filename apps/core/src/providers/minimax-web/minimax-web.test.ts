import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { parseCredential, parseJwtUserId } from "./settings.js";
import {
  AGENT_ORIGIN,
  chatPayload,
  deviceQueryString,
  signRequest,
  type DeviceDescriptor,
} from "./protocol.js";
import { MiniMaxFold, splitEvents } from "./parse.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

function jwt(payload: unknown): string {
  return jwtFromText(JSON.stringify(payload));
}

/** Raw payload text, for cases a JS literal cannot express — an 18-digit id is
 *  already rounded by the parser before JSON.stringify ever sees it. */
function jwtFromText(payloadText: string): string {
  return `header.${Buffer.from(payloadText).toString("base64url")}.signature`;
}

const DEVICE: DeviceDescriptor = {
  uuid: "u-1",
  userId: "user-1",
  jwtToken: "tok",
  unixMs: "1700000000000",
};

// ─── credentials ─────────────────────────────────────────────────────────────

test("reads the user id out of a JWT payload", () => {
  assert.equal(parseJwtUserId(jwt({ user: { id: "12345" } })), "12345");
  // Some accounts report it as a number; the signature is string-concatenated,
  // so it has to come back as a string either way.
  assert.equal(parseJwtUserId(jwt({ user: { id: 678 } })), "678");
});

test("an 18-digit numeric id survives verbatim", () => {
  // Real ids are past Number.MAX_SAFE_INTEGER. Via JSON.parse this one comes
  // back as ...712450, and since the id is concatenated into the signed query
  // string the result is an auth rejection that points nowhere near the cause.
  const id = "502526392868712457";
  assert.equal(parseJwtUserId(jwtFromText(`{"user":{"id":${id}}}`)), id);
  assert.notEqual(String(JSON.parse(`{"i":${id}}`).i), id); // guards the premise
});

test("a malformed or unsigned token yields no id rather than throwing", () => {
  assert.equal(parseJwtUserId("not-a-jwt"), "");
  assert.equal(parseJwtUserId("a.b"), "");
  assert.equal(parseJwtUserId("a.!!!notbase64!!!.c"), "");
});

test("accepts all three credential shapes", () => {
  const token = jwt({ user: { id: "from-jwt" } });
  assert.deepEqual(parseCredential(token), {
    jwtToken: token,
    realUserID: "from-jwt",
  });
  // "+" is not a base64url character, so it is unambiguously the separator.
  assert.deepEqual(parseCredential(`explicit+${token}`), {
    jwtToken: token,
    realUserID: "explicit",
  });
  assert.deepEqual(parseCredential(token, "override"), {
    jwtToken: token,
    realUserID: "override",
  });
});

test("tolerates a Bearer prefix pasted in with the token", () => {
  assert.equal(parseCredential("Bearer abc").jwtToken, "abc");
});

// ─── signing ─────────────────────────────────────────────────────────────────

test("the device query string keeps its exact field order", () => {
  // The string is hashed as-is, so reordering silently invalidates every
  // request. Pinned in full rather than spot-checked.
  assert.equal(
    deviceQueryString(DEVICE),
    "device_platform=web&biz_id=3&app_id=3001&version_code=22201&uuid=u-1" +
      "&os_name=Mac&browser_name=chrome&device_memory=8&cpu_core_num=11" +
      "&browser_language=zh-CN&browser_platform=MacIntel&user_id=user-1" +
      "&screen_width=1920&screen_height=1080&unix=1700000000000&lang=zh" +
      "&token=tok&timezone_offset=28800&sys_language=zh&client=web",
  );
});

test("device_id is omitted before registration and present after", () => {
  assert.ok(!deviceQueryString(DEVICE).includes("device_id"));
  assert.match(
    deviceQueryString({ ...DEVICE, deviceId: "dev-9" }),
    /uuid=u-1&device_id=dev-9&os_name/,
  );
});

test("signature and yy follow the documented scheme", () => {
  const signed = signRequest("/p", { a: 1 }, DEVICE);
  const body = JSON.stringify({ a: 1 });
  const ts = signed.headers["x-timestamp"];

  assert.equal(signed.body, body);
  assert.equal(signed.headers["x-signature"], md5(`${ts}tok${body}`));
  assert.equal(
    signed.headers.yy,
    md5(`${encodeURIComponent(signed.path)}_${body}${md5(DEVICE.unixMs)}ooui`),
  );
  assert.equal(signed.headers.token, "tok");
});

test("Accept overrides the client header set, for the streaming call", () => {
  // CLIENT_HEADERS carries an application/json Accept; spreading it after the
  // override would silently ask for JSON on an SSE endpoint.
  assert.equal(
    signRequest("/p", {}, DEVICE, "text/event-stream").headers.Accept,
    "text/event-stream",
  );
});

test("talks to the host that actually exists", () => {
  // agent.minimaxi.io has no DNS record; Origin and Referer derive from this,
  // so a wrong host fails as a CORS rejection rather than a connection error.
  assert.equal(AGENT_ORIGIN, "https://agent.minimaxi.com");
});

test("the chat payload carries the prompt and no attachments", () => {
  assert.deepEqual(chatPayload("hi"), {
    msg_type: 1,
    text: "hi",
    chat_type: 1,
    attachments: [],
    selected_mcp_tools: [],
    backend_config: {},
    sub_agent_ids: [],
  });
});

// ─── SSE folding ─────────────────────────────────────────────────────────────

const sse = (payload: unknown) =>
  `event: message_result\ndata: ${JSON.stringify(payload)}\n\n`;
const messageResult = (content: string, isEnd = 1) => ({
  data: { messageResult: { chat_id: 7, isEnd, content } },
});

test("splitEvents returns whole events and keeps the partial tail", () => {
  const { events, rest } = splitEvents(sse(messageResult("a")) + "event: par");
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "message_result");
  assert.equal(rest, "event: par");
});

test("content is cumulative, so only the new suffix is emitted", () => {
  // The reference sliced against text.indexOf('') — an EMPTY literal, always 0,
  // so its chunk was always "". Slicing against what was emitted is the fix.
  const fold = new MiniMaxFold();
  const push = (c: string, isEnd = 1) =>
    fold.push(splitEvents(sse(messageResult(c, isEnd))).events[0]);

  assert.equal(push("Hello").delta, "Hello");
  assert.equal(push("Hello, world").delta, ", world");
  assert.equal(push("Hello, world").delta, undefined);
  assert.equal(fold.text, "Hello, world");
});

test("isEnd === 0 means finished", () => {
  // Zero reads like "not ended" and is the opposite; a misread here hangs the
  // turn until the socket times out.
  const fold = new MiniMaxFold();
  const events = splitEvents(sse(messageResult("done", 0))).events;
  assert.equal(fold.push(events[0]).done, true);
});

test("a non-zero status code is raised, not streamed", () => {
  const fold = new MiniMaxFold();
  const events = splitEvents(
    `data: ${JSON.stringify({ base_resp: { status_code: 1004, status_msg: "auth failed" } })}\n\n`,
  ).events;
  assert.throws(() => fold.push(events[0]), /auth failed/);
});

test("a reply that restarts is refused rather than contradicting the user", () => {
  const fold = new MiniMaxFold();
  fold.push(splitEvents(sse(messageResult("Hello, world"))).events[0]);
  assert.throws(
    () => fold.push(splitEvents(sse(messageResult("Different"))).events[0]),
    /restarted/,
  );
});

test("an unparseable frame is skipped, not fatal", () => {
  const fold = new MiniMaxFold();
  assert.deepEqual(fold.push({ data: "{not json" }), { done: false });
});
