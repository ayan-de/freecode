// =============================================================================
// Generates apps/extension/capture.generated.js from the canonical bridge.
//
// The extension and the CDP transport MUST run the same capture code — that is
// the whole reason transport and site knowledge were split. Generating it means
// a fix to inject.ts cannot silently apply to only one of them.
//
// Run:  pnpm exec tsx scripts/gen-extension-bridge.ts   (from apps/core)
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildBridgeScript } from "../src/browser-chat/transport/inject.js";

// Union of every site we might capture. The extension is not per-site: the
// content script matches on host, and the adapter decides what a frame means.
const PATTERNS = [
  "/completion",
  "/chat_conversations/",
  "/backend-api/conversation",
];

const BINDING = "__freecodeBridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(
  __dirname,
  "../../extension/capture.generated.js",
);

// In the CDP transport the binding is installed by Playwright's exposeBinding.
// In the extension there is no such thing, so the MAIN-world script hands
// messages to the ISOLATED-world relay via postMessage instead. Same bridge,
// different sink.
const prelude = `// GENERATED FILE — do not edit.
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

window.${BINDING} = function (msg) {
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
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  prelude + buildBridgeScript(PATTERNS, BINDING) + "\n",
  "utf-8",
);
console.log(`wrote ${outputPath}`);
