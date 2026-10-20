package com.shilapi.xcertplay

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.shilapi.xcertplay.airplay.AirPlayContact
import com.shilapi.xcertplay.airplay.AirPlayKnobState
import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.CarPlayScreenBorrowState
import com.shilapi.xcertplay.airplay.CarPlayScreenOwner
import com.shilapi.xcertplay.orchestration.CarPlayController
import com.shilapi.xcertplay.media.BrowserOnlyMediaSink
import com.shilapi.xcertplay.media.BrowserAudioMediaSink
import com.shilapi.xcertplay.media.AndroidBluetoothVoiceChannel
import com.shilapi.xcertplay.media.BluetoothVoiceFactory
import com.shilapi.xcertplay.web.WebAudioHub
import com.shilapi.xcertplay.web.BrowserLinkServer
import com.shilapi.xcertplay.web.BrowserRtcRuntime
import com.shilapi.xcertplay.web.BrowserLinkStatus
import com.shilapi.xcertplay.web.BrowserSize
import com.shilapi.xcertplay.web.BrowserViewport
import com.shilapi.xcertplay.web.BrowserAudioCapabilities
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import java.net.BindException
import java.security.SecureRandom
import java.util.Locale
import java.util.WeakHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.floor

/**
 * Phone + browser mode: the link between TiPlay and the car's browser (integration E1, protocol v1). Process-wide.
 *
 * It owns the [hub] that the CarPlay screen feeds ([tee]) and the [BrowserLinkServer] on port 8080 of every IPv4
 * address. [sync] runs the server while the run mode in
 * effect is phone + browser; binding happens on the link's own thread and is retried with a backoff while the port is
 * taken. The page's touches and keys go to the running CarPlay session; its viewport is saved for the next connection,
 * and its "Apply and reconnect" goes to the CarPlay screen ([Host]) on the main thread.
 *
 * Nothing here logs the pairing code, the page's session id or an address.
 */
internal object TeslaBrowserLink {
    @Volatile var carPlayReceiver: Map<String, Any?> = mapOf("state" to "preparing")
    sealed interface State {
        data object Stopped : State
        data class Listening(val port: Int) : State
        data object PortInUse : State
        data object Failed : State
    }

    /** What the link needs from a server: [BrowserLinkServer] in the app, a fake in tests. */
    interface Server {
        fun start(): Result<Int>
        fun stop()
    }

    fun interface ServerFactory {
        fun create(hub: WebVideoHub, callbacks: BrowserLinkServer.Callbacks): Server
    }

    /** The CarPlay screen's part: its session log, and the browser's requests, on the main thread. */
    interface Host {
        fun log(message: String)
        /** The driver pressed "Apply and reconnect" in the browser: the CarPlay screen decides whether to reconnect. */
        fun onBrowserFit()
        fun onBrowserViewport(viewport: BrowserViewport) {}
        fun onBrowserTheme(night: Boolean) {}
        fun onAirPlayEnded() {}
        fun onBrowserGone() {}
    }

    const val PORT = BrowserLinkServer.DEFAULT_PORT
    const val STATS_LOG_INTERVAL_MILLIS = 10_000L

    private const val TAG = "TiPlayBrowserLink"
    private const val PREFS = "tiplay_browser_link"
    private const val KEY_PAIRING_CODE = "pairing_code"
    private const val KEY_PAGE_ADDRESS = "page_address"
    private const val KEY_VIEWPORT_WIDTH = "viewport_width"
    private const val KEY_VIEWPORT_HEIGHT = "viewport_height"
    private const val KEY_VIEWPORT_CSS_WIDTH = "viewport_css_width"
    private const val KEY_VIEWPORT_CSS_HEIGHT = "viewport_css_height"
    private const val KEY_VIEWPORT_DPR = "viewport_dpr"
    /** The page's `st` fields (the flattened `pageStats()` of site/play/app.js) that the session log keeps. */
    private val STATS_FIELDS = listOf(
        "path" to "link.path",
        "codec" to "video.codec",
        "fps" to "video.decodedFps",
        "currentFps" to "video.currentFps",
        "deltaMs" to "video.currentDelta",
        "droppedFrames" to "video.droppedFrames",
        "decodeP95Ms" to "video.decodeMsP95",
        "timingRecords" to "video.timingRecords",
        "timingRejected" to "video.timingRejected",
        "clockRttMs" to "video.clockRttMs",
        "presentationOffset90" to "video.presentationOffset90",
        "presentationOffsetHigh5" to "video.presentationOffsetHigh5",
        "presentationOffsetSamples" to "video.presentationOffsetSamples",
        "gaps" to "video.gaps",
        "dropped" to "video.dropped",
        "errors" to "video.decodeErrors",
        "reconnects" to "link.reconnects",
        "audioBluetooth" to "audio.bluetooth",
        "audioSound" to "audio.sound",
        "audioTimedPackets" to "audio.timedPackets",
        "audioFallbackPackets" to "audio.fallbackPackets",
        "audioQueuedBytes" to "audio.queuedBytes",
    )
    private val SAFE_TEXT = Regex("[A-Za-z0-9._-]{1,32}")

