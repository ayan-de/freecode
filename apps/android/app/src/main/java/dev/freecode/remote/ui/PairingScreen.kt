// =============================================================================
// PairingScreen — first-launch (and re-pair) UI.
//
// Spec §5.1:
//   "CameraX + ML Kit barcode scan of the terminal QR, or manual
//    host/port/token entry. Validates by calling providers.list before
//    saving."
//
// The CameraX + ML Kit path uses the camera permission flow on Android
// 13+. If the user denies, the manual form below is still available —
// they can paste a freecode:// URL or type the three fields.
//
// On a successful providers.list ping, we hand the credentials back to
// the activity which writes them to the vault and switches to the
// ChatScreen.
// =============================================================================

package dev.freecode.remote.ui

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import dev.freecode.remote.R
import dev.freecode.remote.net.Reachability
import dev.freecode.remote.util.PairUrl
import dev.freecode.remote.vault.Credentials
import kotlinx.coroutines.launch

@Composable
fun PairingScreen(
    initialPairUrl: String?,
    onPaired: (Credentials) -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    var host by remember { mutableStateOf("") }
    var portText by remember { mutableStateOf("4096") }
    var token by remember { mutableStateOf("") }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED,
        )
    }

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasCameraPermission = granted
    }

    // Pre-fill from a deep-linked freecode:// URL (QR scan result
    // that opened the app from the camera, or a tapped link).
    LaunchedEffect(initialPairUrl) {
        val parsed = initialPairUrl?.let { PairUrl.parse(it) }
        if (parsed != null) {
            host = parsed.host
            portText = parsed.port.toString()
            token = parsed.token
            statusMessage = "Pairing URL detected — review and tap Connect."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(R.string.pairing_title),
            style = MaterialTheme.typography.headlineMedium,
        )

        // ----- QR scan via CameraX + ML Kit ----------------------
        if (hasCameraPermission) {
            QrScanner(
                onScanned = { raw ->
                    val parsed = PairUrl.parse(raw)
                    if (parsed == null) {
                        statusMessage = "QR is not a freecode:// URL."
                        return@QrScanner
                    }
                    host = parsed.host
                    portText = parsed.port.toString()
                    token = parsed.token
                    statusMessage = "Scanned. Review and tap Connect."
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .background(MaterialTheme.colorScheme.surface),
            )
        } else {
            Text(text = stringResource(R.string.pairing_camera_permission))
            Button(onClick = {
                cameraLauncher.launch(Manifest.permission.CAMERA)
            }) {
                Text(stringResource(R.string.pairing_grant_camera))
            }
        }

        HorizontalDivider()

        Text(
            text = stringResource(R.string.pairing_manual),
            style = MaterialTheme.typography.titleSmall,
        )

        OutlinedTextField(
            value = host,
            onValueChange = { host = it },
            label = { Text(stringResource(R.string.pairing_host)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = portText,
            onValueChange = { portText = it.filter(Char::isDigit).take(5) },
            label = { Text(stringResource(R.string.pairing_port)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = token,
            onValueChange = { token = it.trim() },
            label = { Text(stringResource(R.string.pairing_token)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        statusMessage?.let {
            Text(text = it, color = MaterialTheme.colorScheme.error)
        }

        Spacer(Modifier.height(4.dp))

        Button(
            onClick = {
                val port = portText.toIntOrNull()
                if (host.isBlank() || port == null || token.isBlank()) {
                    statusMessage = "All fields are required."
                    return@Button
                }
                statusMessage = null
                // Validate by calling providers.list. The reachability
                // probe uses the bearer token we just collected so a
                // 401 lands as a credential error rather than a connect
                // error.
                scope.launch {
                    val result = Reachability.probe(ctx, host, port, token)
                    when (result) {
                        is Reachability.Result.Ok -> {
                            onPaired(Credentials(host, port, token))
                        }
                        is Reachability.Result.Unreachable -> {
                            statusMessage = "Couldn't reach the daemon. Check the host / port."
                        }
                        is Reachability.Result.Unauthorized -> {
                            statusMessage = "Daemon rejected the token."
                        }
                        is Reachability.Result.Error -> {
                            statusMessage = result.message
                        }
                    }
                }
            },
            enabled = host.isNotBlank() && token.isNotBlank() && portText.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.pairing_connect))
        }
    }
}

@Composable
private fun QrScanner(
    onScanned: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val ctx = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(ctx) }

    Box(modifier = modifier) {
        AndroidView(
            factory = { previewView },
            modifier = Modifier.fillMaxSize(),
        )
    }

    LaunchedEffect(Unit) {
        val cameraProvider = ProcessCameraProvider.getInstance(ctx).get()
        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
        }
        val barcodeScanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
        val analysis = ImageAnalysis.Builder()
            .build()
            .also { ia ->
                ia.setAnalyzer(
                    ContextCompat.getMainExecutor(ctx),
                ) { proxy ->
                    @ExperimentalGetImage
                    val media = proxy.image
                    if (media == null) {
                        proxy.close()
                        return@setAnalyzer
                    }
                    val input = InputImage.fromMediaImage(
                        media, proxy.imageInfo.rotationDegrees,
                    )
                    barcodeScanner.process(input)
                        .addOnSuccessListener { barcodes ->
                            val raw = barcodes.firstOrNull()?.rawValue
                            if (raw != null) onScanned(raw)
                        }
                        .addOnFailureListener { e -> Log.w("QrScanner", "scan failed", e) }
                        .addOnCompleteListener { proxy.close() }
                }
            }
        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
            analysis,
        )
    }
}