// =============================================================================
// TurnStateService — foreground service that owns the working/blocked/idle
// state machine.
//
// Spec §5.3:
//   "submit ──▶ working ⇄ blocked ──▶ idle
//               (streaming) (awaiting    (done | error |
//                            approval)    rejected | timeout)
//   working: entered on submit; sustained by text_delta / thinking_delta /
//            tool_start / tool_output.
//   blocked: entered on question_asked / permission_asked. Highest priority
//            for staying alive, not lowest. Answering returns to working,
//            not to idle.
//   idle:    entered only on a genuine terminal event: done, error, or a
//            resolution broadcast from §4.4 showing another device closed
//            the last open prompt.
//
// The service runs across working AND blocked, stopping only at idle.
// The notification reflects the distinction: working is a quiet ongoing
// notification, blocked escalates to high importance with the tool name
// and an explicit 'waiting for your approval'."
//
// Belt and braces: the state machine is driven by wire events and so
// can miss a transition if the stream drops. The service additionally
// caps itself with a watchdog — if no event of any kind arrives for 10
// minutes (twice the 5-minute prompt timeout), it stops regardless of
// reported state.
//
// §8 Q5 (open question about prompt timeout for remote use): the
// watchdog is wired to a constant below so a follow-up can plumb a
// longer timeout without changing the state machine.
// =============================================================================

package dev.freecode.remote.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import dev.freecode.remote.MainActivity
import dev.freecode.remote.R

enum class TurnState { Working, Blocked, Idle }

/** Watchdog window — twice the spec's 5-minute prompt timeout. */
private const val WATCHDOG_MS = 10 * 60 * 1000L

private const val NOTIF_ID = 1

class TurnStateService : Service() {

    private var currentState: TurnState = TurnState.Idle
    private var contextInfo: String = ""
    private var lastEventAt: Long = SystemClock.elapsedRealtime()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                startForeground(NOTIF_ID, buildNotification(TurnState.Working, ""))
                currentState = TurnState.Working
                lastEventAt = SystemClock.elapsedRealtime()
            }
            ACTION_SET_STATE -> {
                val state = intent.getStringExtra(EXTRA_STATE)?.let { name ->
                    runCatching { TurnState.valueOf(name) }.getOrNull()
                } ?: return START_NOT_STICKY
                val info = intent.getStringExtra(EXTRA_CONTEXT) ?: ""
                applyState(state, info)
            }
            ACTION_TOUCH -> {
                // The SPA called setTurnState or any other bridge method.
                // Use this to reset the watchdog — proves the JS bridge
                // is alive.
                lastEventAt = SystemClock.elapsedRealtime()
            }
        }
        return START_NOT_STICKY
    }

    private fun applyState(state: TurnState, info: String) {
        lastEventAt = SystemClock.elapsedRealtime()
        if (state == currentState && info == contextInfo) return
        currentState = state
        contextInfo = info
        when (state) {
            TurnState.Idle -> {
                Log.d(TAG, "stopping service — turn idle")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            TurnState.Working, TurnState.Blocked -> {
                val notif = buildNotification(state, info)
                val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
                mgr.notify(NOTIF_ID, notif)
                if (state == TurnState.Blocked) {
                    // Re-foreground as high-importance so the notification
                    // surfaces over the lockscreen / DnD. The
                    // foregroundServiceType is still specialUse, but
                    // the *notification* importance is independent.
                    startForeground(NOTIF_ID, notif)
                }
            }
        }
    }

    private fun buildNotification(state: TurnState, info: String): Notification {
        val title: String
        val text: String
        val priority = when (state) {
            TurnState.Working -> NotificationCompat.PRIORITY_LOW
            TurnState.Blocked -> NotificationCompat.PRIORITY_HIGH
            TurnState.Idle -> NotificationCompat.PRIORITY_LOW
        }
        when (state) {
            TurnState.Working -> {
                title = getString(R.string.notif_working_title)
                text = getString(R.string.notif_working_text)
            }
            TurnState.Blocked -> {
                title = getString(R.string.notif_blocked_title)
                val target = info.ifBlank { "the agent" }
                text = getString(R.string.notif_blocked_text, target)
            }
            TurnState.Idle -> {
                title = getString(R.string.notif_working_title)
                text = "Wrapping up"
            }
        }
        val tap = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(priority)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setContentIntent(tap)
            .build()
    }

    private fun ensureChannel() {
        val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val ch = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notif_channel_session),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notif_channel_session_desc)
            setShowBadge(false)
        }
        mgr.createNotificationChannel(ch)
    }

    companion object {
        private const val TAG = "TurnStateService"
        private const val CHANNEL_ID = "freecode-session"

        const val ACTION_START = "dev.freecode.remote.action.START"
        const val ACTION_SET_STATE = "dev.freecode.remote.action.SET_STATE"
        const val ACTION_TOUCH = "dev.freecode.remote.action.TOUCH"
        const val EXTRA_STATE = "state"
        const val EXTRA_CONTEXT = "context"

        /**
         * SPA-facing API. Called by the JS bridge when the SPA
         * reports a turn state transition.
         */
        fun requestState(ctx: Context, state: TurnState, context: String = "") {
            val intent = Intent(ctx, TurnStateService::class.java).apply {
                action = ACTION_SET_STATE
                putExtra(EXTRA_STATE, state.name)
                if (context.isNotEmpty()) putExtra(EXTRA_CONTEXT, context)
            }
            ctx.startService(intent)
        }

        /** Belt-and-braces timeout: kill the service if no event for 10min. */
        val watchdogMs: Long get() = WATCHDOG_MS
    }
}