    /** The app's server: every IPv4 address, so it answers on the hotspot's own and its extra address alike. */
    val appServers = ServerFactory { hub, callbacks ->
        val port = app?.let(BrowserEndpointSettings::port) ?: PORT
        val server = BrowserLinkServer(hub, callbacks, "0.0.0.0", port, audioHub = audioHub)
        app?.let { context ->
            server.rtcFactory = com.shilapi.xcertplay.web.BrowserRtcFactory { control, failure ->
                BrowserRtcRuntime.createPeer(context, control, failure)
            }
        }
        object : Server {
            override fun start() = server.start()
            override fun stop() = server.stop()
        }
    }

    @Volatile internal var serverFactory: ServerFactory = appServers
    /** 1 s, 2 s, 4 s … up to 30 s between attempts to bind while the port is taken. */
    @Volatile internal var backoffMillis: (Int) -> Long = { failures -> minOf(30_000L, 1_000L shl minOf(failures, 5)) }
    @Volatile internal var clock: () -> Long = SystemClock::elapsedRealtime

    val hub: WebVideoHub by lazy { WebVideoHub(log = ::log) }
    val audioHub: WebAudioHub by lazy { WebAudioHub() }

    private val worker = ScheduledThreadPoolExecutor(1) { Thread(it, "tiplay-browser-link").apply { isDaemon = true } }
        .apply { removeOnCancelPolicy = true }
    private val main by lazy { Handler(Looper.getMainLooper()) }
    private val random by lazy { SecureRandom() }
    private val requested = AtomicBoolean(false)
    private val host = AtomicReference<Host?>(null)
    private val listeners = CopyOnWriteArraySet<(State) -> Unit>()
    private val viewportListeners = CopyOnWriteArraySet<(BrowserViewport?) -> Unit>()
    // Both maps and their display transitions share one monitor; retirement detaches the pair
    // before closing it outside this monitor. Sink teardown remains owner-specific.
    private val tapLock = Any()
    private val taps = WeakHashMap<MediaSink, WebMediaSink>() // guarded by tapLock
    private val audioTaps = WeakHashMap<MediaSink, BrowserAudioMediaSink>() // guarded by tapLock
    @Volatile private var carPlayDisplayPaused = false
    @Volatile private var airPlayRequested = false
    private var resourceController: CarPlayController? = null // worker only
    private var resourceSubscription: java.io.Closeable? = null // worker only
    private var displayAvailability: ((Boolean) -> Unit)? = null // guarded by tapLock
    private var pendingAirPlayEnd = false // guarded by tapLock
    @Volatile var airPlayDisplayReady = false
        private set

    /** Includes URL/photo preparation before a browser entry or mirror CONFIG is published. */
    val airPlayActive: Boolean get() = airPlayRequested || carPlayDisplayPaused

    /** Begin a resource loan. A write is not a grant; rendering waits for modesChanged. */
    fun pauseCarPlayDisplay(available: ((Boolean) -> Unit)? = null) {
        val releaseTouches = synchronized(tapLock) {
            val starting = !airPlayRequested
            airPlayRequested = true
            pendingAirPlayEnd = false
            if (available != null) displayAvailability = available
            starting
        }
        // Keep network writes off the receiver and main threads.
        worker.execute {
            if (releaseTouches) CarPlayBackgroundSession.snapshot()?.controller?.sendTouch(emptyList())
            reconcileCarPlayResources()
        }
    }

