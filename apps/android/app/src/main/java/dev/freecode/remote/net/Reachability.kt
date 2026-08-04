// =============================================================================
// Reachability — pre-pair probe used by PairingScreen.
//
// Sends `providers.list` with the supplied bearer token. The result is
// bucketed into:
//   - Ok          — got a 200 with valid JSON
//   - Unauthorized — 401 (wrong token; user should re-check pairing URL)
//   - Unreachable — couldn't connect at all (wrong host / port / offline)
//   - Error       — anything else (server 500, malformed body, etc.)
//
// Splitting Unauthorized from Unreachable matters: a user typing in the
// wrong token by one character would otherwise get the same message as
// a totally down server.
// =============================================================================

package dev.freecode.remote.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Reachability {

    sealed class Result {
        data object Ok : Result()
        data object Unreachable : Result()
        data object Unauthorized : Result()
        data class Error(val message: String) : Result()
    }

    /**
     * Blocking HttpURLConnection work, so this must never run on the
     * caller's dispatcher: PairingScreen calls it from
     * rememberCoroutineScope(), which is Dispatchers.Main, and Android
     * throws NetworkOnMainThreadException there. `suspend` alone does
     * not move work off the calling thread — withContext does.
     */
    suspend fun probe(
        ctx: Context,
        host: String,
        port: Int,
        token: String,
    ): Result = withContext(Dispatchers.IO) {
        if (!isOnline(ctx)) return@withContext Result.Unreachable
        try {
            val url = URL("http://$host:$port/api")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 5_000
                readTimeout = 5_000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
            }
            try {
                val payload = JSONObject().apply {
                    put("jsonrpc", "2.0")
                    put("id", 1)
                    put("method", "providers.list")
                }.toString()
                conn.outputStream.use { it.write(payload.toByteArray()) }
                val code = conn.responseCode
                when (code) {
                    in 200..299 -> {
                        // The response body is non-trivial; an empty
                        // success is suspicious but not a fail.
                        Result.Ok
                    }
                    401, 403 -> Result.Unauthorized
                    else -> Result.Error("HTTP $code")
                }
            } finally {
                conn.disconnect()
            }
        } catch (e: java.net.ConnectException) {
            Result.Unreachable
        } catch (e: java.net.SocketTimeoutException) {
            Result.Unreachable
        } catch (e: java.net.UnknownHostException) {
            Result.Unreachable
        } catch (e: Exception) {
            Result.Error(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun isOnline(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val nw = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(nw) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}