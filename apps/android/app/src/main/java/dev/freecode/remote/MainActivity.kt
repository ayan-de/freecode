// =============================================================================
// MainActivity — Compose root. Decides between PairingScreen,
// ConnectionScreen, and ChatScreen based on whether the vault holds
// credentials.
//
// The deep-link intent filter (freecode://) parses the pair URL and
// passes the result into PairingScreen via LaunchedEffect on the
// Intent.QR_DATA state, so a scan-or-deeplink pre-fills the form.
// =============================================================================

package dev.freecode.remote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color
import dev.freecode.remote.ui.ChatScreen
import dev.freecode.remote.ui.ConnectionScreen
import dev.freecode.remote.ui.PairingScreen
import dev.freecode.remote.vault.CredentialVault

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val vault = CredentialVault(applicationContext)
        setContent {
            MaterialTheme(colorScheme = darkScheme) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppRoot(vault = vault, intent = intent)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Re-trigger PairingScreen's deep-link handling if the user
        // re-scans a QR while the app is already open.
        setIntent(intent)
        setContent {
            MaterialTheme(colorScheme = darkScheme) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppRoot(vault = vault, intent = intent)
                }
            }
        }
    }
}

private val darkScheme = darkColorScheme(
    background = Color(0xFF0E0F12),
    surface = Color(0xFF121318),
    primary = Color(0xFFF5C71A),
    secondary = Color(0xFFC2990F),
)

@Composable
private fun AppRoot(vault: CredentialVault, intent: Intent?) {
    // Read the credentials once per activity lifetime. PairingScreen /
    // ChatScreen call back into the vault to clear or refresh on
    // re-pair.
    var saved by remember { mutableStateOf(vault.load()) }
    if (saved == null) {
        PairingScreen(
            initialPairUrl = intent?.dataString,
            onPaired = { creds ->
                vault.save(creds)
                saved = creds
            },
        )
        return
    }
    ChatScreen(creds = saved, onForget = {
        vault.clear()
        saved = null
    })
}