// GENERATED FILE — do not edit.
// Source: apps/core/src/browser-chat/transport/inject.ts
// Regenerate: cd apps/core && pnpm exec tsx scripts/gen-extension-bridge.ts
//
// Runs in the page's MAIN world so it can patch the page's own fetch. A
// content script in the default ISOLATED world cannot: it gets a separate
// window object, and patching that one would capture nothing.
//
// The debug helpers below MUST live here too, not in relay.js: the DevTools
// console evaluates in the MAIN world, so anything defined in the isolated
// world is invisible to someone typing into it.
window.__freecodeFrames = [];
window.__freecodeStats = function () {
  return {
    streams: window.__freecodeCounts.streams,
    chunks: window.__freecodeCounts.chunks,
    chars: window.__freecodeCounts.chars,
    frames: window.__freecodeFrames.length,
    lastUrl: window.__freecodeCounts.lastUrl
  };
};
window.__freecodeCounts = { streams: 0, chunks: 0, chars: 0, lastUrl: null };
window.__freecodeDump = function () {
  return window.__freecodeFrames.join("");
};

window.__freecodeBridge = function (msg) {
  try {
    if (msg.kind === "start") {
      window.__freecodeCounts.streams++;
      window.__freecodeCounts.lastUrl = msg.url;
    } else if (msg.kind === "chunk") {
      window.__freecodeCounts.chunks++;
      window.__freecodeCounts.chars += (msg.text || "").length;
      // Bounded so a long session cannot grow without limit.
      if (window.__freecodeFrames.length < 2000) {
        window.__freecodeFrames.push(msg.text);
      }
    }
    window.postMessage({ __freecodeBridge: true, msg: msg }, "*");
  } catch (e) {
    /* page navigated away mid-send */
  }
};

(() => {
  if (window.__FREECODE_BRIDGE_INSTALLED__) return;
  window.__FREECODE_BRIDGE_INSTALLED__ = true;

  var PATTERNS = ["/completion","/chat_conversations/","/backend-api/conversation"];
  var sink = function (msg) {
    try { window["__freecodeBridge"](msg); } catch (e) { /* detached */ }
  };
  var matches = function (url) {
    for (var i = 0; i < PATTERNS.length; i++) {
      if (url.indexOf(PATTERNS[i]) !== -1) return true;
    }
    return false;
  };

  // A URL pattern alone is not enough: a site's REST endpoints live under the
  // same paths as its streaming one (claude.ai lists conversations under
  // /chat_conversations/), and mirroring one of those emits an immediate
  // "end" that looks exactly like a finished reply. So the response must also
  // LOOK like a stream. Missing headers fall through as "cannot tell" rather
  // than being rejected outright.
  var isStreaming = function (res) {
    try {
      if (!res.headers || typeof res.headers.get !== "function") return true;
      var type = res.headers.get("content-type") || "";
      if (!type) return true;
      return (
        type.indexOf("event-stream") !== -1 ||
        type.indexOf("ndjson") !== -1 ||
        type.indexOf("stream") !== -1
      );
    } catch (e) {
      return true;
    }
  };

  var origFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var self = this;
    return origFetch.apply(self, args).then(function (res) {
      var url = "";
      try {
        url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      } catch (e) { /* opaque request */ }
      if (!url && res && res.url) url = res.url;
      // Report every request URL (never a body). When the pattern matches
      // nothing, this list is the only evidence of where the endpoint moved —
      // without it a stale adapter produces silence, which is the least
      // useful possible diagnostic.
      sink({ kind: "seen", url: url });
      if (!matches(url) || !res || !res.body || !isStreaming(res)) return res;

      var clone = null;
      try { clone = res.clone(); } catch (e) { clone = null; }
      if (!clone || !clone.body) return res;

      (function pump() {
        sink({ kind: "start", url: url });
        var reader = clone.body.getReader();
        var decoder = new TextDecoder();
        var step = function () {
          return reader.read().then(function (r) {
            if (r.done) {
              var tail = decoder.decode();
              if (tail) sink({ kind: "chunk", text: tail });
              sink({ kind: "end" });
              return;
            }
            var text = decoder.decode(r.value, { stream: true });
            if (text) sink({ kind: "chunk", text: text });
            return step();
          });
        };
        step().catch(function (e) {
          sink({ kind: "error", message: String((e && e.message) || e) });
        });
      })();

      return res;
    });
  };
})();

