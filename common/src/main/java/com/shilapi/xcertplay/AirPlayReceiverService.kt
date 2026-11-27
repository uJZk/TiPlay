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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.util.Log
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.receiver.ReceiverBonjour
import com.shilapi.xcertplay.receiver.ReceiverConfig
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
    private val main = Handler(Looper.getMainLooper())
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
    private var receiverStarted = false // worker only; a failed instance stops before another starts
    @Volatile private var authorityOwner: AirPlayReceiverServiceAuthority.Owner? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        authorityOwner = serviceAuthority.acquire { updatePublishedState("starting") }
        notifyStateListeners()
        deviceTrust = ReceiverDeviceTrust(AirPlayDeviceTrustStore(this), diagnostic = ::logDiagnostic)
        trustRegistration = AirPlayTrustNotifications.attach(deviceTrust)
        viewportSubscription = TeslaBrowserLink.listenViewport(this) { viewport ->
            val size = TeslaBrowserCanvas.sizeFor(viewport)
            worker.execute {
                if (active()) server?.let { receiver ->
                    receiver.updateDisplaySize(size.width, size.height,
                        viewport?.videoCapabilities?.hevc == true,
                        viewport?.videoCapabilities?.let { it.h264 || it.hevc } ?: true)
                    refreshDiscovery()
                }
            }
        }
        settingsSubscription = BrowserSettingsChanges.listen(this) {
            worker.execute {
                if (active()) server?.let { receiver ->
                    receiver.updateDisplay(AirPlayPersistence.loadFps(this), TeslaBrowserLink.lastViewport(this)?.videoCapabilities?.hevc == true)
                    refreshDiscovery()
                }
            }
        }
        player = AirPlayCastPlayer({ url, range -> server?.loadResource(url, range) }) { state, epoch ->
            playbackDiagnostics.callback(state, epoch)
            val ended = state in listOf("failed", "stopped")
            synchronized(displayLock) {
                if (active() && ended && player.playbackEpoch == epoch) releaseDisplay()
            }
            if (active()) worker.execute {
                if (active() && player.playbackEpoch == epoch) {
                    // UxPlay reports ongoing video state through /playback-info. Reserve reverse
                    // HTTP for FCUP instead of interleaving unsolicited playback state requests.
                    if (ended) {
                        server?.finishPlayback(if (state == "failed") ReceiverServer.PlaybackFinishReason.BROWSER_FAILED
                            else ReceiverServer.PlaybackFinishReason.BROWSER_ENDED)
                        if (state == "failed") publishCurrent("playback-failed")
                    } else if (state in setOf("loading", "playing", "paused", "photo")) publishCurrent(state)
                }
            }
        }
        worker.scheduleWithFixedDelay(::refreshDiscovery, 0, 5, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!active()) return START_NOT_STICKY
        if (AirPlayReceiverSettings.isDisabled(this)) { publishCurrent("stopped"); stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "AirPlay", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 10, CarPlaySettingsNavigation.mainIntent(this), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_diplay_notification)
            .setContentTitle(getString(R.string.settings_airplay_title))
            .setContentText(getString(R.string.settings_airplay_listening))
            .setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(10, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else startForeground(10, notification)
        if (LocalNetworkPermission.state(this) == LocalNetworkPermission.State.DENIED) { publishCurrent("permission"); stopSelf(); return START_NOT_STICKY }
        TeslaBrowserLink.start(this)
        HotspotExtraAddressSettings.sync(this)
        worker.execute {
            if (active() && !AirPlayReceiverSettings.isDisabled(this)) startReceiver()
        }
        return START_NOT_STICKY
    }

    private fun active(): Boolean = !destroyed && authorityOwner?.isCurrent() == true

    private fun publishCurrent(value: String) {
        if (authorityOwner?.commit { updatePublishedState(value) } == true) notifyStateListeners()
    }

    private fun stopCurrent() {
        // Service creation/destruction and this final ownership check share Android's main queue.
        main.post { if (active()) stopSelf() }
    }

    private fun startReceiver() {
        val publication = authorityOwner ?: return
        if (!active() || receiverStarted || AirPlayReceiverSettings.isDisabled(this)) return
        receiverStarted = true
        logReceiverDiagnostic("stage=START_BEGIN")
        var candidate: ReceiverServer? = null
        try {
            val receiverConfig = identity()
            val receiverTrust = deviceTrust
            val receiver = ReceiverServer(receiverConfig, object : ReceiverServer.Listener {
                override fun log(message: String) = logReceiverDiagnostic(message)
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
                override fun canRecoverCarPlayMirror(): Boolean = active() &&
                    com.shilapi.xcertplay.diagnostics.RawTraffic.enabled &&
                    CarPlayBackgroundSession.snapshot()?.controller?.screenBorrowState?.carPlayHasScreen == true

                override fun borrowForMirrorStartup(token: Any): Boolean = synchronized(displayLock) {
                    if (!canRecoverCarPlayMirror() || displayOwner != null || TeslaBrowserLink.airPlayActive)
                        return@synchronized false
                    displayGeneration++
                    displayOwner = token
                    TeslaBrowserLink.pauseCarPlayDisplay(token)
                    true
                }

                override fun returnStartupScreen(token: Any) = synchronized(displayLock) {
                    if (displayOwner === token) releaseDisplay(token)
                }

                override fun prepareMirror() {
                    synchronized(displayLock) {
                        check(active() && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService))
                    }
                }
                override fun mirrorSink(): WebMediaSink = openMirrorSink(receiverConfig)
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
                                        publishCurrent("audio-failed")
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
                    synchronized(displayLock) {
                        if (!active()) return
                        locks.update(state in setOf("mirror", "audio", "video", "photo"))
                    }
                    if (state == "failed") {
                        worker.execute { if (active()) { publishCurrent(state); stopCurrent() } }
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
                    if (active()) publishCurrent(state)
                }
            })
            candidate = receiver
            server = receiver
            val port = receiver.start(publication::publishDiscovery)
            if (!active()) {
                receiver.close()
                if (server === receiver) server = null
                return
            }
            discovery = ReceiverBonjour(receiverConfig, port, { receiver.displayConfig }, receiver.dacpDiscovery)
            refreshDiscovery()
            if (!active()) {
                discovery?.close(); discovery = null
                receiver.close()
                if (server === receiver) server = null
                return
            }
            logAppliedProfile(receiver.displayConfig, "started")
            publishCurrent("listening")
        } catch (error: Exception) {
            candidate?.let { retired ->
                runCatching { discovery?.close() }; discovery = null
                runCatching { retired.close() }
                if (server === retired) server = null
            }
            if (active()) {
                logReceiverDiagnostic("stage=START_FAILED exception=${error.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(error)}")
                publishCurrent("failed")
                stopCurrent()
            }
        }
    }

    /** A picture-only SETUP retains the independently owned type-96 soundtrack and failure gate. */
    private fun openMirrorSink(receiverConfig: ReceiverConfig): WebMediaSink {
        val ready = CountDownLatch(1)
        val playbackReleased = java.util.concurrent.atomic.AtomicBoolean()
        val output = synchronized(displayLock) {
            check(active() && !AirPlayReceiverSettings.isDisabled(this@AirPlayReceiverService))
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
        if (!available || !active() || mirrorOutput !== output) {
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

    private fun logReceiverDiagnostic(message: String) =
        logDiagnostic("receiver instance=$receiverInstance $message")

    private fun logAppliedProfile(config: ReceiverConfig, reason: String) {
        val profile = "mirrorEnabled=${config.mirrorEnabled} hevcEnabled=${config.hevcEnabled} " +
            "features=0x${config.features.toString(16)} " +
            "audioFormats=0x${config.audioOutputFormats.toString(16)} width=${config.width} height=${config.height} " +
            "fps=${config.fps} port=${server?.port ?: 0}"
        if (lastAppliedProfile == profile) return
        lastAppliedProfile = profile
        logReceiverDiagnostic("stage=PROFILE_APPLIED reason=$reason $profile")
    }

    /** Called under displayLock; stale ownership callbacks cannot affect a replacement producer. */
    private fun requestDisplay(output: WebMediaSink? = null, ready: CountDownLatch? = null) {
        val generation = ++displayGeneration
        val owner = Any().also { displayOwner = it }
        player.setOutputAllowed(false)
        TeslaBrowserLink.pauseCarPlayDisplay(owner) { available ->
            synchronized(displayLock) {
                if (active() && displayGeneration == generation && displayOwner === owner) {
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
        val viewport = TeslaBrowserLink.receiverViewportSnapshot(this)
        val size = TeslaBrowserCanvas.sizeFor(viewport)
        val capabilities = viewport?.videoCapabilities
        return ReceiverConfig("TiPlay AirPlay", deviceId, identity,
            width = size.width, height = size.height,
            fps = AirPlayPersistence.loadFps(this), hevcEnabled = capabilities?.hevc == true,
            mirrorEnabled = capabilities?.let { it.h264 || it.hevc } ?: true,
            audioOutputFormats = viewport?.audioCapabilities?.formats ?: 0L)
    }

    // Discovery runs on the worker. Serialize with main-thread destruction so a late
    // enumeration cannot reacquire the Wi-Fi multicast lock after teardown.
    @Synchronized private fun updateMulticastLock(hasNetwork: Boolean) {
        if (!hasNetwork || !active()) {
            multicast?.let { if (it.isHeld) it.release() }
            multicast = null
        } else if (multicast == null) {
            multicast = getSystemService(WifiManager::class.java)?.createMulticastLock("tiplay-airplay")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }
    }

    private fun refreshDiscovery() {
        if (!active()) return
        try {
            server?.updateAudioFormats(TeslaBrowserLink.audioCapabilities()?.formats ?: 0L)
            server?.displayConfig?.let { current ->
                if (bluetoothDiscovery == null) {
                    bluetoothDiscovery = AirPlayBluetoothDiscovery(this, ::logReceiverDiagnostic)
                }
                bluetoothDiscovery?.refresh(current.txt.toSortedMap().toString())
                logAppliedProfile(current, "updated")
            }
            val advertised = discovery?.refresh(::updateMulticastLock) == true
            if (!advertised && state == "listening") publishCurrent("no-network")
            else if (advertised && state == "no-network") publishCurrent("listening")
        } catch (error: Exception) {
            if (active()) {
                logDiagnostic("receiver stage=DISCOVERY_FAILED exception=${error.javaClass.simpleName} errorText=${DiagnosticErrorText.describe(error)}")
                publishCurrent("discovery-failed")
            }
        }
    }

    override fun onDestroy() {
        var stoppedPublished = false
        authorityOwner?.retire {
            if (state !in setOf("failed", "permission", "discovery-failed")) {
                updatePublishedState("stopped")
                stoppedPublished = true
            }
        }
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
        updateMulticastLock(false)
        worker.execute {
            server?.close()
            server = null
            bluetoothDiscovery?.close(); bluetoothDiscovery = null
            discovery?.close(); discovery = null
        }
        worker.shutdown()
        if (stoppedPublished) notifyStateListeners()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The launcher removes its empty handoff task while the host task still owns the receiver.
        if (rootIntent?.component?.className == FirstUseActivity::class.java.name) return
        stopSelf()
    }

    companion object {
        private val serviceAuthority = AirPlayReceiverServiceAuthority()
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
        /** Tests inject public status without creating a foreground Service; runtime uses its owner. */
        internal fun publish(value: String) {
            updatePublishedState(value)
            notifyStateListeners()
        }
        private fun updatePublishedState(value: String) {
            // Repeated labels are distinct events: a later failure can belong to a new cast.
            publishedState.updateAndGet { StateSnapshot(value, it.revision + 1) }
        }
        private fun notifyStateListeners() {
            stateListeners.forEach { it() }
        }
    }
}
