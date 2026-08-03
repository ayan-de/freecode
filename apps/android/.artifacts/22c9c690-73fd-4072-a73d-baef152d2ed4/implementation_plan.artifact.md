# Migrate to AGP Built-in Kotlin

The project is using Android Gradle Plugin (AGP) 9.1.0, which introduces and enables built-in Kotlin support by default. The current build failure is caused by a conflict between the manually applied `org.jetbrains.kotlin.android` plugin and the new built-in Kotlin support in AGP 9.

## Proposed Changes

### Build Configuration

#### [MODIFY] [libs.versions.toml](file:///home/ayan-de/Projects/freecode/apps/android/gradle/libs.versions.toml)
- Remove `kotlin-android` from the `[plugins]` section as it's no longer required.

#### [MODIFY] [build.gradle.kts](file:///home/ayan-de/Projects/freecode/apps/android/build.gradle.kts) (root)
- Remove `alias(libs.plugins.kotlin.android) apply false` from the `plugins` block.

#### [MODIFY] [app/build.gradle.kts](file:///home/ayan-de/Projects/freecode/apps/android/app/build.gradle.kts)
- Remove `alias(libs.plugins.kotlin.android)` from the `plugins` block.
- Remove the `kotlinOptions` block inside `android { ... }` as it's redundant with `compileOptions` in AGP 9 built-in Kotlin.
- Ensure `alias(libs.plugins.kotlin.compose)` remains if it's compatible with built-in Kotlin (to be verified during execution).

## Verification Plan

### Automated Tests
- Run `gradle sync` to ensure the project configuration is valid.
- Run `./gradlew :app:assembleDebug` to verify that Kotlin compilation and Compose compiler are working correctly.

### Manual Verification
- Check for any Lint or IDE errors in Kotlin files.
