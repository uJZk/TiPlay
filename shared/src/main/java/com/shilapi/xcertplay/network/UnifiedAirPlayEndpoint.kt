package com.shilapi.xcertplay.network

import android.content.Context
import android.net.wifi.WifiManager
import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDeviceInfo
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayInfoPlist
import com.shilapi.xcertplay.airplay.AirPlayListenerIdentity
import com.shilapi.xcertplay.airplay.AirPlayMediaHandler
import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.airplay.AirPlaySessionListener
import com.shilapi.xcertplay.airplay.AirPlayTcpAccepted
import com.shilapi.xcertplay.airplay.PairingStore
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.airplay.isInternalAirPlayPeer
import com.shilapi.xcertplay.mfi.MfiAuthenticator
import com.shilapi.xcertplay.receiver.ReceiverBonjour
import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverServer
import com.shilapi.xcertplay.receiver.readReceiverRequest
import java.io.BufferedInputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** The ordinary receiver and a CarPlay run lease one entry; the last release closes it. */
class UnifiedAirPlayEndpoint(
    receiver: ReceiverServer?,
    receiverConfig: ReceiverConfig,
    appContext: Context,
    private val log: (String) -> Unit,
) : Closeable {
    private data class OrdinaryBackend(val receiver: ReceiverServer, val config: ReceiverConfig)
    private data class CarPlayContext(
        val token: Any, val config: AirPlayConfig, val identity: AirPlayIdentity,
        val pairings: PairingStore, val mfi: MfiAuthenticator?,
        val listener: AirPlaySessionListener, val media: AirPlayMediaHandler,
        val listenerIdentity: AirPlayListenerIdentity?,
    )
    private class Hosted(val socket: Socket, val token: Any?) {
        @Volatile var session: AirPlaySession? = null
        var acceptedEvent: AirPlayTcpAccepted? = null
        val acceptedForwarded = AtomicBoolean(false)
        val finished = AtomicBoolean(false)
    }
    private val lock = Any()
    private var pendingAttach = 0 // protected by lock; replacement cannot briefly become unowned
    private val closed = AtomicBoolean(false)
    private val hosted = ConcurrentHashMap<Socket, Hosted>()
    private val slots = Semaphore(24)
    private val worker = Executors.newSingleThreadScheduledExecutor {
        Thread(it, "tiplay-shared-discovery").apply { isDaemon = true }
    }
    @Volatile private var context: CarPlayContext? = null
    @Volatile private var ordinaryBackend: OrdinaryBackend? = receiver?.let { OrdinaryBackend(it, receiverConfig) }
    // Retained only while synchronously closing that run's CarPlay sessions.
    private val closingContexts = mutableMapOf<Any, CarPlayContext>()
    @Volatile private var advertisedConfig = receiverConfig
    private val multicast = appContext.getSystemService(WifiManager::class.java)
        ?.createMulticastLock("tiplay-shared-airplay")?.apply { setReferenceCounted(false) }
    private var server: ServerSocket? = null
    private var discovery: ReceiverBonjour? = null
    val port: Int get() = requireNotNull(server).localPort

    fun start(preferredPort: Int = 7000): Int {
        check(!closed.get() && server == null)
        val bound = AirPlayPortSelector.bind(InetAddress.getByName("::"), preferredPort) { _, _ ->
            log("sharedEntry stage=FALLBACK_PORT")
        }
        server = bound
        discovery = ReceiverBonjour(advertisedConfig, bound.localPort, { advertisedConfig }, ::txtRecords)
        synchronized(companionLock) {
            check(current == null) { "Shared AirPlay entry already running" }
            current = this
        }
        multicast?.acquire()
        worker.scheduleWithFixedDelay({
            if (!closed.get() && (ordinaryBackend != null || context != null)) runCatching { discovery?.refresh() }.onFailure {
                log("sharedEntry stage=DISCOVERY_FAILED")
            }
        }, 0, 5, TimeUnit.SECONDS)
        Thread({ accept(bound) }, "tiplay-shared-entry").apply { isDaemon = true; start() }
        log("sharedEntry stage=LISTENING")
        return bound.localPort
    }

    fun attach(
        token: Any, config: AirPlayConfig, identity: AirPlayIdentity, pairings: PairingStore,
        mfi: MfiAuthenticator?, listener: AirPlaySessionListener, media: AirPlayMediaHandler,
        listenerIdentity: AirPlayListenerIdentity?,
    ): Int {
        val previous = synchronized(lock) {
            check(!closed.get())
            require(sameIdentity(identity)) { "Shared identity mismatch" }
            pendingAttach++
            context
        }
        try {
            previous?.let { detachContext(it.token, releaseEntry = false) }
            synchronized(lock) {
                check(!closed.get())
                context = CarPlayContext(token, config.copy(port = port), identity, pairings, mfi, listener, media, listenerIdentity)
                // Wireless CarPlay supplies the hotspot's device identifier. Keep its alias after disconnect.
                advertisedConfig = advertisedConfig.copy(deviceId = config.deviceId)
            }
            refreshSoon()
            log("sharedEntry stage=CARPLAY_ATTACHED")
            return port
        } finally {
            releaseAttachReservation()
        }
    }

    fun detach(token: Any) = detachContext(token, releaseEntry = true)

    private fun detachContext(token: Any, releaseEntry: Boolean) {
        val retiring = synchronized(lock) {
            val existing = context?.takeIf { it.token === token } ?: return
            context = null
            closingContexts[token] = existing
            existing
        }
        try {
            hosted.values.filter { it.token === token && it.session?.isUnifiedOrdinary != true }
                .forEach { hostedSession ->
                    hostedSession.session?.close() ?: runCatching { hostedSession.socket.close() }
                }
        } finally {
            synchronized(lock) { closingContexts.remove(retiring.token) }
        }
        log("sharedEntry stage=CARPLAY_DETACHED")
        if (releaseEntry) closeIfUnowned()
    }

    fun addReceiver(receiver: ReceiverServer, config: ReceiverConfig) {
        synchronized(lock) {
            check(!closed.get())
            require(sameIdentity(config.identity)) { "Shared identity mismatch" }
            ordinaryBackend = OrdinaryBackend(receiver, config)
            advertisedConfig = config.copy(deviceId = advertisedConfig.deviceId)
        }
        refreshSoon()
    }

    fun releaseReceiver(receiver: ReceiverServer) {
        val retiring = synchronized(lock) {
            if (ordinaryBackend?.receiver !== receiver) return
            ordinaryBackend = null
            // Accept/addReceiver use this lock too. Retiring this backend cannot close a replacement's sockets.
            hosted.values.filter { it.session?.isUnifiedCarPlay != true }.toList()
        }
        // Unknown connections may still hold a factory for this receiver; a selected CarPlay dialect cannot use it.
        retiring.forEach {
            if (it.session?.isUnifiedCarPlay != true) {
                it.session?.close() ?: runCatching { it.socket.close() }
            }
        }
        refreshSoon()
        closeIfUnowned()
        log("sharedEntry stage=ORDINARY_RELEASED")
    }

    private fun refreshSoon() {
        try {
            if (!closed.get()) worker.execute { if (!closed.get()) runCatching { discovery?.refresh() } }
        } catch (_: RejectedExecutionException) {
            // The last lease closed the entry between the check and submission; cleanup must still finish.
        }
    }

    internal fun closeIfUnowned() = close(requireUnowned = true)

    internal fun releaseAttachReservation() {
        synchronized(lock) { check(pendingAttach > 0); pendingAttach-- }
        closeIfUnowned()
    }

    private fun sameIdentity(identity: AirPlayIdentity): Boolean {
        val expected = advertisedConfig.identity
        return identity.pairingId == expected.pairingId && identity.publicKey.contentEquals(expected.publicKey) &&
            identity.privateKey.contentEquals(expected.privateKey)
    }

    private fun txtRecords(): Map<String, String> {
        ordinaryBackend?.let { return it.config.copy(deviceId = advertisedConfig.deviceId).txt }
        val carPlay = context ?: return emptyMap()
        return linkedMapOf(
            "deviceid" to carPlay.config.deviceId,
            "features" to CarPlayBonjourProtocol.featuresTxt(AirPlayInfoPlist.features(carPlay.config)),
            "flags" to "0x4", "model" to carPlay.config.model, "srcvers" to carPlay.config.sourceVersion,
            "protovers" to "1.1", "pi" to carPlay.identity.pairingId, "pk" to carPlay.identity.publicKeyHex,
        )
    }

    fun prepareDisplayReconnect(token: Any, display: AirPlayDisplayConfig, expected: AirPlaySession): (() -> Unit)? {
        synchronized(lock) {
            val existing = context?.takeIf { it.token === token } ?: return null
            if (expected.isClosed || hosted.values.none { it.token === token && it.session === expected }) return null
            val peer = expected.remoteAddress ?: return null
            val local = expected.localAddress ?: return null
            if (isInternalAirPlayPeer(peer, local)) return null
            context = existing.copy(config = existing.config.copy(main = display))
            return { expected.close() }
        }
    }

    fun updatePendingDisplay(token: Any, display: AirPlayDisplayConfig, retiring: AirPlaySession): Boolean {
        synchronized(lock) {
            val existing = context?.takeIf { it.token === token } ?: return false
            val replacement = hosted.values.any {
                val session = it.session
                it.token === token && session != null && session !== retiring &&
                    !session.isClosed && !session.isUnifiedOrdinary &&
                    session.remoteAddress?.let { peer -> session.localAddress?.let { local ->
                        !isInternalAirPlayPeer(peer, local)
                    } } == true
            }
            if (replacement) return false
            context = existing.copy(config = existing.config.copy(main = display))
            return true
        }
    }

    private fun contextFor(token: Any): CarPlayContext? = synchronized(lock) {
        context?.takeIf { it.token === token } ?: closingContexts[token]
    }

    private fun carPlayContextFor(token: Any, session: AirPlaySession): CarPlayContext? =
        if (session.isUnifiedCarPlay) contextFor(token) else null

    private fun finish(host: Hosted) {
        if (host.finished.compareAndSet(false, true)) {
            hosted.remove(host.socket, host)
            slots.release()
        }
    }

    private fun accept(bound: ServerSocket) {
        try {
            while (!closed.get()) {
                val socket = bound.accept()
                val acceptedAtNanos = System.nanoTime()
                if (!slots.tryAcquire()) { socket.close(); continue }
                val host = synchronized(lock) {
                    if (closed.get()) { socket.close(); slots.release(); return }
                    val selected = context
                    val created = Hosted(socket, selected?.token)
                    hosted[socket] = created
                    try {
                        socket.tcpNoDelay = true
                        socket.keepAlive = true
                        if (selected != null) {
                            val internal = isInternalAirPlayPeer(socket.inetAddress, socket.localAddress)
                            created.acceptedEvent = selected.listenerIdentity?.let {
                                AirPlayTcpAccepted(it, internal, acceptedAtNanos)
                            }
                            created.session = AirPlaySession(socket, selected.config, selected.identity,
                                selected.pairings, selected.mfi, listener(created, selected.token, internal), media(selected.token))
                        }
                    } catch (error: Exception) {
                        socket.close(); finish(created)
                        log("sharedEntry stage=ACCEPT_FAILED")
                    }
                    created
                }
                if (host.finished.get()) continue
                host.session?.start() ?: Thread({ ordinary(host) }, "tiplay-shared-ordinary")
                    .apply { isDaemon = true; start() }
            }
        } catch (_: Exception) {
            if (!closed.get()) log("sharedEntry stage=LISTENER_FAILED")
        }
    }

    private fun ordinary(host: Hosted) {
        try {
            val selected = checkNotNull(ordinaryBackend) { "Ordinary receiver unavailable" }
            selected.receiver.openConnection(host.socket, selected.config.features, advertisedConfig.deviceId).use { connection ->
                TcpLiveness.configure(host.socket) {}
                val input = BufferedInputStream(host.socket.getInputStream())
                val output = host.socket.getOutputStream()
                while (!closed.get() && !host.socket.isClosed) {
                    val request = readReceiverRequest(input) ?: break
                    if (request.method.startsWith("HTTP/")) continue
                    val response = connection.handle(request)
                    synchronized(output) {
                        output.write(RtspMessage.buildResponse(request, response.copy(
                            headers = response.headers + ("Server" to "AirTunes/220.68"))))
                        output.flush()
                        connection.responseSent(response)
                    }
                    if (response.headers["Connection"] == "close") break
                }
            }
        } catch (_: Exception) {
            if (!closed.get()) log("sharedEntry stage=ORDINARY_CLOSED")
        } finally {
            runCatching { host.socket.close() }
            finish(host)
        }
    }

    // Proxies retain only the entry and token, never a controller from an expired run.
    private fun listener(host: Hosted, token: Any, internal: Boolean) = object : AirPlaySessionListener {
        override fun onControlProtocolSelected(session: AirPlaySession) {
            if (!session.isUnifiedCarPlay) return
            val selected = synchronized(lock) { context?.takeIf { it.token === token } } ?: return
            if (!host.acceptedForwarded.compareAndSet(false, true)) return
            host.acceptedEvent?.let { selected.listener.onTcpAccepted(it) }
            selected.listener.onControlProtocolSelected(session)
        }
        override fun onSessionActive(session: AirPlaySession) {
            carPlayContextFor(token, session)?.let { if (it.listenerIdentity == null || !internal) it.listener.onSessionActive(session) }
        }
        override fun onSessionEnded(session: AirPlaySession) {
            finish(host)
            if (session.isUnifiedCarPlay) contextFor(token)?.let {
                if (it.listenerIdentity == null || !internal) it.listener.onSessionEnded(session)
            }
        }
        override fun onVideoFrameRendered(session: AirPlaySession) { carPlayContextFor(token, session)?.listener?.onVideoFrameRendered(session) }
        override fun onDeviceInfo(session: AirPlaySession, info: AirPlayDeviceInfo) { carPlayContextFor(token, session)?.listener?.onDeviceInfo(session, info) }
        override fun onHostUiRequested(session: AirPlaySession) { carPlayContextFor(token, session)?.listener?.onHostUiRequested(session) }
        override fun onCommand(session: AirPlaySession, type: String, params: Map<String, Any?>) { carPlayContextFor(token, session)?.listener?.onCommand(session, type, params) }
        override fun onRemoteControlMessage(session: AirPlaySession, streamId: Long, message: Map<String, Any?>) { carPlayContextFor(token, session)?.listener?.onRemoteControlMessage(session, streamId, message) }
        override fun onVideoPlaybackUiRequested(session: AirPlaySession) { carPlayContextFor(token, session)?.listener?.onVideoPlaybackUiRequested(session) }
        override fun onDebugLog(message: String) {
            if (host.session?.isUnifiedCarPlay == true) contextFor(token)?.listener?.onDebugLog(message)
        }
    }

    private fun media(token: Any) = object : AirPlayMediaHandler {
        override fun onScreen(session: AirPlaySession, type: Int, stream: Map<String, Any?>) = carPlayContextFor(token, session)?.media?.onScreen(session, type, stream)
        override fun onAudio(session: AirPlaySession, type: Int, stream: Map<String, Any?>) = carPlayContextFor(token, session)?.media?.onAudio(session, type, stream)
        override fun onDataStream(session: AirPlaySession, stream: Map<String, Any?>) = carPlayContextFor(token, session)?.media?.onDataStream(session, stream)
        override fun onBufferedAudio(session: AirPlaySession, stream: Map<String, Any?>) = carPlayContextFor(token, session)?.media?.onBufferedAudio(session, stream)
        override fun onBufferedAudioControl(session: AirPlaySession, method: String, body: Map<String, Any?>) = carPlayContextFor(token, session)?.media?.onBufferedAudioControl(session, method, body)
        override fun onFeedback(session: AirPlaySession) = carPlayContextFor(token, session)?.media?.onFeedback(session)
        override fun onTeardown(session: AirPlaySession, type: Int) { carPlayContextFor(token, session)?.media?.onTeardown(session, type) }
        override fun onSessionClosed(session: AirPlaySession) {
            if (session.isUnifiedCarPlay) contextFor(token)?.media?.onSessionClosed(session)
        }
        override fun onSetupResponseSent(session: AirPlaySession) { carPlayContextFor(token, session)?.media?.onSetupResponseSent(session) }
    }

    override fun close() = close(requireUnowned = false)

    private fun close(requireUnowned: Boolean) {
        // Use the same lock order as acquire -> addReceiver, so shutdown cannot race a new lease.
        synchronized(companionLock) {
            synchronized(lock) {
                if (requireUnowned && (ordinaryBackend != null || context != null || pendingAttach > 0)) return
                if (!closed.compareAndSet(false, true)) return
                ordinaryBackend = null
                if (current === this) current = null
            }
        }
        context?.let { detach(it.token) }
        runCatching { server?.close() }
        hosted.values.forEach { it.session?.close() ?: runCatching { it.socket.close() } }
        worker.execute {
            try { discovery?.close(); discovery = null }
            finally { runCatching { if (multicast?.isHeld == true) multicast.release() } }
        }
        worker.shutdown()
        log("sharedEntry stage=STOPPED")
    }

    companion object {
        private val companionLock = Any()
        @Volatile var current: UnifiedAirPlayEndpoint? = null
            private set

        fun acquire(receiver: ReceiverServer, config: ReceiverConfig, appContext: Context,
                    log: (String) -> Unit): UnifiedAirPlayEndpoint = synchronized(companionLock) {
            current?.also { it.addReceiver(receiver, config) } ?: UnifiedAirPlayEndpoint(receiver, config, appContext, log).also {
                try { it.start() } catch (error: Exception) { it.close(); throw error }
            }
        }

        internal fun acquireCarPlay(config: AirPlayConfig, identity: AirPlayIdentity, appContext: Context,
                                    log: (String) -> Unit): UnifiedAirPlayEndpoint = synchronized(companionLock) {
            (current ?: UnifiedAirPlayEndpoint(null, ReceiverConfig("TiPlay", config.deviceId, identity,
                width = config.main.widthPixels, height = config.main.heightPixels, fps = config.main.fps,
                hevcEnabled = config.hevc), appContext, log).also {
                try { it.start(config.port) } catch (error: Exception) { it.close(); throw error }
            }).also { entry -> synchronized(entry.lock) { entry.pendingAttach++ } }
        }
    }
}
