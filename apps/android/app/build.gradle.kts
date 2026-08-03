// =============================================================================
// :app module — Compose shell + WebView + foreground service.
//
// minSdk 26 matches the spec. compileSdk 35 tracks the current stable
// Android API. targetSdk 35 is the Google Play requirement as of late 2024.
// =============================================================================

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.freecode.remote"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.freecode.remote"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    // The Android Gradle plugin mounts the resources from the spec's
    // network_security_config.xml as an explicit reference, so the
    // manifest entry can point at @xml/network_security_config.
}

dependencies {
    // Core + lifecycle
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    // Compose
    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    // Navigation between the three Compose screens (pairing → connection → chat)
    implementation(libs.navigation.compose)

    // CameraX + ML Kit barcode scan (PairingScreen)
    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.mlkit.barcode.scanning)

    // EncryptedSharedPreferences for the token vault
    implementation(libs.security.crypto)

    // Coroutines for the network observer + foreground service lifecycle
    implementation(libs.kotlinx.coroutines.android)
}