# FreeCode Browser Bridge

Lets FreeCode use a chat site **you are already signed in to, in your normal browser**.

## Why this exists

The CDP transport (`freecode browser doctor`) launches a separate Chromium and attaches a
debugger to it. claude.ai's bot protection detects that and serves a verification
interstitial that does not clear — see the 2026-08-20 finding in
`docs/superpowers/specs/2026-08-19-browser-chat-provider.md`.

An extension is a different integration, not a workaround: there is no automation to
detect. Your browser is genuinely your browser, the tab is a tab you opened, and the login
is your own session. FreeCode contains no anti-detection code and will not.

## Status: spike

Right now this answers two questions and nothing else:

1. Does the site leave a normal browser + extension alone?
2. Do we capture the completion stream, and what shape are the frames?

Question 2 also produces the fixture data needed to finish `sites/claude.ts`, whose frame
decoding is still provisional.

## Install (developer mode)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`apps/extension`).
4. Open or reload <https://claude.ai>.

Requires Chrome/Chromium **111+** for `"world": "MAIN"` content scripts.

Nothing needs to be running on the FreeCode side for the spike.

## Try it

1. On claude.ai, open DevTools → Console.
2. You should see: `[freecode] bridge active on claude.ai`.
3. Send any message in the chat as you normally would.
4. Watch for `[freecode] capturing stream from …` then `[freecode] stream complete — N chunks`.
5. Run `__freecodeStats()` in the console for the totals.

Frames are recorded automatically — no snippet to paste first.

| Console helper | Does |
| --- | --- |
| `__freecodeStats()` | stream/chunk/char counts and the matched URL |
| `__freecodeDump()` | every captured frame as one string |
| `copy(__freecodeDump())` | puts that on the clipboard |
| `__freecodeConnect()` | retry the FreeCode WebSocket after starting FreeCode |

These live in the page's MAIN world (`capture.generated.js`), because the DevTools console
evaluates there — helpers defined in `relay.js` would be invisible to it.

### Reading the result

| What you see | Meaning |
| --- | --- |
| Verification page, no `[freecode]` line | The site challenges even a normal browser+extension. Browser mode is not viable for this site. |
| `bridge active`, but no `capturing stream` when you send | Capture works, but the URL patterns miss the real endpoint. |
| `stream complete — N chunks` | **It works.** Proceed to the real transport. |

To capture frames for fixtures, send a message and then:

```js
copy(__freecodeDump());
```

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3. Two content scripts: capture in MAIN world, relay in ISOLATED. |
| `capture.generated.js` | **Generated — do not edit.** Built from `apps/core/src/browser-chat/transport/inject.ts`. |
| `relay.js` | Receives captures via `postMessage`, forwards to FreeCode over `ws://127.0.0.1:8765`. |

Regenerate the capture script after changing the canonical bridge:

```bash
cd apps/core && pnpm exec tsx scripts/gen-extension-bridge.ts
```

It is generated rather than copied so a fix to the bridge cannot apply to only one
transport.

## Why two content scripts

A content script in the default ISOLATED world gets its own `window`. Patching `fetch`
there captures nothing, because the page keeps using its own. The capture script therefore
runs in the MAIN world, and hands data to the ISOLATED relay via `postMessage` — only the
isolated world may talk to extension APIs and the WebSocket.

## Not done yet

- No `BrowserTransport` implementation — FreeCode cannot yet *drive* a conversation
  through this, only observe one.
- Nothing listens on `ws://127.0.0.1:8765`.
- Sending a message (typing into the composer) is still CDP-only.
