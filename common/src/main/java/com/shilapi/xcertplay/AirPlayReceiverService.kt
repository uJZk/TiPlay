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
import com.shilapi.xcertplay.receiver.ReceiverMirrorExperiment
import com.shilapi.xcertplay.receiver.ReceiverPlayback
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
    private var displayOwner: Any? = null // guarded by displayLock
    private var mirrorStartupReady: CountDownLatch? = null // guarded by displayLock
    @Volatile private var mirrorOutput: WebMediaSink? = null
    private var mirrorAudio: AirPlayMirrorAudio? = null
    private var mirrorAudioFormat: ReceiverMirrorAudioFormat? = null
    private var mirrorAudioFailedFormat: ReceiverMirrorAudioFormat? = null // guarded by displayLock
    private var discovery: ReceiverBonjour? = null // worker only
    private var bluetoothDiscovery: AirPlayBluetoothDiscovery? = null // worker only
    @Volatile private var destroyed = false
    private val receiverInstance = receiverInstances.incrementAndGet()
    private var lastAppliedProfile: String? = null // worker only
    private val receiverLifecycle = AirPlayMirrorReceiverLifecycle(
        loadMode = { AirPlayMirrorExperimentSettings.get(this) },
        post = { action -> if (!destroyed && !worker.isShutdown) runCatching { worker.execute(action) } },
        stop = ::resetReceiver,
        start = ::startReceiver,
    )

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        publish("starting")
        deviceTrust = ReceiverDeviceTrust(AirPlayDeviceTrustStore(this), diagnostic = ::logDiagnostic)
        trustRegistration = AirPlayTrustNotifications.attach(deviceTrust)
        viewportSubscription = TeslaBrowserLink.listenViewport(this) { viewport ->
            val size = TeslaBrowserCanvas.sizeFor(viewport)
            worker.execute {
                if (!destroyed) server?.let { receiver ->
                    receiver.updateDisplaySize(size.width, size.height,
                        viewport?.videoCapabilities?.hevc == true,
                        AirPlayMirrorExperimentSettings.mirrorEnabled(receiver.displayConfig.mirrorExperiment, viewport?.videoCapabilities))
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
                if (!destroyed && ended && player.playbackEpoch == epoch) releaseDisplay()
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
        worker.scheduleWithFixedDelay(::refreshDiscovery, 0, 5, TimeUnit.SECONDS)
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
            if (!destroyed && !AirPlayReceiverSettings.isDisabled(this)) receiverLifecycle.reconcile()
        }
        return START_NOT_STICKY
    }

    private fun startReceiver(mode: ReceiverMirrorExperiment, generation: Long) {
        if (destroyed || !receiverLifecycle.isCurrent(generation) || AirPlayReceiverSettings.isDisabled(this)) return
        logReceiverDiagnostic(mode, generation, "experiment stage=START_BEGIN")
        try {
            val receiverConfig = identity(mode)
            val receiverTrust = deviceTrust
            fun active(): Boolean = !destroyed && receiverLifecycle.isCurrent(generation)
            val receiver = ReceiverServer(receiverConfig, object : ReceiverServer.Listener {
                override fun log(message: String) = logReceiverDiagnostic(mode, generation, message)
                override fun authorizeDevice(sessionToken: String, verifiedPublicKey: ByteArray?, deviceName: String, mediaType: String): Boolean =
                    active() && receiverTrust.authorizeSession(sessionToken, verifiedPublicKey, deviceName, mediaType) && active()
                override fun authorizeDevice(sessionToken: String, identity: ByteArray, deviceName: String,
                                             mediaType: String, verifiedSessionId: String?): Boolean =
                    active() && receiverTrust.authorizeSession(sessionToken, identity, deviceName, mediaType, verifiedSessionId) && active()
                override fun authorizeConnection(sessionToken: String, deviceName: String, mediaType: String): Boolean =
                    active() && receiverTrust.authorizeSession(sessionToken, null, deviceName, mediaType) && active()
                override fun onAuthorizationSessionEnded(sessionToken: String) = receiverTrust.endSession(sessionToken)
                override fun flushMirrorAudio() {
                    synchronized(displayLock) { if (active()) { mirrorAudio?.flush(); mirrorAudioFailedFormat = null } }
                }
                override fun audioMetadata(value: com.shilapi.xcertplay.receiver.ReceiverAudioMetadataUpdate) {
                    synchronized(displayLock) { if (active()) player.audioMetadata(value) }
                }
                override fun audioSample(sample: Long, sampleRate: Int) {
                    synchronized(displayLock) { if (active()) player.audioSample(sample, sampleRate) }
                }
                override fun audioRemoteControls(actions: List<String>) { synchronized(displayLock) { if (active()) player.audioRemoteControls(actions) } }
                override fun audioRemoteRequested(action: String) { synchronized(displayLock) { if (active()) player.audioRemoteRequested(action) } }
                override fun audioRemoteFinished(accepted: Boolean) { synchronized(displayLock) { if (active()) player.audioRemoteFinished(accepted) } }
                override fun audioRemoteIdle() { synchronized(displayLock) { if (active()) player.audioRemoteIdle() } }
                override fun audioRemoteExpired() { synchronized(displayLock) { if (active()) player.audioRemoteExpired() } }
                override fun audioTimelineReset() { synchronized(displayLock) { if (active()) player.audioTimelineReset() } }
                override fun prepareMirror() {
                    synchronized(displayLock) {
                        check(active() && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService))
                    }
                }
                override fun mirrorSink(): WebMediaSink = openMirrorSink(receiverConfig, generation)
                override fun play(item: ReceiverPlay) {
                    synchronized(displayLock) {
                        if (active() && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService)) {
                            requestDisplay()
                            // Capture the receiver item now, while its owner is established. UI-thread
                            // startup and cancelled HTTP fallbacks must not load on a later sender.
                            val receiver = server
                            if (receiver != null) player.play(item, receiver.resourceLoader())
                        }
                    }
                }
                override fun stopPlayback() {
                    synchronized(displayLock) {
                        if (!active()) return
                        val stoppedGeneration = displayGeneration
                        val stoppedOwner = displayOwner
                        player.stop {
                            synchronized(displayLock) {
                                // Old callbacks cannot cancel the replacement's cleanup barrier or screen loan.
                                if (active() && displayGeneration == stoppedGeneration) releaseDisplay(stoppedOwner)
                            }
                        }
                    }
                }
                override fun mirrorAudioTimed(format: ReceiverMirrorAudioFormat, payload: ByteArray, sample: Long, presentationNanos: Long?) {
                    synchronized(displayLock) {
                        if (active()) {
                            // A failed transport waits for FLUSH or a new session; video continues.
                            if (mirrorAudioFailedFormat == format) return@synchronized
                            if (mirrorAudioFormat != format) { mirrorAudio?.close(); mirrorAudio = null }
                            var created: AirPlayMirrorAudio? = null
                            val soundtrack = mirrorAudio ?: AirPlayMirrorAudio(format, TeslaBrowserLink.audioHub) { error ->
                                synchronized(displayLock) {
                                    // Only the current transport can retire its publication owner.
                                    val failed = created
                                    if (active() && failed != null && mirrorAudio === failed) {
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
                    synchronized(displayLock) { if (active()) { mirrorAudio?.close(); mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = null } }
                }
                override fun photo(bytes: ByteArray) {
                    synchronized(displayLock) {
                        if (active() && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService)) {
                            requestDisplay(); player.photo(bytes)
                        }
                    }
                }
                override fun seek(seconds: Double) { synchronized(displayLock) { if (active()) player.seek(seconds) } }
                override fun rate(value: Double) { synchronized(displayLock) { if (active()) player.rate(value) } }
                override fun playback() = synchronized(displayLock) { if (active()) player.state else ReceiverPlayback() }
                override fun videoProperty(property: String, value: Any?): Boolean = synchronized(displayLock) { active() && player.videoProperty(property, value) }
                override fun status(state: String) {
                    if (!active()) return
                    if (state == "failed") {
                        worker.execute { if (active()) { publish(state); stopSelf() } }
                        return
                    }
                    if (state == "audio") {
                        synchronized(displayLock) {
                            if (!active()) return
                            val generation = ++displayGeneration
                            val releasedOwner = displayOwner
                            mirrorOutput?.close(); mirrorOutput = null
                            // Audio has no display resource. Release any previous visual producer
                            // before returning its confirmed CarPlay screen loan.
                            player.audio(pause = { active() && server?.pauseAudio(it) == true }, remote = { active() && server?.remoteAudio(it) == true }, afterReady = {
                                synchronized(displayLock) {
                                    if (active() && displayGeneration == generation) releaseDisplay(releasedOwner)
                                }
                            }) { worker.execute { if (active()) server?.stopAudioPlayback() } }
                        }
                    }
                    if (state == "listening") {
                        synchronized(displayLock) {
                            if (!active()) return
                            mirrorAudio?.close(); mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = null
                            // Release and restore in one transition. A new mirror's SETUP must not
                            // pause CarPlay between cleanup and a delayed old session's resume.
                            mirrorOutput?.close(); mirrorOutput = null
                            val stoppedGeneration = displayGeneration
                            val stoppedOwner = displayOwner
                            player.stop {
                                synchronized(displayLock) {
                                    if (active() && displayGeneration == stoppedGeneration) releaseDisplay(stoppedOwner)
                                }
                            }
                        }
                    }
                    if (active()) publish(state)
                }
            })
            server = receiver
            discovery = ReceiverBonjour(receiverConfig, receiver.start(), { receiver.displayConfig }, receiver.dacpDiscovery)
            refreshDiscovery()
            logAppliedProfile(receiver.displayConfig, generation, "started")
            publish("listening")
        } catch (error: Exception) {
            logReceiverDiagnostic(mode, generation, "stage=START_FAILED exception=${error.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(error)}")
            publish("failed")
            stopSelf()
        }
    }

    /** Retire the old discovery lease before a replacement can register on the main CarPlay listener. */
    private fun resetReceiver(generation: Long, afterStop: () -> Unit) {
        val retired = server
        server = null
        val previous = retired?.displayConfig?.mirrorExperiment ?: ReceiverMirrorExperiment.BASELINE
        logReceiverDiagnostic(previous, generation, "experiment stage=RESET_BEGIN next=${AirPlayMirrorExperimentSettings.get(this).id}")
        publish("starting")
        deviceTrust.resetSessions()
        val owner = synchronized(displayLock) {
            displayGeneration++
            mirrorOutput?.close(); mirrorOutput = null
            // Wake a type110 loan waiter before close() needs its receiver ownership lock.
            mirrorStartupReady?.countDown(); mirrorStartupReady = null
            mirrorAudio?.close(); mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = null
            displayOwner
        }
        bluetoothDiscovery?.let {
            it.close()
            logReceiverDiagnostic(previous, generation, "experiment stage=BLE_RETIRED")
        }
        bluetoothDiscovery = null
        retired?.close()
        synchronized(displayLock) {
            player.stop {
                synchronized(displayLock) {
                    if (!destroyed) releaseDisplay(owner)
                }
                logReceiverDiagnostic(previous, generation, "experiment stage=RESET_MEDIA_RELEASED")
                afterStop()
            }
        }
        discovery?.close(); discovery = null
        lastAppliedProfile = null
    }

    /** A picture-only SETUP retains the independently owned type-96 soundtrack and failure gate. */
    private fun openMirrorSink(receiverConfig: ReceiverConfig, receiverGeneration: Long): WebMediaSink {
        val ready = CountDownLatch(1)
        val playbackReleased = java.util.concurrent.atomic.AtomicBoolean()
        val output = synchronized(displayLock) {
            check(!destroyed && receiverLifecycle.isCurrent(receiverGeneration) && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService))
            val display = server?.displayConfig ?: receiverConfig
            WebMediaSink(TeslaBrowserLink.hub, display.width, display.height, display.fps,
                com.shilapi.xcertplay.web.BrowserDisplaySource.AIRPLAY).also {
                it.pauseDisplay()
                it.onScreenStreamActive(110, true)
                mirrorOutput = it
                mirrorStartupReady = ready
                requestDisplay(it, ready)
                val generation = displayGeneration
                player.stop {
                    playbackReleased.set(true)
                    synchronized(displayLock) {
                        // A timed-out loan can finish before the main thread releases
                        // an old URL/photo resource. Retry return after that cleanup.
                        if (!destroyed && displayGeneration == generation && mirrorOutput == null)
                            releaseDisplay()
                    }
                }
            }
        }
        // The iPhone cannot send its only initial IDR until SETUP supplies a data port.
        // Wait on this control thread, never while holding the service display lock.
        val available = ready.await(5, TimeUnit.SECONDS)
        synchronized(displayLock) { if (mirrorStartupReady === ready) mirrorStartupReady = null }
        if (!available || destroyed || !receiverLifecycle.isCurrent(receiverGeneration) || mirrorOutput !== output) {
            synchronized(displayLock) {
                output.close()
                if (mirrorOutput === output) {
                    mirrorOutput = null
                    if (playbackReleased.get()) releaseDisplay()
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

    private fun logReceiverDiagnostic(mode: ReceiverMirrorExperiment, generation: Long, message: String) =
        logDiagnostic("receiver mode=${mode.id} instance=$receiverInstance generation=$generation $message")

    private fun logAppliedProfile(config: ReceiverConfig, generation: Long, reason: String) {
        val profile = "mode=${config.mirrorExperiment.id} generation=$generation mirrorEnabled=${config.mirrorEnabled} " +
            "hevcEnabled=${config.effectiveMirrorHevcEnabled} blePolicyEnabled=${config.mirrorExperiment.bluetoothDiscoveryEnabled} " +
            "legacyPairing=${config.features and (1L shl 27) != 0L} features=0x${config.features.toString(16)} " +
            "audioFormats=0x${config.audioOutputFormats.toString(16)} width=${config.width} height=${config.height} " +
            "fps=${config.fps} port=${server?.port ?: 0}"
        if (lastAppliedProfile == profile) return
        lastAppliedProfile = profile
        logReceiverDiagnostic(config.mirrorExperiment, generation, "experiment stage=PROFILE_APPLIED reason=$reason $profile")
    }

    /** Called under displayLock; stale ownership callbacks cannot affect a replacement producer. */
    private fun requestDisplay(output: WebMediaSink? = null, ready: CountDownLatch? = null) {
        val generation = ++displayGeneration
        val owner = Any().also { displayOwner = it }
        player.setOutputAllowed(false)
        TeslaBrowserLink.pauseCarPlayDisplay(owner) { available ->
            synchronized(displayLock) {
                if (!destroyed && displayGeneration == generation && displayOwner === owner) {
                    if (available) { output?.resumeDisplay(); ready?.countDown() }
                    else output?.pauseDisplay()
                    // A mirror owns its sink; a queued old photo/video must stay hidden.
                    player.setOutputAllowed(available && output == null)
                }
            }
        }
    }

    /** Called after this producer releases its picture, never a different casting path's lease. */
    private fun releaseDisplay(owner: Any? = displayOwner) {
        if (owner == null) return
        if (displayOwner === owner) displayOwner = null
        TeslaBrowserLink.resumeCarPlayDisplay(owner)
    }

    private fun identity(mode: ReceiverMirrorExperiment): ReceiverConfig {
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
            mirrorEnabled = AirPlayMirrorExperimentSettings.mirrorEnabled(mode, TeslaBrowserLink.lastViewport(this)?.videoCapabilities),
            audioOutputFormats = TeslaBrowserLink.audioCapabilities()?.formats ?: 0L,
            mirrorExperiment = mode)
    }

    private fun refreshDiscovery() {
        if (destroyed) return
        try {
            server?.updateAudioFormats(TeslaBrowserLink.audioCapabilities()?.formats ?: 0L)
            server?.displayConfig?.let { current ->
                if (current.mirrorExperiment.bluetoothDiscoveryEnabled) {
                    if (bluetoothDiscovery == null) {
                        val generation = receiverLifecycle.generation
                        bluetoothDiscovery = AirPlayBluetoothDiscovery(this) {
                            logReceiverDiagnostic(current.mirrorExperiment, generation, it)
                        }
                    }
                    bluetoothDiscovery?.refresh(current.txt.toSortedMap().toString())
                } else {
                    bluetoothDiscovery?.close(); bluetoothDiscovery = null
                }
                logAppliedProfile(current, receiverLifecycle.generation, "updated")
            }
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
        receiverLifecycle.close()
        settingsSubscription?.close(); settingsSubscription = null
        viewportSubscription?.close(); viewportSubscription = null
        trustRegistration?.close(); trustRegistration = null
        synchronized(displayLock) {
            destroyed = true
            mirrorStartupReady?.countDown(); mirrorStartupReady = null
            mirrorOutput?.close(); mirrorOutput = null
            mirrorAudio?.close(); mirrorAudio = null; mirrorAudioFormat = null; mirrorAudioFailedFormat = null
            player.close() // Service destruction runs on main; release the cast canvas before restore.
            releaseDisplay() // do not wait for mDNS registration/goodbye timers
        }
        locks.release()
        runCatching { multicast?.release() }; multicast = null
        worker.execute {
            server?.close()
            server = null
            bluetoothDiscovery?.close(); bluetoothDiscovery = null
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
        internal const val ACTION_APPLY_MIRROR_EXPERIMENT = "com.ujzk.tiplay.action.APPLY_AIRPLAY_MIRROR_EXPERIMENT"
        private val receiverInstances = java.util.concurrent.atomic.AtomicLong()
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
