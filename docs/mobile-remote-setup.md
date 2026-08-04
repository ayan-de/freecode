# Mobile Remote — Contributor Setup

**Audience:** contributors working on the Android client (`apps/android`) or the
remote server path (`apps/core/src/web*`).
**Spec:** [`superpowers/specs/2026-08-04-android-remote-client.md`](superpowers/specs/2026-08-04-android-remote-client.md)

This is the setup and debugging runbook. The spec explains *why* the design is
what it is; this explains how to get it running on a real phone and how to
diagnose it when it isn't.

---

## 1. Prerequisites

| Thing | Why |
| --- | --- |
| Tailscale on the desktop **and** the phone, same tailnet | The transport. No public port is ever opened. |
| JDK 21 | Gradle toolchain is pinned (`gradle/gradle-daemon-jvm.properties`) |
| Android SDK + `adb` | Typically `~/Android/Sdk/platform-tools/adb` |
| A physical device, API 26+ | The emulator cannot exercise the lock-screen approval path, which is the whole point of the feature |

An emulator is fine for layout work and useless for Phase 4 verification.

---

## 2. Tailscale

### Install

```bash
# Arch
sudo pacman -S tailscale
# Debian/Ubuntu
curl -fsSL https://tailscale.com/install.sh | sh
# macOS
brew install tailscale
```

### Start the daemon and log in

```bash
sudo systemctl enable --now tailscaled   # Linux/systemd; skip on macOS
sudo tailscale up
```

`tailscale up` prints an auth URL. Open it, sign in, approve the machine. This
step is interactive by design and cannot be scripted — SSO opens a browser.

Verify it actually completed. A common failure is the unit starting while the
login never finishes:

```bash
tailscale status
# Logged out.                    <- login did NOT complete, run `tailscale up` again
```

### Find your addresses

```bash
tailscale ip -4        # e.g. 100.64.143.54
tailscale status       # lists every device on the tailnet, including the phone
```

Confirm the phone appears in `tailscale status` before pairing. If it doesn't,
it isn't on the tailnet and nothing downstream will work.

### Get the MagicDNS hostname — you need this, not the IP

```bash
tailscale status --json | jq -r .Self.DNSName
# omarchy.taild21f3b.ts.net.
```

> **Always bind and pair using the MagicDNS hostname, never the raw
> `100.64.x.y` address.**
>
> `app/src/main/res/xml/network_security_config.xml` denies cleartext by
> default and carves out `*.ts.net`. Tailscale's range is `100.64.0.0/10`, a
> CIDR — and Android's network security config has no way to express an address
> range, only names. A raw tailnet IP is therefore blocked with
> `ERR_CLEARTEXT_NOT_PERMITTED`, while the hostname is permitted.
>
> Pairing may still *appear* to succeed with an IP, because `Reachability.kt`
> uses `HttpURLConnection`, which is not subject to the WebView's cleartext
> policy. The failure then surfaces later as a blank WebView.

---

## 3. Build and run

### Build the pieces

```bash
pnpm build                          # everything, via turbo
# or individually:
pnpm --filter web-app build         # the SPA the WebView loads
pnpm --filter @thisisayande/freecode-core build
```

`web-server.ts` serves `apps/web-app/dist`. **A stale `dist` is served
silently** — if SPA changes aren't showing up on the phone, rebuild it before
suspecting the Android side.

### Start the daemon

```bash
node apps/core/dist/cli.js web --host omarchy.taild21f3b.ts.net --port 4096 --no-open
```

Output:

```
[Server] Web interface running at http://omarchy.taild21f3b.ts.net:4096/
[Server] Pair URL: freecode://omarchy.taild21f3b.ts.net:4096/?token=…
[Server] Web URL:  http://omarchy.taild21f3b.ts.net:4096/?token=…

[Server] Scan to pair (terminal must support UTF-8):
█▀▀▀▀▀█ ▄▀ ▀ ▄▄▀▄ █ ██▀▀ ██▄█ █▀▀▀▀▀█
…
```

Notes:

- Auth turns on automatically for any non-loopback bind. Loopback stays
  unauthenticated unless you pass `--require-auth`.
- The token lives at `~/.freecode/web-token`, mode `0600`. It is stable across
  restarts.
- No QR? Widen the terminal, and make sure it renders UTF-8 block characters.

### Build and install the app

```bash
cd apps/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Android Studio works too, but **check what you actually installed.** If Studio
built before your latest edits you will be debugging stale code — a genuinely
easy hour to lose.

### Pair

Scan the QR, tap Connect, grant the notification permission.

Denying notifications is not cosmetic: the blocked-approval escalation is the
mechanism that stops a tool call being silently denied when the prompt times
out. Deny it and Test 3 below cannot pass.

---

## 4. Debugging

### Logs

```bash
adb logcat -c
adb logcat -s "ChatScreen:V" "chromium:V" "AndroidRuntime:E"
```

`ChatScreen` logs page loads, HTTP errors, and — via the `WebChromeClient` —
every JS console message with source and line.

Keep each `adb` invocation on **one line**. Wrapped multi-line pastes split at
the newline and produce `command not found: shell`.

### Inspect the WebView live

With USB attached, open `chrome://inspect/#devices` on the desktop and click
**inspect**. Full DevTools — Elements, Console, Network — against the phone's
WebView. Enabled by `setWebContentsDebuggingEnabled` in debuggable builds.