    fun resumeCarPlayDisplay() {
        synchronized(tapLock) {
            // A stale receiver callback must not revoke a newer display owner.
            if (hub.hasAirPlayDisplay() || com.shilapi.xcertplay.web.AirPlayBrowserPlayback.snapshot()?.get("resource") != null) return
            val wasActive = airPlayRequested
            airPlayRequested = false
            displayAvailability = null
            pendingAirPlayEnd = pendingAirPlayEnd || wasActive
        }
        worker.execute(::reconcileCarPlayResources)
    }

    private fun reconcileCarPlayResources() {
        val controller = CarPlayBackgroundSession.snapshot()?.controller?.takeUnless { it.isClosed() }
        if (resourceController !== controller) {
            resourceSubscription?.close()
            resourceController = controller
            resourceSubscription = controller?.listenScreenBorrow {
                worker.execute(::updateResourceOutputs)
            }
        }
        controller?.setScreenBorrowed(airPlayRequested)
        updateResourceOutputs()
    }

    private fun CarPlayScreenBorrowState?.pauseCarPlayResource(previous: Boolean): Boolean = when {
        this == null -> false
        pending -> previous // A request cannot change the actual output owner.
        owner == CarPlayScreenOwner.Accessory -> true
        owner == CarPlayScreenOwner.Controller -> false
        sent == null && !desired -> false
        else -> true
    }

    private fun updateResourceOutputs() {
        val snapshot = CarPlayBackgroundSession.snapshot()
        val screen = snapshot?.controller?.screenBorrowState
        var ended = false
        var releaseTouches = false
        val (ready, availability) = synchronized(tapLock) {
            val ready = airPlayRequested && (screen == null || screen.confirmedBorrow)
            ready to displayAvailability
        }
        // Release the AirPlay producer before asking the hub to begin CarPlay again.
        // Its priority otherwise rejects CarPlay and leaves the unpaused sink without a stream.
        if (!ready) availability?.invoke(false)
        synchronized(tapLock) {
            val pauseScreen = screen.pauseCarPlayResource(carPlayDisplayPaused) || ready
            if (carPlayDisplayPaused != pauseScreen) {
                carPlayDisplayPaused = pauseScreen
                releaseTouches = pauseScreen
                if (pauseScreen) taps.values.forEach { it.pauseDisplay() }
                else snapshot?.sink?.let { taps[it]?.resumeDisplay() }
            }
            airPlayDisplayReady = ready
            if (!airPlayRequested && !carPlayDisplayPaused && pendingAirPlayEnd) {
                pendingAirPlayEnd = false
                ended = true
            }
        }
        if (releaseTouches && screen != null) snapshot?.controller?.sendTouch(emptyList())
        if (ready) availability?.invoke(true)
        if (ended) main.post { if (!airPlayActive) host.get()?.onAirPlayEnded() }
    }
    private val statsLock = Any()

    // Worker thread only.
    private var server: Server? = null
    private var retry: ScheduledFuture<*>? = null
    private var failures = 0

    @Volatile private var app: Context? = null
    @Volatile private var code: String? = null
    private val carPlayReadiness = BrowserCarPlayReadiness { android.os.SystemClock.elapsedRealtime() }
    fun readyViewport(): BrowserViewport? = carPlayReadiness.readyViewport()
    fun audioCapabilities(): BrowserAudioCapabilities? = carPlayReadiness.liveViewport()?.audioCapabilities

    @Volatile private var viewport: BrowserViewport? = null
    @Volatile private var viewportLoaded = false
    private var viewportSession: String? = null // guarded by this; audio support belongs to this live page
    private var lastStatsLog: Long? = null
    private var lastStatsCounters = emptyMap<String, Long>() // guarded by statsLock

    /** What the server is doing; listeners hear every change on the link's thread. */
    @Volatile var state: State = State.Stopped
        private set

    /** True between [start] and [stop]: the link is listening, or binding, or waiting to retry. */
    val active: Boolean get() = requested.get()

    fun listeningPort(context: Context): Int = (state as? State.Listening)?.port ?: BrowserEndpointSettings.port(context)

    /** The driver saved another port: restart the browser listener without reconnecting CarPlay. */
    fun onPortChanged() {
        if (requested.get()) worker.execute {
            server?.let { stopQuietly(it) }
            server = null
            publish(State.Stopped)
            reconcile()
        }
    }

    fun addListener(listener: (State) -> Unit) { listeners += listener }

