package com.shilapi.xcertplay

import android.Manifest
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.atomic.AtomicLong
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R

/** Owns foreground access for an explicit browser wait and the session that adopts it. */
class DiPlaySessionService : Service() {
    private val phoneBrowserLocks by lazy { PhoneBrowserLocks(this) }
    private var lifetime = Any()
    private var lifetimeId = lifetimes.incrementAndGet()
    private var foregroundTypes = 0
    private var preparationToken: Long? = null
    private var startedForPreparation = false
    private var stopping = false
    private val observedPreferences = mutableListOf<SharedPreferences>()
    private val preferenceListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        main.post { if (current === this && !stopping) reconcile(allowUpgrade = false) }
    }
    private val permissionCheck = Runnable {
        if (current === this && !stopping) reconcile(allowUpgrade = false)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        current = this
        for (name in listOf("xcertplay_airplay", "tiplay_carplay", "tiplay_browser_audio")) {
            getSharedPreferences(name, MODE_PRIVATE).also {
                it.registerOnSharedPreferenceChangeListener(preferenceListener)
                observedPreferences += it
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            if (intent.hasExtra(EXTRA_LIFETIME) &&
                intent.getLongExtra(EXTRA_LIFETIME, 0) != lifetimeId) {
                if (foregroundTypes == 0 && !CarPlayBackgroundSession.hasSession() &&
                    !SessionForegroundPreparation.hasPreparation()) {
                    stopping = true
                    stopSelfResult(startId)
                }
                return START_NOT_STICKY
            }
            SessionForegroundPreparation.cancel()
            phoneBrowserLocks.release()
            CarPlayBackgroundSession.stop()
            stopOwned()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_PREPARE &&
            SessionForegroundPreparation.snapshot()?.token != intent.getLongExtra(EXTRA_PREPARATION, 0)) {
            if (foregroundTypes == 0) { stopping = true; stopSelfResult(startId) }
            return START_NOT_STICKY
        }
        if (stopping) {
            // A new explicit start cannot reuse the acknowledged types of a retired lifetime.
            lifetime = Any()
            lifetimeId = lifetimes.incrementAndGet()
            foregroundTypes = 0
        }
        stopping = false
        if (intent?.action == ACTION_PREPARE) startedForPreparation = true
        reconcile(allowUpgrade = intent?.getBooleanExtra(EXTRA_VISIBLE, false) == true)
        return START_NOT_STICKY
    }

    private fun requestedTypes(): Int {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        val session = CarPlayBackgroundSession.snapshot()?.controller
        val phoneBrowser = AirPlayPersistence.isPhoneBrowserMode(this, session)
        if (Build.VERSION.SDK_INT >= 30 && microphonePermission() &&
            (if (phoneBrowser) !BrowserCarPlaySettings.disabled(this) && !BrowserCarPlayAudioSettings.disabled(this)
            else CarBluetoothAudio.effective(this, session) == CarBluetoothAudio.OFF)) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        val usesLocation = if (phoneBrowser) !com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(this)
            else AirPlayPersistence.loadLocationReportingEnabled(this)
        if (usesLocation && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        return types
    }

    private fun microphonePermission() =
        checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** Existing background events may remove access, but only a visible refresh can add types. */
    private fun reconcile(allowUpgrade: Boolean) {
        if (stopping) return
        main.removeCallbacks(permissionCheck)
        if (CarPlayBackgroundSession.hasSession()) {
            SessionForegroundPreparation.consume()
            preparationToken = null
        }
        val pending = SessionForegroundPreparation.snapshot()
        if (pending != null && !preparationWanted(this)) {
            // Preference/permission changes withdraw access without closing the settings screen.
            SessionForegroundPreparation.releaseToken(pending.token)
        }
        val preparation = SessionForegroundPreparation.snapshot()
        preparationToken = preparation?.token
        if (!CarPlayBackgroundSession.hasSession() && preparation == null &&
            (startedForPreparation || AirPlayPersistence.isPhoneBrowserMode(this))) {
            stopOwned()
            return
        }
        if (CarPlayBackgroundSession.hasSession()) {
            SessionForegroundPreparation.consume()
            preparationToken = null
        }
        val notification = notification(waiting = !CarPlayBackgroundSession.hasSession())
        if (Build.VERSION.SDK_INT >= 29) {
            val requested = requestedTypes()
            val types = if (foregroundTypes == 0 || allowUpgrade) requested else foregroundTypes and requested
            if (foregroundTypes != types) {
                val started = SessionForegroundStart.start(types,
                    permissionGranted = { type ->
                        checkSelfPermission(if (type == ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
                            Manifest.permission.RECORD_AUDIO else Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    },
                    start = { accepted ->
                        startForeground(1, notification, accepted)
                        foregroundTypes = accepted
                    },
                    log = DiagnosticLogs::append, debug = { RawTraffic.enabled },
                    processImportance = {
                        ActivityManager.RunningAppProcessInfo().also { ActivityManager.getMyMemoryState(it) }.importance
                    })
                if (!started) { stopOwned(); return }
            } else getSystemService(NotificationManager::class.java).notify(1, notification)
        } else if (foregroundTypes == 0) {
            startForeground(1, notification)
            foregroundTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else getSystemService(NotificationManager::class.java).notify(1, notification)
        HotspotExtraAddressSettings.sync(this)
        TeslaBrowserLink.sync(this)
        phoneBrowserLocks.update(TeslaBrowserLink.wanted(this))
        if (SessionForegroundPreparation.hasPreparation() ||
            foregroundTypes and ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE != 0) {
            main.postDelayed(permissionCheck, 1000)
        }
    }

    private fun notification(waiting: Boolean): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "CarPlay connection", NotificationManager.IMPORTANCE_LOW))
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, CarPlayHostActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1,
            Intent(this, DiPlaySessionService::class.java).setAction(ACTION_STOP)
                .setData(Uri.fromParts("tiplay-foreground", lifetimeId.toString(), null))
                .putExtra(EXTRA_LIFETIME, lifetimeId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return builder
            .setSmallIcon(R.drawable.ic_diplay_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(if (waiting) getString(R.string.settings_browser_waiting_connection) else "CarPlay connection running")
            .setContentIntent(open).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Disconnect", stop).build()).build()
    }

    private fun stopOwned() {
        stopping = true
        foregroundTypes = 0
        main.removeCallbacks(permissionCheck)
        phoneBrowserLocks.release()
        stopSelf()
    }

    override fun onDestroy() {
        observedPreferences.forEach { it.unregisterOnSharedPreferenceChangeListener(preferenceListener) }
        observedPreferences.clear()
        main.removeCallbacks(permissionCheck)
        if (current === this) {
            current = null
            preparationToken?.let(SessionForegroundPreparation::releaseToken)
            HotspotExtraAddressSettings.onSessionServiceStopped(this)
            TeslaBrowserLink.sync(this)
        }
        phoneBrowserLocks.release()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (current !== this) return
        // The launcher removes its empty task after handing over to the receiver host.
        if (rootIntent?.component?.className == FirstUseActivity::class.java.name) return
        SessionForegroundPreparation.cancel()
        phoneBrowserLocks.release()
        com.shilapi.xcertplay.hud.BydNavigationOutputs.endNow()
        CarPlayBackgroundSession.stop()
        stopOwned()
    }

    companion object {
        const val ACTION_STOP = "com.shihab.diplay.DISCONNECT"
        private const val ACTION_PREPARE = "com.ujzk.tiplay.PREPARE_FOREGROUND"
        private const val EXTRA_PREPARATION = "preparation"
        private const val EXTRA_VISIBLE = "visible"
        private const val EXTRA_LIFETIME = "foreground_lifetime"
        private const val CHANNEL = "diplay_connection"
        private val main = Handler(Looper.getMainLooper())
        private val lifetimes = AtomicLong()
        @Volatile private var current: DiPlaySessionService? = null

        private fun receiverWanted(context: Context): Boolean =
            AirPlayPersistence.isPhoneBrowserMode(context) &&
                !BrowserCarPlaySettings.disabled(context) &&
                TeslaBrowserLink.wanted(context) && TeslaBrowserLink.active

        private fun preparationWanted(context: Context): Boolean =
            receiverWanted(context) && !BrowserCarPlayAudioSettings.disabled(context) &&
                context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                !CarPlayBackgroundSession.hasSession()

        /** The real resumed receiving screen can prepare before any browser viewport/controller. */
        internal fun prepareForegroundAccess(activity: ComponentActivity, owner: SessionForegroundPreparationOwner,
                                             cancelled: (Long) -> Unit): Long? {
            check(Looper.myLooper() == Looper.getMainLooper())
            if (CarPlayBackgroundSession.hasSession()) { refreshForegroundAccess(activity); return null }
            if (owner.cancelled || !preparationWanted(activity)) {
                releasePreparation(activity, owner)
                return null
            }
            // A queued visible callback may arrive after pause. It cannot arm new access or
            // withdraw an already valid wait; finishing releases its lease via ViewModel.clear.
            if (!activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) ||
                activity.isFinishing || activity.isDestroyed) return null
            owner.attach(activity, cancelled)
            val lease = SessionForegroundPreparation.claim(owner, owner::cancel, renew = current?.stopping == true)
            val live = current?.takeUnless { it.stopping || it.foregroundTypes == 0 }
            if (live != null) {
                live.startedForPreparation = true
                live.reconcile(allowUpgrade = true)
            }
            else dispatch(activity, Intent(activity, DiPlaySessionService::class.java).setAction(ACTION_PREPARE)
                .putExtra(EXTRA_PREPARATION, lease.token).putExtra(EXTRA_VISIBLE, true))
            return lease.token
        }

        internal fun releasePreparation(context: Context, owner: Any) {
            val removed = SessionForegroundPreparation.release(owner) ?: return
            onMain {
                val live = current
                if (live?.preparationToken == removed.token) live.reconcile(allowUpgrade = false)
            }
        }

        /** Explicit receiver stop only cancels the pending purpose, never a different real session. */
        internal fun receiverStopped(cancelPreparation: Boolean = true) {
            val token = SessionForegroundPreparation.snapshot()?.token
            onMain {
                if (token != null) {
                    if (cancelPreparation) SessionForegroundPreparation.cancel(token)
                    else SessionForegroundPreparation.releaseToken(token)
                }
                if (!CarPlayBackgroundSession.hasSession()) current?.reconcile(allowUpgrade = false)
            }
        }

        /** The same foreground owner survives preparation -> a real stored session. */
        internal fun ensureForSession(context: Context) {
            check(Looper.myLooper() == Looper.getMainLooper())
            SessionForegroundPreparation.consume()
            val live = current?.takeUnless { it.stopping || it.foregroundTypes == 0 }
            if (live != null) live.reconcile(allowUpgrade = false)
            else dispatch(context, Intent(context, DiPlaySessionService::class.java))
        }

        internal fun ownerToken(): Any? = current?.lifetime

        /** A retired controller cannot stop a newer prepared/active foreground lifetime. */
        internal fun stopIfIdle(context: Context, expected: Any?) {
            if (expected == null) return
            onMain {
                val live = current
                if (live?.lifetime === expected && !CarPlayBackgroundSession.hasSession() &&
                    !SessionForegroundPreparation.hasPreparation()) live.stopOwned()
            }
        }

        /** Resumed app screens retry a prior denial; generic background sync does not call this. */
        fun refreshForegroundAccess(context: Context) {
            // ComponentActivity can still report STARTED inside its onResume callback.
            // Recheck once after lifecycle dispatch; never spin or manufacture visibility.
            if (context is ComponentActivity &&
                context.lifecycle.currentState == Lifecycle.State.STARTED) {
                main.post { refreshNow(context) }
            } else onMain { refreshNow(context) }
        }

        private fun refreshNow(context: Context) {
            if (!CarPlayBackgroundSession.hasSession() && !SessionForegroundPreparation.hasPreparation()) return
            val visible = context is ComponentActivity &&
                context.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) &&
                !context.isFinishing && !context.isDestroyed
            val live = current?.takeUnless { it.stopping || it.foregroundTypes == 0 }
            if (live != null) {
                onMain { if (current === live && !live.stopping) live.reconcile(allowUpgrade = visible) }
            } else if (visible || CarPlayBackgroundSession.hasSession()) {
                dispatch(context, Intent(context, DiPlaySessionService::class.java).putExtra(EXTRA_VISIBLE, visible))
            }
        }

        private fun dispatch(context: Context, intent: Intent) {
            try { ContextCompat.startForegroundService(context, intent) }
            catch (error: RuntimeException) {
                if (!SessionForegroundStart.backgroundStartRejected(error)) throw error
                DiagnosticLogs.append("session foreground stage=DISPATCH unavailable reason=BACKGROUND_START_REJECTED")
            }
        }

        private fun onMain(action: () -> Unit) {
            if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post(action)
        }
    }
}
