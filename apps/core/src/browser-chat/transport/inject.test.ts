import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildBridgeScript } from "./inject.js";

/**
 * The bridge is a string of JS that only ever runs inside a page, so a syntax
 * or escaping bug would normally surface as a silent no-op in a live browser.
 * Running it in a VM with a fake `window` catches that offline.
 */
function installBridge(patterns: string[]): {
  window: Record<string, any>;
  sink: any[];
  originalFetch: any;
} {
  const sink: any[] = [];
  const originalFetch = function () {
    return Promise.resolve(null);
  };
  const window: Record<string, any> = {
    fetch: originalFetch,
    __freecodeBridge: (msg: unknown) => sink.push(msg),
  };
  const context = vm.createContext({ window, TextDecoder, Promise, String });
  vm.runInContext(buildBridgeScript(patterns, "__freecodeBridge"), context);
  return { window, sink, originalFetch };
}

function fakeResponse(
  url: string,
  chunks: string[],
  contentType = "text/event-stream",
): any {
  const encoder = new TextEncoder();
  const make = () => {
    let i = 0;
    return {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            i < chunks.length
              ? { value: encoder.encode(chunks[i++]), done: false }
              : { value: undefined, done: true },
          ),
      }),
    };
  };
  const headers = { get: (name: string) => (name === "content-type" ? contentType : null) };
  return { url, headers, body: make(), clone: () => ({ url, headers, body: make() }) };
}

test("the generated script is syntactically valid and installs", () => {
  const { window, originalFetch } = installBridge(["/completion"]);
  assert.equal(window.__FREECODE_BRIDGE_INSTALLED__, true);
  assert.notEqual(window.fetch, originalFetch);
});

test("installing twice does not double-wrap fetch", () => {
  const sink: any[] = [];
  const window: Record<string, any> = {
    fetch: () => Promise.resolve(null),
    __freecodeBridge: (m: unknown) => sink.push(m),
  };
  const context = vm.createContext({ window, TextDecoder, Promise, String });
  const script = buildBridgeScript(["/completion"], "__freecodeBridge");
  vm.runInContext(script, context);
  const afterFirst = window.fetch;
  vm.runInContext(script, context);
  assert.equal(window.fetch, afterFirst);
});

test("a non-matching request reports its URL but mirrors no body", async () => {
  const sink: any[] = [];
  const response = fakeResponse("https://x.test/api/telemetry", ["ignored"]);
  const window: Record<string, any> = {
    fetch: () => Promise.resolve(response),
    __freecodeBridge: (m: unknown) => sink.push(m),
  };
  const context = vm.createContext({ window, TextDecoder, Promise, String });
  vm.runInContext(
    buildBridgeScript(["/completion"], "__freecodeBridge"),
    context,
  );

  await window.fetch("https://x.test/api/telemetry");
  await new Promise((r) => setTimeout(r, 20));

  // The URL is reported — that list is how a moved endpoint gets found.
  // Field-wise, not deepEqual: these objects come from the VM realm and so
  // have a different Object prototype.
  assert.equal(sink.length, 1);
  assert.equal(sink[0].kind, "seen");
  assert.equal(sink[0].url, "https://x.test/api/telemetry");
  // But nothing was read from the body.
  assert.equal(
    sink.some((m) => m.kind === "chunk" || m.kind === "start"),
    false,
  );
});

test("REGRESSION: a matching URL with a JSON body is not mirrored", async () => {
  // claude.ai serves its REST conversation list under the same /chat_conversations/
  // path as the streaming endpoint. Mirroring one emitted an immediate "end"
  // that looked exactly like a finished reply, ending a capture before the
  // user had typed anything.
  const sink: any[] = [];
  const response = fakeResponse(
    "https://x.test/api/chat_conversations/abc",
    ['[{"uuid":"1"}]'],
    "application/json",
  );
  const window: Record<string, any> = {
    fetch: () => Promise.resolve(response),
    __freecodeBridge: (m: unknown) => sink.push(m),
  };
  const context = vm.createContext({ window, TextDecoder, Promise, String });
  vm.runInContext(
    buildBridgeScript(["/chat_conversations/"], "__freecodeBridge"),
    context,
  );

  await window.fetch("https://x.test/api/chat_conversations/abc");
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(sink.length, 1);
  assert.equal(sink[0].kind, "seen");
  assert.equal(
    sink.some((m) => m.kind === "start" || m.kind === "end"),
    false,
    "a JSON response must not produce start/end",
  );
});

test("a response with no content-type is still mirrored (cannot tell)", async () => {
  const sink: any[] = [];
  const response: any = fakeResponse("https://x.test/completion", ["data: a\n\n"]);
  response.headers = undefined;
  response.clone = () => ({ url: response.url, body: response.body });
  const window: Record<string, any> = {
    fetch: () => Promise.resolve(response),
    __freecodeBridge: (m: unknown) => sink.push(m),
  };
  const context = vm.createContext({ window, TextDecoder, Promise, String });
  vm.runInContext(
    buildBridgeScript(["/completion"], "__freecodeBridge"),
    context,
  );
  await window.fetch("https://x.test/completion");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sink.some((m) => m.kind === "start"));
});

test("a matching response is mirrored to the sink and returned intact", async () => {
  const sink: any[] = [];
  const response = fakeResponse("https://x.test/api/completion", [
    "data: a\n\n",
    "data: b\n\n",
  ]);
  const window: Record<string, any> = {
    fetch: () => Promise.resolve(response),
    __freecodeBridge: (m: unknown) => sink.push(m),
  };
  const context = vm.createContext({ window, TextDecoder, Promise, String });
  vm.runInContext(
    buildBridgeScript(["/completion"], "__freecodeBridge"),
    context,
  );

  const returned = await window.fetch("https://x.test/api/completion");
  // The page must receive the very same object, not a synthesized copy.
  assert.equal(returned, response);

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sink[0].kind, "seen");
  assert.equal(sink[1].kind, "start");
  const text = sink
    .filter((m) => m.kind === "chunk")
    .map((m) => m.text)
    .join("");
  assert.equal(text, "data: a\n\ndata: b\n\n");
  assert.equal(sink[sink.length - 1].kind, "end");
});