    fun removeListener(listener: (State) -> Unit) { listeners -= listener }

    /** The run mode in effect is phone + browser: a running session keeps the mode it connected with. */
    fun wanted(context: Context): Boolean =
        AirPlayPersistence.isPhoneBrowserMode(context, CarPlayBackgroundSession.snapshot()?.controller)

    /** Starts the link when it is [wanted], otherwise stops it. Cheap and idempotent; safe from any lifecycle callback. */
    fun sync(context: Context) {
        if (wanted(context)) start(context) else stop()
    }

    /** Idempotent. Creates the pairing code on first use; the socket work happens on the link's thread. */
    fun start(context: Context) {
        val app = context.applicationContext
        DiagnosticLogs.initialize(app, AirPlayPersistence.loadDiagnosticLogLevel(app))
        this.app = app
        pairingCode(app)
        lastViewport(app)
        if (requested.compareAndSet(false, true)) worker.execute(::reconcile)
    }

    /** Idempotent. Ends the browser's video and touches and frees the port, on the link's thread. */
    fun stop() {
        if (requested.compareAndSet(true, false)) worker.execute(::reconcile)
    }

    fun attachHost(host: Host) {
        this.host.set(host)
        main.post { if (this.host.get() === host) host.onBrowserTheme(BrowserAppearance.night) }
    }

    fun detachHost(host: Host) {
        this.host.compareAndSet(host, null)
    }

    /**
     * The engine's sink for a new session: in phone + browser mode video bypasses the Android [sink] and feeds the main
     * screen into [hub]; otherwise [sink] itself. [width] × [height] is the negotiated canvas.
     */
    fun tee(sink: MediaSink, phoneBrowser: Boolean, width: Int, height: Int, fps: Int = TeslaBrowserCanvas.FPS): MediaSink {
        if (!phoneBrowser) return sink
        val replacement = synchronized(tapLock) {
            val web = WebMediaSink(hub, width, height, fps)
            if (carPlayDisplayPaused) web.pauseDisplay()
            taps[sink] = web
            audioHub.carPlayEnabled = app?.let { !BrowserCarPlayAudioSettings.disabled(it) } ?: true
            val audio = BrowserAudioMediaSink(web, audioHub,
                voiceFactory = app?.let { context -> BluetoothVoiceFactory { state -> AndroidBluetoothVoiceChannel(context, state) } })
            val previous = audioTaps.put(sink, audio)
            BrowserOnlyMediaSink(sink, audio) to previous
        }
        replacement.second?.close()
        return replacement.first
    }

    /** Ends the browser's stream of [sink]'s session, which is being retired; the next session starts a new one. */
    fun releaseTap(sink: MediaSink) {
        val retired = synchronized(tapLock) { audioTaps.remove(sink) to taps.remove(sink) }
        retired.first?.close()
        retired.second?.close()
    }

    /** A retained wireless engine starts its next stream with the replacement display's negotiated canvas. */
    fun updateCanvas(sink: MediaSink, width: Int, height: Int) {
        val tap = synchronized(tapLock) { taps[sink] }
        tap?.updateCanvas(width, height)
    }

    /** The 4-digit pairing code; created (SecureRandom) and saved the first time. */
    fun pairingCode(context: Context): String {
        code?.let { return it }
        synchronized(this) {
            code?.let { return it }
            val prefs = prefs(context)
            val value = prefs.getString(KEY_PAIRING_CODE, null)?.takeIf(::isCode)
                ?: newCode().also { prefs.edit().putString(KEY_PAIRING_CODE, it).apply() }
            code = value
            return value
        }
    }

    fun hasPairingCode(context: Context): Boolean =
        code != null || prefs(context).getString(KEY_PAIRING_CODE, null)?.let(::isCode) == true

    /** Replaces the pairing code and ends the current browser session: the server restarts and refuses the old code. */
    fun newPairingCode(context: Context): String {
        val value = synchronized(this) {
            val previous = code ?: prefs(context).getString(KEY_PAIRING_CODE, null)
            var replacement: String
            do { replacement = newCode() } while (replacement == previous)
            prefs(context).edit().putString(KEY_PAIRING_CODE, replacement).apply()
            code = replacement
            replacement
        }
        log("Browser link: new pairing code; the browser must pair again")
        if (requested.get()) worker.execute {
            server?.let { stopQuietly(it) }
            server = null
            reconcile()
        }
        return value
    }

