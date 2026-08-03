// =============================================================================
// NetworkObserver — ConnectivityManager callback that pushes connection
// state changes into the WebView via evaluateJavascript.
//
// Spec §5.2: "native ConnectivityManager callback pushed into JS via
// evaluateJavascript, so the SPA can trigger an immediate reconnect
// instead of waiting for a TCP timeout. Cell-tower handover is the
// common case and TCP takes a long time to notice."
//
// The JS API is `window.__freecodeOnNetworkChanged(available)`. The
// SPA is expected to call `setTurnState` (the other half of the
// bridge) when something actually changes — this observer just nudges.
// =============================================================================

package dev.freecode.remote.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicReference

class NetworkObserver(
    private val context: Context,
    private val onChange: (available: Boolean) -> Unit,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val lastAvailability = AtomicReference<Boolean?>(null)
    private var listening: Job? = null

    fun start() {
        if (listening != null) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                emit(true)
            }
            override fun onLost(network: Network) {
                emit(false)
            }
            override fun onCapabilitiesChanged(
                network: Network,
                capabilities: NetworkCapabilities,
            ) {
                val hasInternet = capabilities.hasCapability(
                    NetworkCapabilities.NET_CAPABILITY_INTERNET,
                )
                emit(hasInternet)
            }
        }
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, callback)
        listening = scope.launch {
            // Provide an initial value so the SPA renders the right
            // banner state immediately.
            emit(currentlyOnline(cm))
        }
    }

    fun stop() {
        listening?.cancel()
        listening = null
    }

    private fun emit(available: Boolean) {
        if (lastAvailability.getAndSet(available) == available) return
        onChange(available)
    }

    private fun currentlyOnline(cm: ConnectivityManager): Boolean {
        val nw = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(nw) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}

/**
 * Helper to push a network state into the SPA via the standard
 * `__freecodeOnNetworkChanged` global. The SPA defines this globally
 * on load (or as a no-op until the bridge is ready) so the call is
 * always safe.
 */
fun WebView.notifyNetworkChanged(available: Boolean) {
    val js = "window.__freecodeOnNetworkChanged && window.__freecodeOnNetworkChanged($available);"
    post { evaluateJavascript(js, null) }
}