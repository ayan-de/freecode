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
// Two channels, not one. On API 26+ a channel's importance is fixed at
// creation and `NotificationCompat.PRIORITY_HIGH` is ignored, so a
// single IMPORTANCE_LOW channel can never produce the heads-up alert
// the blocked state depends on. The ongoing FGS notification therefore
// stays on the low channel, and `blocked` additionally posts a separate
// high-importance alert (ALERT_NOTIF_ID) that is cancelled on resolve.
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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dev.freecode.remote.MainActivity
import dev.freecode.remote.R

enum class TurnState { Working, Blocked, Idle }

/** Watchdog window — twice the spec's 5-minute prompt timeout. */
private const val WATCHDOG_MS = 10 * 60 * 1000L

/** How often the watchdog re-checks. */
private const val WATCHDOG_TICK_MS = 30 * 1000L

private const val NOTIF_ID = 1
private const val ALERT_NOTIF_ID = 2

class TurnStateService : Service() {

    private var currentState: TurnState = TurnState.Idle
    private var contextInfo: String = ""
    private var lastEventAt: Long = SystemClock.elapsedRealtime()
    private var started = false

    private val handler = Handler(Looper.getMainLooper())
    private val watchdog = object : Runnable {
        override fun run() {
            val idleFor = SystemClock.elapsedRealtime() - lastEventAt
            if (idleFor >= WATCHDOG_MS) {
                Log.w(TAG, "watchdog fired after ${idleFor}ms — stopping")
                applyState(TurnState.Idle, "")
                return
            }
            handler.postDelayed(this, WATCHDOG_TICK_MS)
        }
    }

    private val notifications: NotificationManager
        get() = getSystemService(NOTIFICATION_SERVICE) as NotificationManager

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Every delivery must reach startForeground quickly — the system
        // gives us ~5s from startForegroundService() before it kills us
        // with a ForegroundServiceDidNotStartInTimeException, and that
        // applies even to a delivery we would otherwise ignore.
        ensureForeground()

        when (intent?.action) {
            ACTION_SET_STATE -> {
                val state = intent.getStringExtra(EXTRA_STATE)?.let { name ->
                    runCatching { TurnState.valueOf(name) }.getOrNull()
                }
                if (state != null) {
                    applyState(state, intent.getStringExtra(EXTRA_CONTEXT) ?: "")
                }
            }
            ACTION_TOUCH -> {
                // Any bridge call proves the WebView's JS is still alive.
                lastEventAt = SystemClock.elapsedRealtime()
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(watchdog)
        super.onDestroy()
    }

    /** Promote to foreground on the first delivery and start the watchdog. */
    private fun ensureForeground() {
        if (started) return
        started = true
        startForeground(NOTIF_ID, buildOngoing(TurnState.Working, ""))
        currentState = TurnState.Working
        lastEventAt = SystemClock.elapsedRealtime()
        handler.postDelayed(watchdog, WATCHDOG_TICK_MS)
    }

    private fun applyState(state: TurnState, info: String) {
        lastEventAt = SystemClock.elapsedRealtime()
        if (state == currentState && info == contextInfo) return
        val previous = currentState
        currentState = state
        contextInfo = info

        when (state) {
            TurnState.Idle -> {
                Log.d(TAG, "stopping service — turn idle")
                notifications.cancel(ALERT_NOTIF_ID)
                handler.removeCallbacks(watchdog)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            TurnState.Working -> {
                if (previous == TurnState.Blocked) {
                    // The prompt was answered — drop the escalation.
                    notifications.cancel(ALERT_NOTIF_ID)
                }
                notifications.notify(NOTIF_ID, buildOngoing(state, info))
            }
            TurnState.Blocked -> {
                notifications.notify(NOTIF_ID, buildOngoing(state, info))
                // The escalation: a separate high-importance notification
                // so it can actually heads-up over the lockscreen. This
                // is the thing standing between the user and a silent
                // 5-minute deny.
                notifications.notify(ALERT_NOTIF_ID, buildAlert(info))
            }
        }
    }

    /** The ongoing, quiet foreground-service notification. */
    private fun buildOngoing(state: TurnState, info: String): Notification {
        val title: String
        val text: String
        when (state) {
            TurnState.Blocked -> {
                title = getString(R.string.notif_blocked_title)
                text = getString(R.string.notif_blocked_text, info.ifBlank { "Freecode" })
            }
            else -> {
                title = getString(R.string.notif_working_title)
                text = getString(R.string.notif_working_text)
            }
        }
        return NotificationCompat.Builder(this, CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setContentIntent(contentIntent())
            .build()
    }

    /** The high-importance escalation shown only while blocked. */
    private fun buildAlert(info: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notif_blocked_title))
            .setContentText(
                getString(R.string.notif_blocked_text, info.ifBlank { "Freecode" }),
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(contentIntent())
            .build()
    }

    private fun contentIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0,
        Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun ensureChannels() {
        val mgr = notifications
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ONGOING,
                getString(R.string.notif_channel_session),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.notif_channel_session_desc)
                setShowBadge(false)
            },
        )
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ALERT,
                getString(R.string.notif_channel_approval),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = getString(R.string.notif_channel_approval_desc)
                enableVibration(true)
            },
        )
    }

    companion object {
        private const val TAG = "TurnStateService"
        private const val CHANNEL_ONGOING = "freecode-session"
        private const val CHANNEL_ALERT = "freecode-approval"

        const val ACTION_SET_STATE = "dev.freecode.remote.action.SET_STATE"
        const val ACTION_TOUCH = "dev.freecode.remote.action.TOUCH"
        const val EXTRA_STATE = "state"
        const val EXTRA_CONTEXT = "context"

        /**
         * SPA-facing API. Called by the JS bridge when the SPA reports a
         * turn state transition.
         *
         * Uses startForegroundService because the WebView often reports
         * a transition while the app is backgrounded (screen locked mid
         * turn), where a plain startService throws.
         */
        fun requestState(ctx: Context, state: TurnState, context: String = "") {
            val intent = Intent(ctx, TurnStateService::class.java).apply {
                action = ACTION_SET_STATE
                putExtra(EXTRA_STATE, state.name)
                putExtra(EXTRA_CONTEXT, context)
            }
            if (state == TurnState.Idle) {
                // Never *start* a service just to tell it to stop — that
                // would resurrect a dead service and immediately trip
                // the "did not start in time" watchdog.
                runCatching { ctx.startService(intent) }
                    .onFailure { Log.d(TAG, "idle delivery skipped: ${it.message}") }
                return
            }
            runCatching { ContextCompat.startForegroundService(ctx, intent) }
                .onFailure { Log.w(TAG, "could not start foreground service", it) }
        }

        /** Belt-and-braces timeout: kill the service if no event for 10min. */
        val watchdogMs: Long get() = WATCHDOG_MS
    }
}