    /** The browser's last valid viewport, kept for the next connection; null before any browser reported one. */
    fun lastViewport(context: Context): BrowserViewport? {
        if (viewportLoaded) return viewport
        synchronized(this) {
            if (!viewportLoaded) {
                viewport = loadViewport(context)
                viewportLoaded = true
            }
        }
        return viewport
    }

    /** Ordinary AirPlay saves resize requests for its next session, independently of CarPlay reconnects. */
    fun listenViewport(context: Context, listener: (BrowserViewport?) -> Unit): AutoCloseable {
        viewportListeners += listener
        listener(lastViewport(context))
        return AutoCloseable { viewportListeners -= listener }
    }

    /** The HTTPS page the links open; [TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS] unless the driver hosts their own. */
    fun pageAddress(context: Context): String =
        TeslaBrowserPageLinks.savedPageAddress(prefs(context).getString(KEY_PAGE_ADDRESS, null))

    /**
     * Saves [text] when it is a valid page address ([TeslaBrowserPageLinks.pageAddress]); false otherwise. The default
     * is not stored, so a dialog saved unchanged follows the default of a later build.
     */
    fun savePageAddress(context: Context, text: String): Boolean {
        val address = TeslaBrowserPageLinks.pageAddress(text) ?: return false
        val editor = prefs(context).edit()
        if (TeslaBrowserPageLinks.savedPageAddress(address) == TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS) {
            editor.remove(KEY_PAGE_ADDRESS)
        } else {
            editor.putString(KEY_PAGE_ADDRESS, address)
        }
        editor.apply()
        return true
    }

    /**
     * The address the car's browser reaches the phone at: the extra hotspot address when the driver set one, else
     * [hotspotAddress], the hotspot's own IPv4 that the caller looked up off the main thread; null when neither is known.
     */
    fun browserAddress(context: Context, hotspotAddress: String?): String? =
        if (HotspotExtraAddressSettings.enabled(context)) HotspotExtraAddressSettings.address(context).hostAddress else hotspotAddress

    /**
     * The link for the Tesla and other Chromium browsers, naming the phone at [browserAddress] in `?t=` unless it is the
     * page's default phone. Creates the pairing code if needed; no network access.
     */
    fun pageLink(context: Context, hotspotAddress: String?): String = TeslaBrowserPageLinks.pageLink(
        pageAddress(context), pairingCode(context),
        browserAddress(context, hotspotAddress) ?: TeslaBrowserPageLinks.PAGE_DEFAULT_PHONE_ADDRESS, listeningPort(context))

    /**
     * Why CarPlay should reconnect for the browser's "Apply and reconnect", or null when it should not: no session runs
     * on [running], or its canvas already matches the browser's within 8 px and 1 % in aspect.
     */
    fun fitReason(context: Context, running: BrowserSize?): String? {
        if (running == null) {
            log("Browser link: the browser asked to fit, but no CarPlay session is running")
            return null
        }
        val wanted = TeslaBrowserCanvas.sizeFor(lastViewport(context))
        if (!TeslaBrowserCanvas.differs(running, wanted)) {
            log("Browser link: CarPlay already fits the browser (${running.width}x${running.height})")
            return null
        }
        return "Browser asked to fit: reconnecting CarPlay at ${wanted.width}x${wanted.height} " +
            "(was ${running.width}x${running.height})"
    }

    /** For the diagnostic report: no code, no address. */
    fun diagnosticLines(context: Context): List<String> {
        val link = when (val current = state) {
            is State.Listening -> "listening(port=${current.port})"
            State.PortInUse -> "port-in-use"
            State.Failed -> "failed"
            State.Stopped -> if (active) "starting" else "stopped"
        }
        val size = lastViewport(context)?.let { "${it.width}x${it.height}" } ?: "none"
        return listOf(
            "Run mode (saved; a running session keeps the mode it connected with): " +
                if (AirPlayPersistence.isPhoneBrowserMode(context)) "phone-browser" else "head-unit",
            "Browser link: state=$link lastViewport=$size pairingCode=${if (hasPairingCode(context)) "yes" else "no"} " +
                "localNetworkPermission=${LocalNetworkPermission.state(context).wire} " +
                "customPage=${pageAddress(context) != TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS}",
        )
    }

