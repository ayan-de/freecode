// =============================================================================
// CredentialVault — EncryptedSharedPreferences wrapper for the
// host/port/token triple that pairs this device with the daemon.
//
// Spec §5.1: "Token stored via EncryptedSharedPreferences (Jetpack
// Security), not plain prefs — a rooted or backed-up device otherwise
// leaks a credential that grants shell access to the developer's
// machine."
//
// `MasterKey` uses the Android keystore by default, so the AES key
// wrapping the prefs file lives in hardware-backed storage on devices
// that have it. The keystore is unavailable on rare emulators / weird
// states; we let the IOException bubble to the caller (PairingScreen)
// and surface a clear "your keystore is unavailable" message rather
// than swallowing it.
// =============================================================================

package dev.freecode.remote.vault

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class Credentials(
    val host: String,
    val port: Int,
    val token: String,
) {
    val baseUrl: String get() = "http://$host:$port"
}

/** Read, write, and clear the device's paired credentials. */
class CredentialVault(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun load(): Credentials? {
        val host = prefs.getString(KEY_HOST, null) ?: return null
        val port = prefs.getInt(KEY_PORT, -1).takeIf { it > 0 } ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        return Credentials(host, port, token)
    }

    fun save(creds: Credentials) {
        prefs.edit()
            .putString(KEY_HOST, creds.host)
            .putInt(KEY_PORT, creds.port)
            .putString(KEY_TOKEN, creds.token)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val FILE_NAME = "freecode-credentials"
        const val KEY_HOST = "host"
        const val KEY_PORT = "port"
        const val KEY_TOKEN = "token"
    }
}