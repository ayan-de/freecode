// =============================================================================
// Browser Chat — in-page bridge script
//
// Runs inside the site's own origin. Deliberately DUMB: it forwards raw
// response text and nothing else. All framing and decoding happens in Node,
// where it is unit-testable without a browser.
//
// This exact script is what a future extension transport would inject too —
// that is what makes the extension a drop-in rather than a rewrite.
// =============================================================================

/**
 * Patches `fetch` and mirrors matching response bodies to `bindingName`.
 *
 * Uses `Response.clone()` rather than `body.tee()` + a synthesized Response:
 * cloning leaves the object the page receives completely untouched, so a site
 * that inspects `res.url`, `res.type`, or `res.redirected` keeps working.
 */
export function buildBridgeScript(
  patterns: string[],
  bindingName: string,
): string {
  return `
(() => {
  if (window.__FREECODE_BRIDGE_INSTALLED__) return;
  window.__FREECODE_BRIDGE_INSTALLED__ = true;

  var PATTERNS = ${JSON.stringify(patterns)};
  var sink = function (msg) {
    try { window[${JSON.stringify(bindingName)}](msg); } catch (e) { /* detached */ }
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
`;
}