This is the highest-value debugging tool for this feature by a wide margin.

### Capture the screen

```bash
adb exec-out screencap -p > /tmp/phone.png
```

### Dump the view hierarchy

```bash
adb shell uiautomator dump /sdcard/ui.xml
adb shell cat /sdcard/ui.xml > /tmp/ui.xml
```

Shows every on-screen node with `bounds` and class, including the WebView's
internal accessibility tree. Use it to tell "view never attached" from
"attached but zero-sized" from "attached, sized, and not painting" — three
failures that look identical from the outside.

### Check the WebView provider

```bash
adb shell dumpsys webviewupdate | head -20
```

Rules the device out before you go hunting in your own code.

---

## 5. Failure modes worth knowing

Every one of these was hit during the first real device bring-up. Each produced
a symptom that pointed somewhere other than its cause.

| Symptom | Cause |
| --- | --- |
| `Cleartext HTTP traffic to 100.64.x.y not permitted` | Paired with the raw IP. Re-pair with the MagicDNS hostname (§2). |
| Blank/black WebView, clean logs, DevTools shows a healthy DOM | The page laid out against a 0×0 viewport. Android WebView pins `vh` units to the initial containing block from the document's first layout and never re-resolves them, so `100vh` stays `0` forever even once `innerHeight` is correct. Fixed two ways: `loadWhenSized()` defers the load until the view is measured, and the SPA measures `innerHeight` into `--app-h` rather than trusting `100vh`. **Never reintroduce a bare `100vh`/`h-screen` in the SPA's layout chain.** |
| `NetworkOnMainThreadException` when pairing | Blocking I/O on `Dispatchers.Main`. `suspend` alone does not move work off the calling thread — wrap in `withContext(Dispatchers.IO)`. |
| Chrome shows `ERR_SSL_PROTOCOL_ERROR` for the `http://` URL | Chrome's HTTPS auto-upgrade, not a server fault. Use the IP, or turn off "Always use secure connections". Does not affect the WebView. |
| No pairing QR, only URLs | `qrcode-terminal` is CJS — `generate` hangs off `.default`, takes `(input, opts, cb)`, and reads its error-correction level off `this`, so it must stay attached to the module object. |
| Blocked-state notification never appears | `POST_NOTIFICATIONS` denied, or the "Approval needed" channel muted. API 26+ fixes importance at channel creation and ignores `PRIORITY_HIGH`, which is why the escalation is a separate high-importance channel. |
| SPA changes not appearing on the phone | Stale `apps/web-app/dist`. Rebuild and restart the daemon. |

**Diagnostic lesson.** When the DOM is alive but the screen is blank, get
computed styles before theorising about the native layer:

```js
JSON.stringify({
  innerH: innerHeight,
  bodyH: getComputedStyle(document.body).height,
  rootH: getComputedStyle(document.getElementById('root')).height,
  elH:   getComputedStyle(document.querySelector('#root > *')).height,
})
```

`innerH: 872` alongside `bodyH: "0px"` names the bug immediately. Reaching for
Compose theories first cost several rebuild cycles.

---

## 6. Verification checklist (spec §7, Phase 4)

Run on hardware. An emulator cannot validate 2–5.

- [ ] **1. Remote prompt** — send a prompt, watch it stream.
- [ ] **2. Screen-locked streaming** — lock mid-turn for 30s; transcript is gap-free, quiet ongoing notification present.
- [ ] **3. Blocked approval** — trigger a tool permission, lock the phone immediately. A high-importance heads-up notification naming the tool must arrive and be answerable well inside the deny deadline. **This is the feature.**
- [ ] **4. Multi-device resolution** — answer from the TUI; the phone's modal self-dismisses (`-32002`).
- [ ] **5. Network handover** — wifi↔cellular mid-turn; stream resumes gap-free, or renders an explicit `stream_gap` marker.
- [ ] **6. Off-network** — cellular, away from home.

---

## 7. Security notes for contributors

- **`POST /api` is remote code execution by design** — `tools.call` with `bash`
  is one request. Every control assumes that.
- **Never log or paste the token.** It grants shell access. It appears in the
  pair URL, the QR, and `~/.freecode/web-token`.
- **Rotate after any exposure** — including pasting a pair URL into an issue,
  a chat, or an AI assistant:

  ```bash
  rm ~/.freecode/web-token   # restart the daemon, re-pair
  ```

- **Keep the loopback default.** `127.0.0.1` stays the default bind; remote
  exposure requires an explicit `--host`.
- **Don't add a public-exposure path.** The spec rejects bare-token exposure to
  the internet (§6). If tunnelling is ever wanted, it needs a real auth layer
  in front, not just the token.

---

## 8. Known rough edges

- Pairing requires the MagicDNS hostname. A LAN-only mode and TLS with a pinned
  certificate would remove the cleartext carve-out entirely and let any address
  work; see the spec's open questions.
- One token per machine, not per device — revoking a lost phone logs out
  everything (§8 Q4).
- `PairingScreen`'s `QrScanner` calls `ProcessCameraProvider.getInstance().get()`
  on the main thread. It works, but it's a blocking call and an ANR risk.
- `apps/android` is not in the pnpm workspace; it builds independently via
  Gradle.
