# Rename App to "Freecode" and Clean Up Terminology

The user wants to rename the app to "Freecode" and remove "agent" as a suffix/label from the UI.

## Proposed Changes

### Resources

#### [MODIFY] [strings.xml](file:///home/ayan-de/Projects/freecode/apps/android/app/src/main/res/values/strings.xml)
- Change `app_name` from "FreeCode Remote" to "Freecode".
- Update `pairing_title` from "Pair with FreeCode" to "Pair with Freecode".
- Change `chat_state_working` from "Agent is working" to "Freecode is working".
- Update `notif_channel_session_desc` from "Keeps the agent connected..." to "Keeps Freecode connected...".
- Update `notif_working_title` from "FreeCode is working" to "Freecode is working".

### Source Code

#### [MODIFY] [ChatScreen.kt](file:///home/ayan-de/Projects/freecode/apps/android/app/src/main/java/dev/freecode/remote/ui/ChatScreen.kt)
- Update `userAgentString` from "FreeCodeRemote/0.1" to "Freecode/0.1".
- Update the connectivity banner message from "watching the agent" to "watching Freecode".

#### [MODIFY] [TurnStateService.kt](file:///home/ayan-de/Projects/freecode/apps/android/app/src/main/java/dev/freecode/remote/service/TurnStateService.kt)
- Update default `target` from "the agent" to "Freecode".

## Verification Plan

### Manual Verification
- Verify the app name in the launcher (once deployed).
- Verify the strings in the pairing and chat screens.
- Verify the notification text.
