package com.shilapi.xcertplay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.Log
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.receiver.ReceiverBonjour
import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverServer
import com.shilapi.xcertplay.receiver.ReceiverMirrorAudioFormat
import com.shilapi.xcertplay.web.WebMediaSink
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** The default AirPlay receiver; CarPlay retains its controller while AirPlay borrows the canvas. */
class AirPlayReceiverService : Service() {
    private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "tiplay-airplay-service").apply { isDaemon = true } }
    private val locks by lazy { PhoneBrowserLocks(this) }
    private var multicast: WifiManager.MulticastLock? = null
    @Volatile private var server: ReceiverServer? = null // worker creates/closes; callbacks may read
    private var settingsSubscription: AutoCloseable? = null
    private lateinit var player: AirPlayCastPlayer
    private val playbackDiagnostics = AirPlayVideoDiagnostics(::logDiagnostic)
    private val displayLock = Any()
    private var displayGeneration = 0L // guarded by displayLock
    @Volatile private var mirrorOutput: WebMediaSink? = null
    private var mirrorAudio: AirPlayMirrorAudio? = null
    private var discovery: ReceiverBonjour? = null // worker only
    @Volatile private var destroyed = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settingsSubscription = BrowserSettingsChanges.listen(this) {
            worker.execute {
                if (!destroyed) server?.let { receiver ->
                    receiver.updateDisplay(AirPlayPersistence.loadFps(this), AirPlayPersistence.loadHevcEnabled(this))
                    refreshDiscovery()
                }
            }
        }
        player = AirPlayCastPlayer({ url -> server?.loadResource(url) }) { state ->
            val epoch = player.playbackEpoch
            playbackDiagnostics.callback(state, epoch)
            val ended = state in listOf("failed", "stopped")
            if (!destroyed && ended) TeslaBrowserLink.resumeCarPlayDisplay()
            if (!destroyed) worker.execute {
                if (!destroyed && player.playbackEpoch == epoch) {
                    // UxPlay reports ongoing video state through /playback-info. Reserve reverse
                    // HTTP for FCUP instead of interleaving unsolicited playback state requests.
                    if (ended) {
                        server?.finishPlayback(if (state == "failed") ReceiverServer.PlaybackFinishReason.BROWSER_FAILED
                            else ReceiverServer.PlaybackFinishReason.BROWSER_ENDED)
                        if (state == "failed") publish("playback-failed")
                    }
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (AirPlayReceiverSettings.isDisabled(this)) { stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "AirPlay", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 10, CarPlaySettingsNavigation.mainIntent(this), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_diplay_notification)
            .setContentTitle(getString(R.string.settings_airplay_title))
            .setContentText(getString(R.string.settings_airplay_listening))
            .setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(10, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else startForeground(10, notification)
        if (LocalNetworkPermission.state(this) == LocalNetworkPermission.State.DENIED) { publish("permission"); stopSelf(); return START_NOT_STICKY }
        TeslaBrowserLink.start(this)
        HotspotExtraAddressSettings.sync(this)
        locks.hold()
        if (multicast == null) multicast = getSystemService(WifiManager::class.java)?.createMulticastLock("tiplay-airplay")?.apply { setReferenceCounted(false); acquire() }
        worker.execute {
            if (destroyed || server != null) return@execute
            if (AirPlayReceiverSettings.isDisabled(this)) { stopSelf(); return@execute }
            try {
                val receiverConfig = identity()
                val receiver = ReceiverServer(receiverConfig, object : ReceiverServer.Listener {
                    override fun log(message: String) = logDiagnostic(message)
                    override fun mirrorSink(): WebMediaSink = synchronized(displayLock) {
                        check(!destroyed && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService))
                        displayGeneration++
                        mirrorAudio?.close(); mirrorAudio = null
                        TeslaBrowserLink.pauseCarPlayDisplay()
                        val display = server?.displayConfig ?: receiverConfig
                        WebMediaSink(TeslaBrowserLink.hub, display.width, display.height, display.fps,
                            com.shilapi.xcertplay.web.BrowserDisplaySource.AIRPLAY).also {
                            mirrorOutput = it
                            // Reserve ordinary AirPlay priority at SETUP, before its first CONFIG.
                            it.onScreenStreamActive(110, true)
                        }
                    }
                    override fun play(item: ReceiverPlay) {
                        synchronized(displayLock) {
                            if (!destroyed && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService)) {
                                displayGeneration++
                                TeslaBrowserLink.pauseCarPlayDisplay(); player.play(item)
                            }
                        }
                    }
                    override fun stopPlayback() {
                        val stoppedGeneration = synchronized(displayLock) { displayGeneration }
                        player.stop {
                            synchronized(displayLock) {
                                // Playback cleanup runs on main. Restore only after its sink releases
                                // the canvas, and never undo a newer AirPlay session's display pause.
                                if (!destroyed && displayGeneration == stoppedGeneration) {
                                    TeslaBrowserLink.resumeCarPlayDisplay()
                                }
                            }
                        }
                    }
                    override fun mirrorAudioTimed(format: ReceiverMirrorAudioFormat, payload: ByteArray, sample: Long, presentationNanos: Long?) {
                        synchronized(displayLock) {
                            if (!destroyed && mirrorOutput != null && format.sampleRate == 44100 && format.channels == 2) {
                                val soundtrack = mirrorAudio ?: AirPlayMirrorAudio(format, TeslaBrowserLink.audioHub).also { mirrorAudio = it }
                                soundtrack.offer(payload, sample, presentationNanos)
                            }
                        }
                    }
                    override fun stopMirrorAudio() {
                        synchronized(displayLock) { mirrorAudio?.close(); mirrorAudio = null }
                    }
                    override fun photo(bytes: ByteArray) {
                        synchronized(displayLock) {
                            if (!destroyed && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService)) {
                                displayGeneration++
                                TeslaBrowserLink.pauseCarPlayDisplay(); player.photo(bytes)
                            }
                        }
                    }
                    override fun seek(seconds: Double) { player.seek(seconds) }
                    override fun rate(value: Double) { player.rate(value) }
                    override fun playback() = player.state
                    override fun status(state: String) {
                        if (destroyed) return
                        if (state == "listening") {
                            synchronized(displayLock) {
                                mirrorAudio?.close(); mirrorAudio = null; mirrorOutput = null
                                // Release and restore in one transition. A new mirror's SETUP must not
                                // pause CarPlay between cleanup and a delayed old session's resume.
                                TeslaBrowserLink.resumeCarPlayDisplay()
                            }
                        }
                        publish(state)
                    }
                })
                server = receiver
                discovery = ReceiverBonjour(receiverConfig, receiver.start(), { receiver.displayConfig })
                worker.scheduleWithFixedDelay(::refreshDiscovery, 0, 5, TimeUnit.SECONDS)
                publish("listening")
            } catch (_: Exception) {
                publish("failed")
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun logDiagnostic(message: String) {
        Log.i("tiplay-airplay", message)
        TeslaBrowserLink.persistDiagnostic(message)
    }

    private fun identity(): ReceiverConfig {
        val prefs = getSharedPreferences("tiplay_airplay_receiver", MODE_PRIVATE)
        val private = prefs.getString("private", null)
        val public = prefs.getString("public", null)
        val pairing = prefs.getString("pairing", null)
        val identity = if (private != null && public != null && pairing != null) {
            AirPlayIdentity(Base64.decode(private, Base64.NO_WRAP), Base64.decode(public, Base64.NO_WRAP), pairing)
        } else AirPlayIdentity.generate().also {
            prefs.edit().putString("private", Base64.encodeToString(it.privateKey, Base64.NO_WRAP))
                .putString("public", Base64.encodeToString(it.publicKey, Base64.NO_WRAP)).putString("pairing", it.pairingId).apply()
        }
        val deviceId = prefs.getString("device", null) ?: ByteArray(6).also {
            SecureRandom().nextBytes(it); it[0] = ((it[0].toInt() or 2) and 0xfe).toByte()
        }.joinToString(":") { "%02X".format(it.toInt() and 255) }.also { prefs.edit().putString("device", it).apply() }
        return ReceiverConfig("TiPlay AirPlay", deviceId, identity,
            fps = AirPlayPersistence.loadFps(this), hevcEnabled = AirPlayPersistence.loadHevcEnabled(this))
    }

    private fun refreshDiscovery() {
        if (destroyed) return
        try {
            val advertised = discovery?.refresh() == true
            if (!advertised && state == "listening") publish("no-network")
            else if (advertised && state == "no-network") publish("listening")
        } catch (_: Exception) { if (!destroyed) publish("discovery-failed") }
    }

    override fun onDestroy() {
        settingsSubscription?.close(); settingsSubscription = null
        synchronized(displayLock) {
            destroyed = true
            mirrorOutput?.close(); mirrorOutput = null
            mirrorAudio?.close(); mirrorAudio = null
            player.close() // Service destruction runs on main; release the cast canvas before restore.
            TeslaBrowserLink.resumeCarPlayDisplay() // do not wait for mDNS registration/goodbye timers
        }
        locks.release()
        runCatching { multicast?.release() }; multicast = null
        worker.execute {
            server?.close()
            server = null
            discovery?.close(); discovery = null
            publish("stopped")
        }
        worker.shutdown()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) { stopSelf() }

    companion object {
        private const val CHANNEL = "tiplay_airplay_receiver"
        @Volatile var state: String = "stopped"
            private set
        private fun publish(value: String) { state = value }
    }
}
