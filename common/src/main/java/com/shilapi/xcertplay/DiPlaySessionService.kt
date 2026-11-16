package com.shilapi.xcertplay

import android.Manifest
import android.app.Notification
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R

/** Keeps an explicitly started connection alive when another car app is in the foreground. */
class DiPlaySessionService : Service() {
    private val phoneBrowserLocks by lazy { PhoneBrowserLocks(this) }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            phoneBrowserLocks.release()
            CarPlayBackgroundSession.stop()
            stopSelf()
            return START_NOT_STICKY
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "CarPlay connection", NotificationManager.IMPORTANCE_LOW))
            Notification.Builder(this, CHANNEL)
        } else {
            // Android 7.x has no notification channels; the priority stands in for the channel importance.
            @Suppress("DEPRECATION")
            Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, CarPlayHostActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, DiPlaySessionService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = builder
            .setSmallIcon(R.drawable.ic_diplay_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("CarPlay connection running")
            .setContentIntent(open).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Disconnect", stop).build()).build()
        if (Build.VERSION.SDK_INT >= 29) {
            var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            // Arm microphone foreground access while the user starts the connection in the app.
            // Actual capture still opens only on CarPlay demand, using the car Bluetooth route.
            val session = CarPlayBackgroundSession.snapshot()?.controller
            val phoneBrowser = AirPlayPersistence.isPhoneBrowserMode(this, session)
            if (Build.VERSION.SDK_INT >= 30 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                (if (phoneBrowser) !BrowserCarPlayAudioSettings.disabled(this) else CarBluetoothAudio.effective(this, session) == CarBluetoothAudio.OFF)) {
                types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            // Without it Android stops location updates while another car app (the reversing camera,
            // the car's own map) covers CarPlay, and the iPhone gets no position until DiPlay is back.
            val usesLocation = if (phoneBrowser) !com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(this)
                else AirPlayPersistence.loadLocationReportingEnabled(this)
            if (usesLocation &&
                checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            }
            val started = SessionForegroundStart.start(types,
                permissionGranted = { type ->
                    checkSelfPermission(if (type == ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
                        Manifest.permission.RECORD_AUDIO else Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                },
                start = { acceptedTypes -> startForeground(1, notification, acceptedTypes) },
                log = DiagnosticLogs::append, debug = { RawTraffic.enabled },
                processImportance = {
                    ActivityManager.RunningAppProcessInfo().also { ActivityManager.getMyMemoryState(it) }.importance
                })
            if (!started) {
                phoneBrowserLocks.release()
                stopSelf()
                return START_NOT_STICKY
            }
        } else startForeground(1, notification)
        HotspotExtraAddressSettings.sync(this) // phone + browser mode: keep the car browser's hotspot address
        TeslaBrowserLink.sync(this)
        // Phone + browser mode: the car's browser keeps its video with the phone's screen off.
        phoneBrowserLocks.update(TeslaBrowserLink.wanted(this))
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        phoneBrowserLocks.release()
        HotspotExtraAddressSettings.onSessionServiceStopped(this) // keeps the address for the car's page
        TeslaBrowserLink.sync(this) // keeps the link for the car's page unless the run mode changed meanwhile
        super.onDestroy()
    }
    override fun onTaskRemoved(rootIntent: Intent?) {
        // The launcher removes its empty task after opening the separate CarPlay task.
        // That cleanup is not a request to disconnect the session owned by that task.
        if (rootIntent?.component?.className == FirstUseActivity::class.java.name) return
        phoneBrowserLocks.release()
        // BYD's recents force-stops the package ~10 ms after removing the task: end guidance first.
        com.shilapi.xcertplay.hud.BydNavigationOutputs.endNow()
        CarPlayBackgroundSession.stop()
        stopSelf()
    }
    companion object {
        const val ACTION_STOP = "com.shihab.diplay.DISCONNECT"
        private const val CHANNEL = "diplay_connection"

        /** Called from a resumed app screen to retry access after a background denial. */
        fun refreshForegroundAccess(context: android.content.Context) {
            if (!CarPlayBackgroundSession.hasSession()) return
            try {
                ContextCompat.startForegroundService(context, Intent(context, DiPlaySessionService::class.java))
            } catch (error: RuntimeException) {
                if (!SessionForegroundStart.backgroundStartRejected(error)) throw error
                DiagnosticLogs.append("session foreground stage=DISPATCH unavailable reason=BACKGROUND_START_REJECTED")
            }
        }
    }
}