    /** What the page shows (protocol §4.2). Called on server threads; never blocks. */
    internal fun status(): BrowserLinkStatus {
        val info = hub.info()
        val snapshot = CarPlayBackgroundSession.snapshot()
        val state = when {
            info != null -> BrowserLinkStatus.State.STREAMING
            CarPlayBackgroundSession.hasSession() -> BrowserLinkStatus.State.CONNECTING
            else -> BrowserLinkStatus.State.IDLE
        }
        val app = app
        return BrowserLinkStatus(
            state = state,
            codec = info?.codec,
            display = info?.let { BrowserSize(it.width, it.height) } ?: snapshot?.display?.let { BrowserSize(it.width, it.height) },
            // The canvas "Apply and reconnect" would ask for, so the page offers it only when a reconnect changes something.
            viewport = viewport?.let { TeslaBrowserCanvas.sizeFor(it) },
            touchAvailable = !carPlayDisplayPaused && snapshot != null && CarPlayBackgroundSession.active,
            phone = linkedMapOf("localNetworkPermission" to (app?.let { LocalNetworkPermission.state(it).wire })),
            receivers = mapOf(
                "carplay" to if (app?.let(BrowserCarPlaySettings::disabled) == true)
                    mapOf("state" to "disabled") else carPlayReceiver,
                "airplay" to mapOf("state" to if (app?.let(AirPlayReceiverSettings::isDisabled) == true)
                    "disabled" else AirPlayReceiverService.state),
            ),
            videoSource = info?.source?.name?.lowercase(Locale.ROOT),
        )
    }

    /** One line for the session log at most every 10 s: numbers and short names only. */
    internal fun statsLine(stats: Map<String, Any?>): String = buildString {
        append("Browser:")
        for ((label, key) in STATS_FIELDS) append(' ').append(label).append('=').append(statValue(stats[key]))
    }

    private val callbacks = object : BrowserLinkServer.Callbacks {
        override fun browserLocationEnabled(): Boolean = app?.let {
            !com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(it)
        } == true
        override fun code(): String? = code
        override fun status(): BrowserLinkStatus = this@TeslaBrowserLink.status()
        override fun onTouch(contacts: List<AirPlayContact>): Boolean =
            if (carPlayDisplayPaused) false else CarPlayBackgroundSession.snapshot()?.controller?.sendTouch(contacts) ?: false
        override fun onBrowserSeen(session: String) = synchronized(this@TeslaBrowserLink) {
            carPlayReadiness.seen(session)
            if (viewportSession != session) {
                viewportSession = session
                clearViewportAudio()
            }
        }
        override fun onBrowserGone(session: String) {
            synchronized(this@TeslaBrowserLink) {
                carPlayReadiness.gone(session)
                if (viewportSession == session) {
                    viewportSession = null
                    clearViewportAudio()
                }
            }
            main.post { host.get()?.onBrowserGone() }
        }
        override fun onViewport(viewport: BrowserViewport) = viewportChanged(viewport)
        override fun onFit() {
            if (airPlayActive) return
            main.post {
                val screen = host.get()
                if (screen == null) log("Browser link: the browser asked to fit, but no CarPlay screen is open")
                else screen.onBrowserFit()
            }
        }
        override fun onKey(name: String) {
            if (carPlayDisplayPaused) return
            val controller = CarPlayBackgroundSession.snapshot()?.controller ?: return
            when (name) {
                "home" -> controller.sendKnob(AirPlayKnobState(home = true))
                "back" -> controller.sendKnob(AirPlayKnobState(back = true))
                "siri" -> controller.requestSiri()
            }
        }
        override fun onBrowserStats(stats: Map<String, Any?>) {
            val reportedNight = stats["themeDark"] as? Boolean
            if (reportedNight != null) main.post {
                // Cache and deliver in the same order, even with concurrent browser requests.
                BrowserAppearance.update(mapOf("themeDark" to reportedNight))
                val screen = host.get()
                if (screen != null) screen.onBrowserTheme(reportedNight)
                else CarPlayBackgroundSession.snapshot()?.controller
                    ?.takeIf { it.phoneBrowserMode() }?.sendNightMode(reportedNight)
            }
            val now = clock()
            val anomalies: Map<String, Long>
            synchronized(statsLock) {
                val last = lastStatsLog
                if (last != null && now - last < STATS_LOG_INTERVAL_MILLIS) return
                lastStatsLog = now
                val counters = mapOf(
                    "dropped" to counter(stats["video.droppedFrames"] ?: stats["video.dropped"]),
                    "errors" to counter(stats["video.decodeErrors"]),
                    "gaps" to counter(stats["video.gaps"]),
                    "reconnects" to counter(stats["link.reconnects"]),
                    "audioProcessorErrors" to counter(stats["audio.processorErrors"]),
                    "audioRecoveries" to counter(stats["audio.recoveries"]),
                )
                anomalies = counters.mapValues { (key, value) ->
                    (value - (lastStatsCounters[key] ?: 0L)).coerceAtLeast(0L)
                }.filterValues { it > 0 }
                lastStatsCounters = counters
            }
            if (DiagnosticLogPolicy.level == DiagnosticLogLevel.DEBUG) log(statsLine(stats))
            else if (anomalies.isNotEmpty()) log("Browser anomaly: " +
                anomalies.entries.joinToString(" ") { (key, count) -> "$key=$count" })
        }
        override fun onBrowserAudioDiagnostics(stats: Map<String, Any?>) {
            if (DiagnosticLogPolicy.level != DiagnosticLogLevel.DEBUG ||
                !com.shilapi.xcertplay.diagnostics.RawTraffic.enabled) return
            BrowserAudioDiagnostics.lines(stats).forEach(::log)
        }
        override fun onBrowserVideoDiagnostics(stats: Map<String, Any?>) {
            if (DiagnosticLogPolicy.level != DiagnosticLogLevel.DEBUG ||
                !com.shilapi.xcertplay.diagnostics.RawTraffic.enabled) return
            BrowserVideoDiagnostics.lines(stats).forEach(::log)
        }
        override fun log(message: String) = this@TeslaBrowserLink.log(message)
    }

