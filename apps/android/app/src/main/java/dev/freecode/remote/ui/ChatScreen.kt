// =============================================================================
// ChatScreen — the entire user-visible surface post-pairing.
//
// Hosts a full-bleed WebView running the existing apps/web-app SPA. The
// SPA already does everything (rendering, JSON-RPC, SSE, approval
// modals) — the only native responsibilities are:
//
//   1. Tell the SPA what the bearer token is, via the JS bridge
//      (FreecodeBridge.getCredentials), so the token never appears in
//      the URL or Referer header.
//   2. Listen for ConnectivityManager changes and push them into the
//      SPA so cell-tower handovers don't wait for a TCP timeout.
//   3. Receive setTurnState calls from the SPA so the foreground
//      service can update its notification / shut down.
//
// WebView config (§5.4):
//   - JS enabled, DOM storage enabled
//   - file access disabled, allowContentAccess disabled
//   - setWebContentsDebuggingEnabled in debug builds only
//   - cleartext scoped via network_security_config.xml (the .ts.net
//     domain-config covers the typical tailnet bind)
//
// ConnectionScreen (§5.1) is folded into the connectivity banner here:
//   - when the WebView fails to load OR
//   - when NetworkObserver reports no internet,
// a banner appears with a re-pair action. This is simpler than a
// dedicated screen and lets the user clear the error without leaving
// the WebView's history.
// =============================================================================

package dev.freecode.remote.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import dev.freecode.remote.bridge.FreecodeJsBridge
import dev.freecode.remote.net.NetworkObserver
import dev.freecode.remote.net.notifyNetworkChanged
import dev.freecode.remote.service.TurnState
import dev.freecode.remote.service.TurnStateService
import dev.freecode.remote.vault.Credentials

private const val TAG = "ChatScreen"

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ChatScreen(
    creds: Credentials,
    onForget: () -> Unit,
) {
    val ctx = LocalContext.current
    val webView = remember { WebView(ctx) }
    var isOnline by remember { mutableStateOf(true) }
    var lastError by remember { mutableStateOf<String?>(null) }

    // API 33+ gates notifications behind a runtime grant. Without it the
    // blocked-state escalation never reaches the user and a tool call
    // is silently denied when the prompt times out, so ask on first entry.
    val notifPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* Denial is survivable — the WebView still works in-app. */ }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    // Wire up the bridge once per credential change. The bridge holds
    // the credentials in memory; the WebView is responsible for using
    // them via FreecodeBridge.getCredentials().
    val bridge = remember(creds) { FreecodeJsBridge(ctx.applicationContext, creds) }

    // Network observer — pushes ConnectivityManager changes into the
    // SPA via __freecodeOnNetworkChanged.
    val networkObserver = remember(ctx) {
        NetworkObserver(ctx) { available ->
            isOnline = available
            webView.notifyNetworkChanged(available)
        }
    }

    DisposableEffect(webView) {
        networkObserver.start()
        onDispose { networkObserver.stop() }
    }

    DisposableEffect(creds, webView) {
        // Apply the WebView config once per credential set.
        webView.apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = true
            // Token goes through the bridge, not the URL.
            settings.saveFormData = false
            settings.userAgentString = "${settings.userAgentString} Freecode/0.1"
            addJavascriptInterface(bridge, "FreecodeBridge")

            // Give the WebView its own opaque background instead of
            // relying on a Compose layer behind it. Some devices will
            // not composite a WebView left transparent, and this also
            // removes the white flash the Compose background existed
            // to hide. Pure black is deliberate: it is distinguishable
            // from the Material Surface colour (#121318) behind it, so
            // a screenshot says which layer actually painted.
            setBackgroundColor(android.graphics.Color.BLACK)

            // §5.4: remote debugging in debug builds only. Read the
            // debuggable flag off applicationInfo rather than
            // BuildConfig, which AGP 8 only generates when explicitly
            // opted into via buildFeatures.
            val debuggable =
                (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
            if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

            // Without a WebChromeClient a JS exception is indis-
            // tinguishable from a working page: the WebView just shows
            // blank and says nothing. Surface console output so a blank
            // screen is diagnosable from logcat.
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                    Log.d(
                        TAG,
                        "console[${msg.messageLevel()}] ${msg.message()}" +
                            " @ ${msg.sourceId()}:${msg.lineNumber()}",
                    )
                    return true
                }
            }

            // The service is NOT started here. Attaching the WebView
            // means the user is looking at the app, not that a turn is
            // running; starting it now would hold a foreground service
            // (and its notification) through every idle minute and let
            // the watchdog reap it before the first real prompt. The
            // SPA starts it on submit via setTurnState (spec §5.3).

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                    Log.d(TAG, "load start: $url")
                    lastError = null
                }

                override fun onPageFinished(view: WebView, url: String) {
                    Log.d(TAG, "load finish: $url")
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    Log.w(
                        TAG,
                        "load error ${error.errorCode} ${error.description}" +
                            " for ${request.url} (main=${request.isForMainFrame})",
                    )
                    // Only a main-frame failure means the page is dead. A
                    // failed subresource must not replace a working UI
                    // with an error banner.
                    if (request.isForMainFrame) {
                        lastError = "WebView error: ${error.description}"
                    }
                }

                override fun onReceivedHttpError(
                    view: WebView,
                    request: WebResourceRequest,
                    errorResponse: android.webkit.WebResourceResponse,
                ) {
                    // A 401 on the document or its assets renders blank
                    // with no network-level error at all, so log it
                    // separately from onReceivedError.
                    Log.w(
                        TAG,
                        "http ${errorResponse.statusCode} for ${request.url}" +
                            " (main=${request.isForMainFrame})",
                    )
                    if (request.isForMainFrame) {
                        lastError = "Daemon returned HTTP ${errorResponse.statusCode}"
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    // Allow same-origin (the daemon) but route anything
                    // else to the system browser. The SPA doesn't link
                    // out, but this is a defense-in-depth default.
                    val uri = request.url
                    val host = uri.host ?: return false
                    val daemon = Uri.parse(creds.baseUrl).host
                    return if (host != daemon) {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } else {
                        false
                    }
                }
            }
            // Initial load — token is fetched by the SPA via the bridge.
            loadUrl(creds.baseUrl)
        }

        onDispose {
            webView.stopLoading()
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
            // Tear down the foreground service — the SPA is gone.
            TurnStateService.requestState(ctx, TurnState.Idle, "")
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Connectivity banner — visible only when the network is down
        // or the WebView reported a load error.
        if (!isOnline || lastError != null) {
            ConnectivityBanner(
                message = lastError
                    ?: "No network. Reconnect to keep watching Freecode.",
                onRepair = onForget,
            )
        }
        // No background modifier here. An opaque Compose layer in this
        // position is a candidate for hiding the WebView entirely, and
        // the WebView paints its own background anyway (set below), so
        // the modifier bought nothing but risk.
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { webView },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun ConnectivityBanner(message: String, onRepair: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(PaddingValues(horizontal = 16.dp, vertical = 12.dp)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = message,
            modifier = Modifier.padding(end = 16.dp),
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
        Button(onClick = onRepair) {
            Text("Re-pair")
        }
    }
}