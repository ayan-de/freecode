# FreeCode Remote (Android)

Native Android client for [FreeCode](https://github.com/ayan-de/freecode)'s
remote feature (see
`../../docs/superpowers/specs/2026-08-04-android-remote-client.md`).

This is a thin Compose shell that:

1. **Pairs** with the desktop daemon via QR scan or manual host/port/token
   entry.
2. **Stores credentials** in `EncryptedSharedPreferences` (Jetpack Security).
3. **Hosts the web-app** (`apps/web-app`) inside a `WebView` so all rendering
   and protocol logic stays in the SPA the desktop TUI / VS Code / Web
   frontends already use.
4. **Runs a foreground service** while the agent is `working` or `blocked`
   on an approval, so the screen-off case doesn't lose the answer window.

It is **not** part of the pnpm workspace — it builds independently via Gradle.
The only tie to the monorepo is the path the WebView loads (`http://host:port/`)
and this README.

## Layout

```
apps/android/
├── settings.gradle.kts            # :app module
├── build.gradle.kts               # root: plugin versions
├── gradle.properties              # JVM args, AndroidX flags
└── app/
    ├── build.gradle.kts           # :app deps + Compose + SDK targets
    ├── src/main/AndroidManifest.xml
    └── src/main/
        ├── java/dev/freecode/remote/
        │   ├── MainActivity.kt           # Compose root + nav
        │   ├── ui/
        │   │   ├── PairingScreen.kt      # QR + manual entry
        │   │   ├── ConnectionScreen.kt   # reachability + re-pair
        │   │   └── ChatScreen.kt         # WebView host
        │   ├── bridge/
        │   │   └── FreecodeJsBridge.kt   # @JavascriptInterface surfaces
        │   ├── vault/
        │   │   └── CredentialVault.kt    # EncryptedSharedPreferences
        │   ├── service/
        │   │   └── TurnStateService.kt   # working/blocked/idle FSM
        │   ├── net/
        │   │   └── NetworkObserver.kt    # ConnectivityManager → JS
        │   └── util/
        │       └── PairUrl.kt            # freecode://<host>:<port>?token=…
        └── res/
            ├── values/{strings,themes,colors}.xml
            ├── xml/network_security_config.xml   # §5.4
            └── drawable/ic_notification.xml      # foreground notif icon
```

## Build

```
cd apps/android
./gradlew assembleDebug
```

Produces `app/build/outputs/apk/debug/app-debug.apk`. Install on a device or
emulator with API 26+.

## Verify (spec §7)

> Lock the phone, trigger a permission prompt, and confirm the escalated
> notification arrives and is answerable well inside the 5-minute deny
> deadline.

Run the desktop daemon (`freecode web --host 100.64.0.x --port 4096`), open
the app on a paired device, send a prompt that needs a tool permission,
lock the phone. The blocked-state notification should escalate to high
importance with the tool name and an explicit "waiting for your approval"
copy (see §5.3 — a hard deadline, not an FYI). Tap it; the WebView comes
to the front with the modal already open.

## Note on §8 Q5

The 5-minute prompt timeout the watchdog derives from is the desktop default.
The spec notes remote use adds notification + phone-unlock latency; the
open question is whether to raise this when a remote subscriber is attached.
v1 uses the desktop default unchanged. The `TurnStateService` watchdog is
parameterised so a follow-up can plumb a longer timeout without changes
elsewhere — see the comment in `TurnStateService.kt`.