    private fun reconcile() {
        retry?.cancel(false)
        retry = null
        if (!requested.get()) {
            server?.let { stopQuietly(it) }
            server = null
            failures = 0
            publish(State.Stopped)
            return
        }
        if (server != null) return
        val candidate = try {
            serverFactory.create(hub, callbacks)
        } catch (error: Exception) {
            log("Browser link: server could not be created (${error.javaClass.simpleName})")
            null
        }
        val result = candidate?.start() ?: Result.failure(IllegalStateException("no server"))
        val port = result.getOrNull()
        if (candidate != null && port != null) {
            server = candidate
            failures = 0
            publish(State.Listening(port))
            return
        }
        candidate?.let { stopQuietly(it) }
        publish(if (result.exceptionOrNull() is BindException) State.PortInUse else State.Failed)
        retry = worker.schedule(::reconcile, backoffMillis(failures++), TimeUnit.MILLISECONDS)
    }

    private fun publish(next: State) {
        if (state == next) return
        state = next
        Log.i(TAG, "state=$next")
        persistDiagnostic("Browser link: state=$next")
        for (listener in listeners) {
            try {
                listener(next)
            } catch (error: RuntimeException) {
                Log.w(TAG, "listener failed", error)
            }
        }
    }

    private fun viewportChanged(report: BrowserViewport): Unit = synchronized(this) {
        // Resize reports can precede the async decoder probe. Preserve only this page's known audio support.
        val next = if (report.audioCapabilities == null && viewportSession != null)
            report.copy(audioCapabilities = viewport?.audioCapabilities) else report
        val alreadyReady = readyViewport() != null
        carPlayReadiness.report(next)
        val changed = next != viewport
        if (!changed && alreadyReady) return
        viewport = next
        viewportLoaded = true
        if (changed) app?.let { saveViewport(it, next) }
        log("Browser link: viewport ${TeslaBrowserCanvas.describe(next)}")
        notifyViewport(next)
        main.post { host.get()?.onBrowserViewport(next) }
    }

    /** Audio probes are never saved or carried into another browser session. Called under this monitor. */
    private fun clearViewportAudio() {
        val previous = viewport ?: return
        if (previous.audioCapabilities == null) return
        val cleared = previous.copy(audioCapabilities = null)
        viewport = cleared
        notifyViewport(cleared)
    }

    private fun notifyViewport(next: BrowserViewport?) {
        viewportListeners.forEach { listener ->
            runCatching { listener(next) }.onFailure { Log.w(TAG, "viewport listener failed", it) }
        }
    }

