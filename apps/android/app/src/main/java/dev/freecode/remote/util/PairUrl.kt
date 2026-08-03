// =============================================================================
// PairUrl — parses freecode://<host>:<port>?token=<token>.
//
// Used by:
//  - PairingScreen, when a QR code is scanned or the activity is opened
//    via the deep-link intent filter
//  - the test suite, which constructs these URLs directly
//
// The parser is deliberately strict: any missing or unparseable part
// returns null rather than guessing. The pairing UI surfaces the error.
// =============================================================================

package dev.freecode.remote.util

import dev.freecode.remote.vault.Credentials

object PairUrl {

    /** Result of a successful parse. */
    data class Parsed(
        val host: String,
        val port: Int,
        val token: String,
    ) {
        fun toCredentials(): Credentials = Credentials(host, port, token)
    }

    /**
     * Parse `freecode://host:port?token=…`. Returns null if any
     * required field is missing or the URL is malformed.
     */
    fun parse(raw: String): Parsed? {
        val url = try {
            java.net.URI(raw)
        } catch (_: Exception) {
            return null
        }
        if (url.scheme != "freecode") return null
        val authority = url.authority ?: return null
        val (hostPart, portPart) = when {
            authority.contains(':') -> authority.split(':', limit = 2)
            else -> authority to null
        }
        if (hostPart.isBlank()) return null
        val port = portPart?.toIntOrNull() ?: return null
        if (port !in 1..65535) return null
        val token = url.rawQuery
            ?.split('&')
            ?.map { it.split('=', limit = 2) }
            ?.firstOrNull { it.size == 2 && it[0] == "token" }
            ?.get(1)
            ?.let { java.net.URLDecoder.decode(it, "UTF-8") }
            ?: return null
        if (token.isBlank()) return null
        return Parsed(hostPart.trim(), port, token)
    }
}