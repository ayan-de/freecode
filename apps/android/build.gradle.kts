// =============================================================================
// Root build script.
//
// Plugins are declared with `apply false` so they're available to modules
// without being applied here. Versions are pinned in libs.versions.toml below.
// =============================================================================

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}