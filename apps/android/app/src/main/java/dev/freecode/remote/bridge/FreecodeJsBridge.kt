// =============================================================================
// FreecodeJsBridge — the native↔WebView bridge.
//
// Spec §5.2 keeps it deliberately narrow: exactly three surfaces.
//
// 1. @JavascriptInterface fun getCredentials(): String
//    Returns `{baseUrl, token}` JSON. The token reaches the SPA this way
//    rather than via the URL so it stays out of the WebView's history
//    and any Referer header.
//
// 2. fun onNetworkChanged(available: Boolean)  (called via the public
//    notifyNetworkChanged() helper, NOT a @JavascriptInterface).
//    Pushed in via evaluateJavascript so the SPA can trigger an
//    immediate reconnect on cell-tower handover without waiting for a
//    TCP timeout.
//
// 3. @JavascriptInterface fun setTurnState(state: String)
//    JS reports one of working / blocked / idle. Used by the §5.3
//    foreground service state machine.
//
// Anything else — all RPC, all rendering — stays in the WebView.
// =============================================================================

package dev.freecode.remote.bridge

import android.webkit.JavascriptInterface
import android.webkit.WebView
import dev.freecode.remote.service.TurnState
import dev.freecode.remote.service.TurnStateService
import dev.freecode.remote.vault.Credentials
import org.json.JSONObject

/**
 * The JavascriptInterface object attached to the WebView with
 * `addJavascriptInterface(this, "FreecodeBridge")`. The SPA calls
 * `window.FreecodeBridge.getCredentials()` and
 * `window.FreecodeBridge.setTurnState(state)`.
 */
class FreecodeJsBridge(
    private val credentials: Credentials,
) {

    /** Return the credentials as JSON. Token is the bearer header value. */
    @JavascriptInterface
    fun getCredentials(): String {
        return JSONObject().apply {
            put("baseUrl", credentials.baseUrl)
            put("token", credentials.token)
        }.toString()
    }

    /**
     * SPA reports the current turn state. Forwards to the foreground
     * service which updates the notification and decides whether to
     * keep the service alive.
     */
    @JavascriptInterface
    fun setTurnState(state: String) {
        val parsed = when (state.lowercase()) {
            "working" -> TurnState.Working
            "blocked" -> TurnState.Blocked
            "idle" -> TurnState.Idle
            else -> return // ignore unknowns; the SPA may add new states
        }
        TurnStateService.requestState(parsed)
    }
}