    private fun log(message: String) {
        val safe = DiagnosticRedactor.redact(message) ?: return
        if (!DiagnosticLogPolicy.shouldRecord(safe)) return
        Log.i(TAG, safe)
        persistDiagnostic(safe)
    }

    /** Keep receiver metadata in the saved report when host logcat is unavailable. */
    internal fun persistDiagnostic(message: String) {
        val screen = host.get()
        if (screen != null) screen.log(message) else DiagnosticLogs.append(message)
    }

    private fun stopQuietly(server: Server) {
        synchronized(this) {
            carPlayReadiness.clear()
            viewportSession = null
            clearViewportAudio()
        }
        try {
            server.stop()
        } catch (error: RuntimeException) {
            Log.w(TAG, "server stop failed", error)
        }
    }

    private fun loadViewport(context: Context): BrowserViewport? {
        val prefs = prefs(context)
        val width = prefs.getInt(KEY_VIEWPORT_WIDTH, 0)
        val height = prefs.getInt(KEY_VIEWPORT_HEIGHT, 0)
        if (!BrowserViewport.isValid(width, height)) return null
        return BrowserViewport(width, height, prefs.getFloat(KEY_VIEWPORT_CSS_WIDTH, 0f).toDouble(),
            prefs.getFloat(KEY_VIEWPORT_CSS_HEIGHT, 0f).toDouble(), prefs.getFloat(KEY_VIEWPORT_DPR, 0f).toDouble())
    }

    private fun saveViewport(context: Context, viewport: BrowserViewport) {
        prefs(context).edit()
            .putInt(KEY_VIEWPORT_WIDTH, viewport.width)
            .putInt(KEY_VIEWPORT_HEIGHT, viewport.height)
            .putFloat(KEY_VIEWPORT_CSS_WIDTH, viewport.cssWidth.toFloat())
            .putFloat(KEY_VIEWPORT_CSS_HEIGHT, viewport.cssHeight.toFloat())
            .putFloat(KEY_VIEWPORT_DPR, viewport.devicePixelRatio.toFloat())
            .apply()
    }

    private fun newCode(): String = String.format(Locale.ROOT, "%04d", random.nextInt(10_000))

    private fun isCode(value: String): Boolean = value.length == 4 && value.all { it in '0'..'9' }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun counter(value: Any?): Long = (value as? Number)?.toDouble()
        ?.takeIf { it.isFinite() && it >= 0.0 }?.toLong() ?: 0L

    private fun statValue(value: Any?): String = when (value) {
        is Number -> value.toDouble().let { number ->
            when {
                !number.isFinite() -> "-"
                number == floor(number) && abs(number) < 1e12 -> number.toLong().toString()
                else -> String.format(Locale.ROOT, "%.1f", number)
            }
        }
        is Boolean -> value.toString()
        is String -> value.takeIf(SAFE_TEXT::matches) ?: "?"
        else -> "-"
    }

    /** Tests: stop, wait for the link's thread and forget what this process cached. */
    internal fun resetForTest() {
        carPlayReceiver = mapOf("state" to "preparing")
        stop()
        awaitIdle()
        synchronized(this) {
            code = null
            carPlayReadiness.clear()
            viewportSession = null
            viewport = null
            viewportLoaded = false
        }
        synchronized(statsLock) { lastStatsLog = null; lastStatsCounters = emptyMap() }
        host.set(null)
        listeners.clear()
        viewportListeners.clear()
        val retired = synchronized(tapLock) {
            val previous = audioTaps.values.toList() to taps.values.toList()
            audioTaps.clear()
            taps.clear()
            carPlayDisplayPaused = false
            airPlayRequested = false
            airPlayDisplayReady = false
            displayAvailability = null
            pendingAirPlayEnd = false
            previous
        }
        retired.first.forEach { it.close() }
        retired.second.forEach { it.close() }
        resourceSubscription?.close(); resourceSubscription = null; resourceController = null
        audioHub.enabled = true
        audioHub.carPlayEnabled = true
        app = null
    }

    /** Tests: waits until the link's thread has run everything queued so far (not a retry scheduled for later). */
    internal fun awaitIdle(timeoutMillis: Long = 5_000): Boolean {
        val done = CountDownLatch(1)
        worker.execute { done.countDown() }
        return done.await(timeoutMillis, TimeUnit.MILLISECONDS)
    }
}
