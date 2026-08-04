# Walkthrough - Rename App to "Freecode"

I have renamed the application from "FreeCode Remote" to "Freecode" and updated the UI terminology to remove "agent" references.

## Changes Made

### Resources
- **strings.xml**:
    - Renamed `app_name` to "Freecode".
    - Updated `pairing_title`, `chat_state_working`, `notif_channel_session`, `notif_channel_session_desc`, and `notif_working_title`.
    - Replaced "agent" with "Freecode" in all user-facing strings.

### Source Code
- **ChatScreen.kt**:
    - Updated `userAgentString` to use "Freecode/0.1".
    - Updated the connectivity banner to say "keep watching Freecode".
- **TurnStateService.kt**:
    - Updated default notification text to use "Freecode" instead of "the agent".

## Verification Results

### Automated Tests
- **Build**: `:app:assembleDebug` completed successfully.

### Manual Verification
- Verified all string replacements for consistency and correctness.
