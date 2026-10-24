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
import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.receiver.ReceiverBonjour
import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverServer
import com.shilapi.xcertplay.receiver.ReceiverMirrorAudioFormat
import com.shilapi.xcertplay.receiver.ReceiverDeviceTrust
import com.shilapi.xcertplay.web.AirPlayTrustNotifications
import com.shilapi.xcertplay.web.WebMediaSink
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The default AirPlay receiver; CarPlay retains its controller while AirPlay borrows the canvas. */
class AirPlayReceiverService : Service() {
    private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "tiplay-airplay-service").apply { isDaemon = true } }
    private val locks by lazy { PhoneBrowserLocks(this) }
    private var multicast: WifiManager.MulticastLock? = null
    @Volatile private var server: ReceiverServer? = null // worker creates/closes; callbacks may read
    private var settingsSubscription: AutoCloseable? = null
    private var viewportSubscription: AutoCloseable? = null
    private var trustRegistration: java.io.Closeable? = null
    private lateinit var deviceTrust: ReceiverDeviceTrust
    private lateinit var player: AirPlayCastPlayer
    private val playbackDiagnostics = AirPlayVideoDiagnostics(::logDiagnostic)
    private val displayLock = Any()
    private var displayGeneration = 0L // guarded by displayLock
    @Volatile private var mirrorOutput: WebMediaSink? = null
    private var mirrorAudio: AirPlayMirrorAudio? = null
    private var mirrorAudioFormat: ReceiverMirrorAudioFormat? = null
    private var mirrorAudioFailedFormat: ReceiverMirrorAudioFormat? = null // guarded by displayLock
    private var discovery: ReceiverBonjour? = null // worker only
    @Volatile private var destroyed = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        publish("starting")
        deviceTrust = ReceiverDeviceTrust(AirPlayDeviceTrustStore(this))
        trustRegistration = AirPlayTrustNotifications.attach(deviceTrust)
        viewportSubscription = TeslaBrowserLink.listenViewport(this) { viewport ->
            val size = TeslaBrowserCanvas.sizeFor(viewport)
            worker.execute {
                if (!destroyed) server?.let { receiver ->
                    receiver.updateDisplaySize(size.width, size.height,
                        viewport?.videoCapabilities?.hevc == true,
                        viewport?.videoCapabilities?.let { it.h264 || it.hevc } ?: true)
                    refreshDiscovery()
                }
            }
        }
        settingsSubscription = BrowserSettingsChanges.listen(this) {
            worker.execute {
                if (!destroyed) server?.let { receiver ->
                    receiver.updateDisplay(AirPlayPersistence.loadFps(this), TeslaBrowserLink.lastViewport(this)?.videoCapabilities?.hevc == true)
                    refreshDiscovery()
                }
            }
        }
        player = AirPlayCastPlayer({ url, range -> server?.loadResource(url, range) }) { state, epoch ->
            playbackDiagnostics.callback(state, epoch)
            val ended = state in listOf("failed", "stopped")
            synchronized(displayLock) {
                if (!destroyed && ended && player.playbackEpoch == epoch) TeslaBrowserLink.resumeCarPlayDisplay()
            }
            if (!destroyed) worker.execute {
                if (!destroyed && player.playbackEpoch == epoch) {
                    // UxPlay reports ongoing video state through /playback-info. Reserve reverse
                    // HTTP for FCUP instead of interleaving unsolicited playback state requests.
                    if (ended) {
                        server?.finishPlayback(if (state == "failed") ReceiverServer.PlaybackFinishReason.BROWSER_FAILED
                            else ReceiverServer.PlaybackFinishReason.BROWSER_ENDED)
                        if (state == "failed") publish("playback-failed")
                    } else if (state in setOf("loading", "playing", "paused", "photo")) publish(state)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (AirPlayReceiverSettings.isDisabled(this)) { publish("stopped"); stopSelf(); return START_NOT_STICKY }
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
                    override fun authorizeDevice(verifiedPublicKey: ByteArray?, deviceName: String): Boolean =
                        !destroyed && deviceTrust.authorize(verifiedPublicKey, deviceName)
                    override fun authorizeConnection(sessionToken: String, deviceName: String): Boolean =
                        !destroyed && deviceTrust.authorizeOnce(sessionToken, deviceName)
                    override fun onAuthorizationSessionEnded(sessionToken: String) = deviceTrust.endSession(sessionToken)
                    override fun flushMirrorAudio() {
                        synchronized(displayLock) { mirrorAudio?.flush(); mirrorAudioFailedFormat = null }
                    }
                    override fun prepareMirror() {
                        synchronized(displayLock) {
                            check(!destroyed && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService))
                            requestDisplay()
                        }
                    }
                    override fun mirrorSink(): WebMediaSink = openMirrorSink(receiverConfig)
                    override fun play(item: ReceiverPlay) {
                        synchronized(displayLock) {
                            if (!destroyed && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService)) {
                                requestDisplay()
                                // Capture the receiver item now, while its owner is established. UI-thread
                                // startup and cancelled HTTP fallbacks must not load on a later sender.
                                val receiver = server
                                if (receiver != null) player.play(item, receiver.resourceLoader())
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
                            if (!destroyed) {
                                // A failed transport waits for FLUSH or a new session; video continues.
                                if (mirrorAudioFailedFormat == format) return@synchronized
                                if (mirrorAudioFormat != format) { mirrorAudio?.close(); mirrorAudio = null }
                                var created: AirPlayMirrorAudio? = null
                                val soundtrack = mirrorAudio ?: AirPlayMirrorAudio(format, TeslaBrowserLink.audioHub) { error ->
                                    synchronized(displayLock) {
                                        // Only the current transport can retire its publication owner.
                                        val failed = created
                                        if (failed != null && mirrorAudio === failed) {
                                            mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = format
                                            failed.close()
                                            logDiagnostic("audio stage=TRANSPORT_FAILED codec=${format.codec} exception=${error.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(error)}")
                                            publish("audio-failed")
                                        }
                                    }
                                }.also { created = it; mirrorAudio = it; mirrorAudioFormat = format; mirrorAudioFailedFormat = null }
                                soundtrack.offer(payload, sample, presentationNanos)
                            }
                        }
                    }
                    override fun stopMirrorAudio() {
                        synchronized(displayLock) { mirrorAudio?.close(); mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = null }
                    }
                    override fun photo(bytes: ByteArray) {
                        synchronized(displayLock) {
                            if (!destroyed && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService)) {
                                requestDisplay(); player.photo(bytes)
                            }
                        }
                    }
                    override fun seek(seconds: Double) { player.seek(seconds) }
                    override fun rate(value: Double) { player.rate(value) }
                    override fun playback() = player.state
                    override fun videoProperty(property: String, value: Any?): Boolean = player.videoProperty(property, value)
                    override fun status(state: String) {
                        if (destroyed) return
                        if (state == "audio") {
                            synchronized(displayLock) {
                                val generation = ++displayGeneration
                                // Audio has no display resource. Release any previous visual producer
                                // before returning its confirmed CarPlay screen loan.
                                player.audio(afterReady = {
                                    synchronized(displayLock) {
                                        if (!destroyed && displayGeneration == generation) TeslaBrowserLink.resumeCarPlayDisplay()
                                    }
                                }) { worker.execute { if (!destroyed) server?.stopAudioPlayback() } }
                            }
                        }
                        if (state == "listening") {
                            synchronized(displayLock) {
                                mirrorAudio?.close(); mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = null; mirrorOutput = null
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
            } catch (error: Exception) {
                logDiagnostic("receiver stage=START_FAILED exception=${error.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(error)}")
                publish("failed")
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    /** A picture-only SETUP retains the independently owned type-96 soundtrack and failure gate. */
    private fun openMirrorSink(receiverConfig: ReceiverConfig): WebMediaSink {
        val ready = CountDownLatch(1)
        val output = synchronized(displayLock) {
            check(!destroyed && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService))
            val display = server?.displayConfig ?: receiverConfig
            WebMediaSink(TeslaBrowserLink.hub, display.width, display.height, display.fps,
                com.shilapi.xcertplay.web.BrowserDisplaySource.AIRPLAY).also {
                it.pauseDisplay()
                it.onScreenStreamActive(110, true)
                mirrorOutput = it
                requestDisplay(it, ready)
                val generation = displayGeneration
                player.stop {
                    synchronized(displayLock) {
                        // A timed-out loan can finish before the main thread releases
                        // an old URL/photo resource. Retry return after that cleanup.
                        if (!destroyed && displayGeneration == generation && mirrorOutput == null)
                            TeslaBrowserLink.resumeCarPlayDisplay()
                    }
                }
            }
        }
        // The iPhone cannot send its only initial IDR until SETUP supplies a data port.
        // Wait on this control thread, never while holding the service display lock.
        if (!ready.await(5, TimeUnit.SECONDS) || destroyed || mirrorOutput !== output) {
            synchronized(displayLock) {
                output.close()
                if (mirrorOutput === output) {
                    mirrorOutput = null
                    TeslaBrowserLink.resumeCarPlayDisplay()
                }
            }
            error("CarPlay screen loan was not confirmed")
        }
        return output
    }

    private fun logDiagnostic(message: String) {
        Log.i("tiplay-airplay", message)
        TeslaBrowserLink.persistDiagnostic(message)
    }

    /** Called under displayLock; stale ownership callbacks cannot affect a replacement producer. */
    private fun requestDisplay(output: WebMediaSink? = null, ready: CountDownLatch? = null) {
        val generation = ++displayGeneration
        player.setOutputAllowed(false)
        TeslaBrowserLink.pauseCarPlayDisplay { available ->
            synchronized(displayLock) {
                if (!destroyed && displayGeneration == generation) {
                    if (available) { output?.resumeDisplay(); ready?.countDown() }
                    else output?.pauseDisplay()
                    // A mirror owns its sink; a queued old photo/video must stay hidden.
                    player.setOutputAllowed(available && output == null)
                }
            }
        }
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
            width = TeslaBrowserCanvas.sizeFor(TeslaBrowserLink.lastViewport(this)).width,
            height = TeslaBrowserCanvas.sizeFor(TeslaBrowserLink.lastViewport(this)).height,
            fps = AirPlayPersistence.loadFps(this), hevcEnabled = TeslaBrowserLink.lastViewport(this)?.videoCapabilities?.hevc == true,
            mirrorEnabled = TeslaBrowserLink.lastViewport(this)?.videoCapabilities?.let { it.h264 || it.hevc } ?: true,
            audioOutputFormats = TeslaBrowserLink.audioCapabilities()?.formats ?: 0L)
    }

    private fun refreshDiscovery() {
        if (destroyed) return
        try {
            server?.updateAudioFormats(TeslaBrowserLink.audioCapabilities()?.formats ?: 0L)
            val advertised = discovery?.refresh() == true
            if (!advertised && state == "listening") publish("no-network")
            else if (advertised && state == "no-network") publish("listening")
        } catch (error: Exception) {
            if (!destroyed) {
                logDiagnostic("receiver stage=DISCOVERY_FAILED exception=${error.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(error)}")
                publish("discovery-failed")
            }
        }
    }

    override fun onDestroy() {
        settingsSubscription?.close(); settingsSubscription = null
        viewportSubscription?.close(); viewportSubscription = null
        trustRegistration?.close(); trustRegistration = null
        synchronized(displayLock) {
            destroyed = true
            mirrorOutput?.close(); mirrorOutput = null
            mirrorAudio?.close(); mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = null
            player.close() // Service destruction runs on main; release the cast canvas before restore.
            TeslaBrowserLink.resumeCarPlayDisplay() // do not wait for mDNS registration/goodbye timers
        }
        locks.release()
        runCatching { multicast?.release() }; multicast = null
        worker.execute {
            server?.close()
            server = null
            discovery?.close(); discovery = null
            if (state !in setOf("failed", "permission", "discovery-failed")) publish("stopped")
        }
        worker.shutdown()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The launcher removes its empty handoff task while the host task still owns the receiver.
        if (rootIntent?.component?.className == FirstUseActivity::class.java.name) return
        stopSelf()
    }

    companion object {
        private const val CHANNEL = "tiplay_airplay_receiver"
        internal data class StateSnapshot(val state: String, val revision: Long)
        private val publishedState = java.util.concurrent.atomic.AtomicReference(StateSnapshot("stopped", 0))
        val state: String get() = publishedState.get().state
        internal fun stateSnapshot(): StateSnapshot = publishedState.get()
        private val stateListeners = java.util.concurrent.CopyOnWriteArraySet<() -> Unit>()
        internal fun listenState(listener: () -> Unit): AutoCloseable {
            stateListeners.add(listener)
            return AutoCloseable { stateListeners.remove(listener) }
        }
        internal fun publish(value: String) {
            // Repeated labels are distinct events: a later failure can belong to a new cast.
            publishedState.updateAndGet { StateSnapshot(value, it.revision + 1) }
            stateListeners.forEach { it() }
        }
    }
}
