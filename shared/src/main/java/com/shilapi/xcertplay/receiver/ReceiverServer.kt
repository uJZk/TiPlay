package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.NtpClock
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.network.TcpLiveness
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.Executors

/** Explicitly started LAN receiver, on its own port and identity, separate from CarPlay. */
class ReceiverServer(@Volatile private var config: ReceiverConfig, private val listener: Listener,
                     private val fairPlayReply: (ByteArray) -> ByteArray? = { ReceiverFairPlay.reply(it) },
                     private val fairPlayDecrypt: (ByteArray, ByteArray) -> ByteArray? = { message, key -> ReceiverFairPlay.decrypt(message, key) }) : Closeable {
    enum class PlaybackFinishReason(val wire: String) {
        IPHONE_STOP("iphone-stop"), REVERSE_CLOSE("reverse-close"), BROWSER_ENDED("browser-ended"),
        BROWSER_FAILED("browser-failed"), PLAY_CONNECTION_CLOSE("play-connection-close"), SHUTDOWN("shutdown"),
    }

    interface Listener {
        /** Authenticated mirror transport intent, before the sender starts the screen stream. */
        fun prepareMirror() {}
        fun mirrorSink(): WebMediaSink
        fun play(item: ReceiverPlay)
        fun photo(bytes: ByteArray) {}
        fun videoProperty(property: String, value: Any?): Boolean = false
        fun authorizeDevice(verifiedPublicKey: ByteArray?, deviceName: String): Boolean = false
        fun authorizeConnection(sessionToken: String, deviceName: String): Boolean = false
        fun onAuthorizationSessionEnded(sessionToken: String) {}
        fun flushMirrorAudio() {}
        fun mirrorAudio(format: ReceiverMirrorAudioFormat, payload: ByteArray) {}
        fun mirrorAudioTimed(format: ReceiverMirrorAudioFormat, payload: ByteArray, sample: Long, presentationNanos: Long?) =
            mirrorAudio(format, payload)
        fun stopMirrorAudio() {}
        fun stopPlayback()
        fun seek(seconds: Double)
        fun rate(value: Double)
        fun playback(): ReceiverPlayback
        fun status(state: String)
        fun log(message: String) {}
    }

    private val closed = AtomicBoolean(false)
    private val server = ServerSocket()
    private val sockets = ConcurrentHashMap.newKeySet<Socket>()
    private val slots = Semaphore(12)
    private val ownership = Any()
    private var owner: Connection? = null
    private var mirrorPreparation: Connection? = null // does not reserve media ownership
    private var playbackPeer: InetAddress? = null
    private var playbackId: String? = null
    private var playbackConnection: Connection? = null
    private var playbackCategory = "video"
    private var playbackPaused = false
    private var playbackGeneration = 0L
    private var stoppedSession: Pair<InetAddress, String>? = null
    private var stoppedUntilNanos = 0L
    private val maintenance = Executors.newSingleThreadScheduledExecutor {
        Thread(it, "tiplay-airplay-maintenance").apply { isDaemon = true }
    }
    private var photoSession: Pair<InetAddress, String>? = null
    private var photos = ReceiverPhotos()
    private data class VerifiedSession(val publicKey: ByteArray, val connection: Long, val expiresNanos: Long)
    private val verifiedSessions = ConcurrentHashMap<Pair<InetAddress, String>, VerifiedSession>()
    private val approvedSessions = ConcurrentHashMap<Pair<InetAddress, String>, VerifiedSession>()
    private data class ReverseKey(val peer: InetAddress, val session: String, val identity: String)
    private val reverse = ConcurrentHashMap<ReverseKey, Connection>()
    private val connectionIds = AtomicLong()
    private val diagnostics = ReceiverProtocolDiagnostics(listener::log)
    private val resources = ReceiverResourceRequests(onDeadline = { listener.log(it.line()) })
    val port: Int get() = server.localPort

    val displayConfig: ReceiverConfig get() = config

    /** Renegotiate only mirroring. URL playback has its own browser clock and is unaffected. */
    fun updateDisplay(fps: Int, hevc: Boolean): ReceiverConfig = synchronized(ownership) {
        if (config.fps != fps || config.hevcEnabled != hevc) {
            config = config.copy(fps = fps, hevcEnabled = hevc)
            owner?.let { mirror -> mirror.finish() }
            owner = null
        }
        config
    }

    /** Browser resize changes the next negotiation only; the active stream keeps its dimensions. */
    fun updateDisplaySize(width: Int, height: Int, hevc: Boolean? = null, mirrorEnabled: Boolean? = null): ReceiverConfig = synchronized(ownership) {
        require(width in 2..8192 && height in 2..8192 && width % 2 == 0 && height % 2 == 0)
        config = config.copy(width = width, height = height, hevcEnabled = hevc ?: config.hevcEnabled,
            mirrorEnabled = mirrorEnabled ?: config.mirrorEnabled)
        config
    }

    /** Capability reports constrain the next SETUP; updating them never interrupts the current media. */
    fun updateAudioFormats(formats: Long): ReceiverConfig = synchronized(ownership) {
        ReceiverAudioCapabilities.validateFormats(formats)
        if (config.audioOutputFormats != formats) {
            config = config.copy(audioOutputFormats = formats)
            listener.log("audio capabilities outputFormats=0x${formats.toString(16)}")
        }
        config
    }

    fun start(): Int {
        maintenance.scheduleWithFixedDelay({ runCatching { dispatchNextResource() } }, 1, 1, TimeUnit.SECONDS)
        server.reuseAddress = true
        server.bind(InetSocketAddress(InetAddress.getByName("::"), 0))
        Thread({
            try {
                while (!closed.get()) {
                    val socket = server.accept()
                    if (!slots.tryAcquire()) { socket.close(); continue }
                    sockets.add(socket)
                    if (closed.get()) { socket.close(); sockets.remove(socket); slots.release(); break }
                    Thread({
                        try { Connection(socket).run() }
                        finally { sockets.remove(socket); slots.release() }
                    }, "tiplay-airplay-control").apply { isDaemon = true; start() }
                }
            } catch (_: Exception) {
                if (!closed.get()) listener.status("failed")
            }
        }, "tiplay-airplay-listener").apply { isDaemon = true; start() }
        return port
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        maintenance.shutdownNow()
        runCatching { server.close() }
        sockets.forEach { runCatching { it.close() } }
        synchronized(ownership) {
            owner?.closeMedia(); owner = null
            mirrorPreparation = null
            if (playbackPeer != null) diagnostics.finish(PlaybackFinishReason.SHUTDOWN, reverseForPlayback()?.diagnosticId)
            playbackPeer = null; playbackId = null
            photos = ReceiverPhotos(); photoSession = null
            listener.stopPlayback()
        }
        verifiedSessions.clear(); approvedSessions.clear()
        reverse.clear()
        resources.clear()
    }

    /** Playback updates use the iPhone's reverse HTTP channel, never the browser's control channel. */
    fun playbackEvent(state: String) = synchronized(ownership) {
        val id = playbackId ?: return@synchronized
        if (state == "paused") playbackPaused = true
        if (state == "playing") playbackPaused = false
        val channel = reverseForPlayback()
        diagnostics.playbackEvent(channel?.diagnosticId, state, playbackCategory)
        channel?.event(state, id, playbackCategory)
    }

    fun finishPlayback(reason: PlaybackFinishReason = PlaybackFinishReason.BROWSER_ENDED,
                       reverseConnection: Long? = null) = synchronized(ownership) {
        if (playbackPeer == null && photoSession == null) return@synchronized
        stoppedSession = playbackPeer?.let { it to requireNotNull(playbackId) } ?: photoSession
        stoppedUntilNanos = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        playbackGeneration++
        diagnostics.finish(reason, reverseConnection ?: reverseForPlayback()?.diagnosticId)
        playbackEvent("stopped")
        playbackPeer = null; playbackId = null; playbackConnection = null
        photos = ReceiverPhotos(); photoSession = null
        resources.clear()
        listener.stopPlayback()
        listener.status("listening")
    }

    /** Browser stop for a stand-alone RTP stream leaves active mirroring under its RTSP owner. */
    fun stopAudioPlayback() = synchronized(ownership) {
        val connection = owner ?: return@synchronized
        if (!connection.hasStandaloneAudio()) return@synchronized
        connection.closeMedia(); owner = null
        listener.status("listening")
    }

    /** An iPhone app may own its HLS playlists. Request them on reverse HTTP, as UxPlay does. */
    fun loadResource(url: String, range: String? = null): ReceiverResource? = loadResource(url, range, null)

    /** Capture before asynchronous browser startup; a retired item must never request from its successor. */
    fun resourceLoader(): (String, String?) -> ReceiverResource? {
        val generation = synchronized(ownership) { playbackGeneration }
        return { url, range -> loadResource(url, range, generation) }
    }

    private fun loadResource(url: String, range: String?, generation: Long?): ReceiverResource? {
        if (range != null && !ReceiverResource.byteRange.matches(range)) return null
        if (!com.shilapi.xcertplay.airplay.VideoInCar.isPlayableUrl(url, iphoneLoadsAppSchemes = true)) return null
        val acquisition = synchronized(ownership) {
            if (closed.get() || generation != null && playbackGeneration != generation) return null
            val session = playbackId ?: return null
            val peer = playbackPeer ?: return null
            if (reverseForPlayback() == null) {
                diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.UNAVAILABLE)
                return null
            }
            val acquisition = resources.acquire(session, peer, url, range, ownerGeneration = playbackGeneration) ?: return null
            diagnostics.resource(if (acquisition.created) ReceiverProtocolDiagnostics.ResourceStage.QUEUED
                else ReceiverProtocolDiagnostics.ResourceStage.REUSED, acquisition.pending.id)
            dispatchNextResource()
            acquisition
        }
        val pending = acquisition.pending
        val requestId = pending.id
        var interrupted = false
        try {
            return awaitResource(pending).also {
                diagnostics.resource(if (it == null) ReceiverProtocolDiagnostics.ResourceStage.CANCELLED
                    else ReceiverProtocolDiagnostics.ResourceStage.COMPLETE, requestId)
            }
        } catch (_: InterruptedException) {
            interrupted = true
            diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.CANCELLED, requestId)
            Thread.currentThread().interrupt(); return null
        } catch (_: TimeoutException) {
            resources.expire(pending)
            diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.TIMEOUT, requestId); return null
        } catch (error: ExecutionException) {
            diagnostics.resource(if (error.cause is TimeoutException) ReceiverProtocolDiagnostics.ResourceStage.TIMEOUT
                else ReceiverProtocolDiagnostics.ResourceStage.FAILURE, requestId)
            return null
        } catch (_: Exception) {
            diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.FAILURE, requestId); return null
        }
        // Interrupted loaders leave the exchange available for the next seek load until its deadline.
        finally {
            if (!interrupted && pending.future.isDone) {
                resources.remove(pending)
                dispatchNextResource()
            }
        }
    }

    private fun awaitResource(pending: ReceiverResourceRequests.Pending): ReceiverResource? {
        while (true) {
            try { return pending.future.get(resources.waitNanos(pending), TimeUnit.NANOSECONDS) }
            catch (error: TimeoutException) {
                // A previous seek's only waiter may have been interrupted. Expire that exchange
                // before waiting again, keeping this loader's own original deadline.
                dispatchNextResource()
                if (resources.remainingNanos(pending) == 0L) throw error
            }
        }
    }

    private fun dispatchNextResource() = synchronized(ownership) {
        if (closed.get()) return@synchronized
        val session = playbackId ?: return@synchronized
        val peer = playbackPeer ?: return@synchronized
        val channel = reverseForPlayback() ?: return@synchronized
        // Back-to-back FCUP events can strand app-owned audio/subtitle playlists on iOS.
        // Keep one exchange outstanding, including when its browser waiter was interrupted.
        val pending = resources.nextToDispatch(session, peer) ?: return@synchronized
        diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.REQUEST, pending.id)
        channel.sendEvent(receiverXml(mapOf("sessionID" to 1, "type" to "unhandledURLRequest", "request" to mapOf(
            "FCUP_Response_ClientInfo" to 1, "FCUP_Response_ClientRef" to 40030004,
            "FCUP_Response_RequestID" to pending.id, "FCUP_Response_URL" to pending.url,
            "FCUP_Response_IsContentKeyRequest" to false, "sessionID" to 1,
            "FCUP_Response_Headers" to mapOf("X-Playback-Session-Id" to pending.session,
                "User-Agent" to "AppleCoreMedia/1.0.0.11B554a (Apple TV; U; CPU OS 7_0_4 like Mac OS X; en_us)") +
                ReceiverResourceHeaders.forUrl(pending.url) +
                (pending.range?.let { mapOf("Range" to it) } ?: emptyMap()),
        ))), pending.session)
    }

    /** Session names alone are not authorization for resource URLs or playback events. */
    private fun reverseForPlayback(): Connection? {
        val id = playbackId ?: return null
        val connection = playbackConnection ?: return null
        return connection.reverseKey(id)?.let { reverse[it] }?.takeIf { it.matchesPlayback(connection) }
    }

    private inner class Connection(private val socket: Socket) {
        private val pairing = ReceiverPairing(config.identity)
        private var handshake: ByteArray? = null
        private var key: ByteArray? = null
        private var mirror: ReceiverMirrorStream? = null
        private var mirrorToken: Any? = null
        private var audio: ReceiverAudioDrain? = null
        private var audioIv: ByteArray? = null
        private var audioOrder: ReceiverMirrorAudioTiming? = null
        private var mediaIdentity: ByteArray? = null
        private val connectionNonce = java.util.UUID.randomUUID().toString().replace("-", "")
        private var connectionApproved = false
        private var timing: NtpClock? = null
        private val output = RawTraffic.output("iphone/ReceiverServer/${socket.remoteSocketAddress}/${socket.localPort}/out", socket.getOutputStream())
        // One ordered, bounded writer per connection; neither ownership nor shutdown waits for its I/O.
        private val events = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(32)) {
            Thread(it, "tiplay-airplay-events").apply { isDaemon = true }
        }
        private var reverseId: String? = null
        private var registeredReverse: ReverseKey? = null
        private val peer = socket.inetAddress
        val diagnosticId = connectionIds.incrementAndGet()

        fun run() {
            var stage = ReceiverProtocolDiagnostics.Stage.ACCEPT
            diagnostics.stage(diagnosticId, stage)
            try {
                TcpLiveness.configure(socket) {}
                socket.tcpNoDelay = true
                socket.soTimeout = 120_000
                val input = BufferedInputStream(RawTraffic.input("iphone/ReceiverServer/${socket.remoteSocketAddress}/${socket.localPort}/in", socket.getInputStream()))
                while (!closed.get() && !socket.isClosed) {
                    stage = ReceiverProtocolDiagnostics.Stage.READ
                    val request = try { readReceiverRequest(input) } catch (error: ReceiverRequestBodyTooLarge) {
                        val response = RtspMessage.Response(status = 413, statusText = "Payload Too Large",
                            headers = mapOf("Connection" to "close"))
                        synchronized(output) {
                            output.write(RtspMessage.buildResponse(error.request, response)); output.flush()
                        }
                        diagnostics.response(diagnosticId, response)
                        break
                    } ?: break
                    // iOS can acknowledge POST /event with either HTTP or EVENT status lines.
                    val eventReply = reverseId != null && request.method == "EVENT/1.0" &&
                        request.path.toIntOrNull()?.let { it in 100..599 } == true
                    if (request.method.startsWith("HTTP/") || eventReply) {
                        diagnostics.reverseReply(diagnosticId, request)
                        continue
                    }
                    diagnostics.request(diagnosticId, request)
                    stage = ReceiverProtocolDiagnostics.Stage.DISPATCH
                    var response = try { dispatch(request) }
                    catch (error: ReceiverPhotoCacheMiss) {
                        diagnostics.photo(diagnosticId, "CACHE_MISS", 0)
                        RtspMessage.Response(status = 412, statusText = "Precondition Failed")
                    }
                    catch (error: IllegalArgumentException) {
                        diagnostics.failure(diagnosticId, stage, error); RtspMessage.Response(status = 400)
                    }
                    catch (error: IllegalStateException) {
                        diagnostics.failure(diagnosticId, stage, error); RtspMessage.Response(status = 400)
                    }
                    catch (error: Exception) {
                        diagnostics.failure(diagnosticId, stage, error); RtspMessage.Response(status = 500)
                    }
                    stage = ReceiverProtocolDiagnostics.Stage.WRITE
                    synchronized(output) {
                        if (response.status == 101) reverseId?.let { id ->
                            synchronized(ownership) {
                                if (playbackPeer != null && (playbackId != id || !matchesPlayback(playbackConnection))) {
                                    response = busy(); reverseId = null
                                } else {
                                    val index = requireNotNull(reverseKey(id))
                                    registeredReverse = index
                                    reverse.put(index, this)?.takeIf { old -> old !== this }?.socket?.close()
                                }
                            }
                        }
                        diagnostics.response(diagnosticId, response)
                        val headers = response.headers + ("Server" to "AirTunes/220.68")
                        output.write(RtspMessage.buildResponse(request, response.copy(headers = headers))); output.flush()
                    }
                    if (response.status == 101) {
                        socket.soTimeout = 0
                    }
                    if (response.headers["Connection"] == "close") break
                }
            } catch (error: Exception) {
                diagnostics.failure(diagnosticId, stage, error)
                // Malformed requests and peer disconnects are confined to their own connection.
            } finally {
                finish()
            }
        }

        fun finish() {
            diagnostics.stage(diagnosticId, ReceiverProtocolDiagnostics.Stage.CLOSE)
            events.shutdownNow()
            runCatching { socket.close() }
            verifiedSessions.entries.removeIf { it.value.connection == diagnosticId }
            approvedSessions.entries.removeIf { it.value.connection == diagnosticId }
            runCatching { listener.onAuthorizationSessionEnded(connectionNonce) }
            reverseId?.let { id ->
                val index = registeredReverse
                if (index != null && reverse.remove(index, this)) synchronized(ownership) {
                    if (playbackId == id && playbackPeer == peer && matchesPlayback(playbackConnection)) finishPlayback(
                        if (closed.get()) PlaybackFinishReason.SHUTDOWN else PlaybackFinishReason.REVERSE_CLOSE,
                        diagnosticId,
                    )
                }
            }
            synchronized(ownership) {
                val wasPreparing = mirrorPreparation === this
                if (playbackConnection === this && playbackCategory == "video") {
                    val generation = playbackGeneration
                    if (!closed.get()) maintenance.schedule({ synchronized(ownership) {
                        val state = listener.playback()
                        val paused = playbackPaused || (state.ready && state.rate == 0.0)
                        if (playbackConnection === this && playbackGeneration == generation && !paused)
                            finishPlayback(PlaybackFinishReason.PLAY_CONNECTION_CLOSE)
                    } }, 2, TimeUnit.SECONDS)
                }
                closeMedia()
                if (owner === this) { owner = null; listener.status("listening") }
                if (wasPreparing) {
                    mirrorPreparation = null
                    if (owner == null && playbackPeer == null) listener.status("listening")
                }
            }
        }

        fun hasStandaloneAudio(): Boolean = audio != null && mirror == null

        fun closeMedia() {
            if (owner === this) {
                if (hasStandaloneAudio()) listener.stopPlayback()
                listener.stopMirrorAudio()
            }
            mirrorToken = null
            mirror?.close(); mirror = null
            audio?.close(); audio = null; audioOrder = null
            timing?.close(); timing = null
            key = null; handshake = null
            audioIv?.fill(0); audioIv = null
        }

        fun event(state: String, id: String, category: String) {
            val body = receiverXml(mapOf("category" to category, "state" to state))
            sendEvent(body, id)
        }

        fun sendEvent(body: ByteArray, id: String) {
            val headers = "POST /event HTTP/1.1\r\nContent-Type: text/x-apple-plist+xml\r\n" +
                "X-Apple-Session-ID: $id\r\nContent-Length: ${body.size}\r\n\r\n"
            try {
                events.execute {
                    runCatching {
                        synchronized(output) {
                            output.write(headers.toByteArray()); output.write(body); output.flush()
                        }
                    }.onFailure { error ->
                        if (error is Exception) diagnostics.failure(diagnosticId, ReceiverProtocolDiagnostics.Stage.WRITE, error)
                    }
                }
            } catch (error: RejectedExecutionException) {
                diagnostics.failure(diagnosticId, ReceiverProtocolDiagnostics.Stage.WRITE, error)
                // A peer that cannot drain its bounded event backlog must release this connection.
                // Never redirect captured events to a replacement reverse channel with the same session ID.
                runCatching { socket.close() }
            }
        }

        fun dispatch(request: RtspMessage.Request): RtspMessage.Response {
            val path = receiverRequestPath(request.path)
            val query = receiverQuery(request.path)
            val id = request.headers["x-apple-session-id"] ?: "default"
            require(id.matches(Regex("[A-Za-z0-9._-]{1,128}")))
            if ((path == "/play" && request.method == "POST") ||
                (path == "/photo" && request.method == "PUT") || request.method == "SETUP" ||
                path in listOf("/reverse", "/stop", "/scrub", "/rate", "/setProperty")) {
                // Browser confirmation is bounded and must never block ownership or FCUP progress.
                val verifiedKey = pairing.verifiedPublicKey ?: verifiedSessions[peer to id]
                    ?.takeIf { strongSessionId(id) && System.nanoTime() < it.expiresNanos }?.publicKey?.copyOf()
                val name = (request.headers["x-apple-client-name"] ?: request.headers["x-apple-device-name"] ?: "AirPlay")
                    .filter { !it.isISOControl() }.take(80)
                if (verifiedKey != null) {
                    if (!listener.authorizeDevice(verifiedKey, name)) return RtspMessage.Response(status = 403, statusText = "Forbidden")
                    mediaIdentity = verifiedKey.copyOf()
                } else {
                    val approved = approvedSessions[peer to id]?.takeIf {
                        strongSessionId(id) && System.nanoTime() < it.expiresNanos
                    }
                    if (approved != null) mediaIdentity = approved.publicKey.copyOf()
                    else {
                        if (!connectionApproved) connectionApproved = listener.authorizeConnection(connectionNonce, name)
                        if (!connectionApproved) return RtspMessage.Response(status = 403, statusText = "Forbidden")
                        mediaIdentity = AirPlayCrypto.sha512(connectionNonce.toByteArray()).copyOf(32)
                        approvedSessions.entries.removeIf { entry -> System.nanoTime() >= entry.value.expiresNanos }
                        if (strongSessionId(id) && (approvedSessions.size < 32 || approvedSessions.containsKey(peer to id)))
                            approvedSessions[peer to id] = VerifiedSession(requireNotNull(mediaIdentity).copyOf(), diagnosticId,
                                System.nanoTime() + TimeUnit.MINUTES.toNanos(2))
                    }
                }
            }
            when {
                path == "/info" -> {
                    return ReceiverInfoProtocol.response(config, request)
                }
                path == "/server-info" -> return xml(config.serverInfo())
                path == "/pair-setup" -> return ReceiverHandshake.pairing { pairing.setup(request.body) }
                path == "/pair-verify" -> {
                    val response = ReceiverHandshake.pairing { pairing.verify(request.body) }
                    if (response.status == 200) pairing.verifiedPublicKey?.let {
                        verifiedSessions.entries.removeIf { entry -> System.nanoTime() >= entry.value.expiresNanos }
                        if (strongSessionId(id) && (verifiedSessions.size < 32 || verifiedSessions.containsKey(peer to id)))
                            verifiedSessions[peer to id] = VerifiedSession(it, diagnosticId, System.nanoTime() + TimeUnit.MINUTES.toNanos(2))
                    }
                    else verifiedSessions.remove(peer to id)
                    return response
                }
                path == "/fp-setup" -> {
                    val response = ReceiverHandshake.fairPlay(request.body, fairPlayReply)
                    if (response.status == 200) {
                        handshake = if (request.body.size == 164) request.body.copyOf() else null
                    }
                    return response
                }
                request.method == "OPTIONS" -> return RtspMessage.Response(headers = mapOf("Public" to
                    "SETUP, RECORD, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER, FLUSH"))
                request.method == "SETUP" -> return setup(request)
                request.method == "RECORD" -> return RtspMessage.Response(headers = mapOf("Audio-Latency" to "0"))
                request.method == "TEARDOWN" -> {
                    synchronized(ownership) {
                        val types = receiverTeardownTypes(request.body)
                        if (types == null) {
                            closeMedia()
                        } else {
                            if (96 in types) {
                                if (owner === this && hasStandaloneAudio()) listener.stopPlayback()
                                audio?.close(); audio = null; audioOrder = null
                                if (owner === this) listener.stopMirrorAudio()
                            }
                            if (110 in types) {
                                mirrorToken = null
                                val hadMirror = mirror != null
                                mirror?.close(); mirror = null
                                if (hadMirror && owner === this) listener.status(if (audio != null) "audio" else "listening")
                            }
                            if (audio != null || mirror != null) return RtspMessage.Response()
                            closeMedia()
                        }
                        if (owner === this) { owner = null; listener.status("listening") }
                        if (mirrorPreparation === this) {
                            mirrorPreparation = null
                            if (owner == null && playbackPeer == null) listener.status("listening")
                        }
                    }
                    return RtspMessage.Response(headers = mapOf("Connection" to "close"))
                }
                path == "/reverse" && request.method == "POST" -> {
                    if (!request.headers["upgrade"].equals("PTTH/1.0", true)) return RtspMessage.Response(status = 400)
                    synchronized(ownership) {
                        if (playbackPeer != null && (playbackPeer != peer || playbackId != id ||
                                (playbackConnection !== this && playbackConnection?.let { !sameVerifiedPeer(it) } == true))) return busy()
                    }
                    reverseId = id
                    return RtspMessage.Response(status = 101, statusText = "Switching Protocols",
                        headers = mapOf("Connection" to "Upgrade", "Upgrade" to "PTTH/1.0"))
                }
                path == "/play" && request.method == "POST" -> {
                    val item = ReceiverPlay.parse(request)
                    synchronized(ownership) {
                        if (closed.get()) return busy()
                        if ((owner != null && owner !== this && !sameVerifiedPeer(owner!!)) ||
                            (playbackPeer != null && (playbackPeer != peer || playbackId != id ||
                                (playbackConnection !== this && playbackConnection?.let { !sameVerifiedPeer(it) } == true)))) return busy()
                        owner?.closeMedia(); owner = null
                        mirrorPreparation = null
                        resources.clear()
                        playbackPeer = peer; playbackId = id; playbackConnection = this
                        playbackCategory = "video"; playbackPaused = false; playbackGeneration++
                        stoppedSession = null
                        photos = ReceiverPhotos(); photoSession = null
                        diagnostics.play(diagnosticId, item)
                        listener.play(item.copy(iphoneHost = peer.hostAddress)); listener.status("video")
                    }
                    // Browser preparation may need FCUP /action on this same control connection.
                    // Acknowledge before media readiness so its resource response can be read.
                    return RtspMessage.Response()
                }
                path == "/photo" && request.method == "PUT" -> {
                    synchronized(ownership) {
                        if (closed.get() || (owner != null && owner !== this && !sameVerifiedPeer(owner!!)) || (playbackPeer != null &&
                                (playbackPeer != peer || playbackId != id ||
                                    (playbackConnection !== this && playbackConnection?.let { !sameVerifiedPeer(it) } == true)))) return busy()
                        if (photoSession != (peer to id)) { photos = ReceiverPhotos(); photoSession = peer to id }
                        val image = photos.receive(request.headers["x-apple-assetaction"],
                            request.headers["x-apple-assetkey"], request.body)
                        diagnostics.photo(diagnosticId, if (image == null) "CACHE_ONLY" else "DISPLAY", request.body.size)
                        if (image != null) {
                            mirrorPreparation = null
                            owner?.closeMedia(); owner = null
                            resources.clear()
                            playbackPeer = peer; playbackId = id; playbackConnection = this
                            playbackCategory = "photo"; playbackPaused = false; playbackGeneration++
                            stoppedSession = null
                            listener.photo(image); listener.status("photo")
                            playbackEvent("playing")
                        }
                    }
                    return RtspMessage.Response()
                }
                path == "/action" && request.method == "POST" -> {
                    val message = BplistCodec.decode(request.body) as? Map<*, *> ?: error("invalid action")
                    if (message["type"] != "unhandledURLResponse") return RtspMessage.Response(status = 501, statusText = "Not Implemented")
                    val params = message["params"] as? Map<*, *> ?: error("missing params")
                    val requestId = (params["FCUP_Response_RequestID"] as? Number)?.toLong() ?: error("missing request id")
                    val pending = resources[requestId] ?: run {
                        dispatchNextResource()
                        return RtspMessage.Response(status = 404)
                    }
                    if (pending.session != id || pending.peer != peer || pending.url != params["FCUP_Response_URL"]) {
                        return RtspMessage.Response(status = 403, statusText = "Forbidden")
                    }
                    if (mediaIdentity == null) {
                        mediaIdentity = pairing.verifiedPublicKey ?: (if (strongSessionId(id)) {
                            (verifiedSessions[peer to id] ?: approvedSessions[peer to id])
                                ?.takeIf { System.nanoTime() < it.expiresNanos }?.publicKey?.copyOf()
                        } else null)
                    }
                    if (!matchesPlayback(playbackConnection)) return RtspMessage.Response(status = 403, statusText = "Forbidden")
                    val headers = params["FCUP_Response_Headers"] as? Map<*, *>
                    val location = headers?.entries?.firstOrNull { it.key.toString().equals("Location", true) }?.value as? String
                    diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.RESPONSE, requestId,
                        (params["FCUP_Response_StatusCode"] as? Number)?.toInt(),
                        (params["FCUP_Response_Data"] as? ByteArray)?.size)
                    pending.future.complete(ReceiverResource(params["FCUP_Response_Data"] as? ByteArray,
                        (params["FCUP_Response_StatusCode"] as? Number)?.toInt(), location, ReceiverResource.headers(headers)))
                    dispatchNextResource()
                    return RtspMessage.Response()
                }
                ReceiverVideoProperties.handles(request) -> {
                    synchronized(ownership) {
                        if (path != "/fp-setup2" && (playbackPeer != peer || playbackId != id ||
                                (request.method == "PUT" && playbackConnection !== this &&
                                    playbackConnection?.let { !sameVerifiedPeer(it) } == true))) {
                            return RtspMessage.Response(status = 403, statusText = "Forbidden")
                        }
                        return ReceiverVideoProperties.response(request, listener::playback, listener::videoProperty)
                    }
                }
                path in listOf("/stop", "/scrub", "/rate", "/playback-info") -> {
                    synchronized(ownership) {
                        val active = playbackPeer == peer && playbackId == id &&
                            (path == "/playback-info" || playbackConnection === this ||
                                playbackConnection?.let { sameVerifiedPeer(it) } == true)
                        val cached = photoSession == (peer to id)
                        val stopped = stoppedSession == (peer to id) && System.nanoTime() < stoppedUntilNanos
                        if (!active) {
                            if (path == "/playback-info" && playbackPeer == null) return xml(ReceiverPlayback().info())
                            if (path == "/stop" && (cached || stopped)) {
                                if (cached) {
                                    photos = ReceiverPhotos(); photoSession = null
                                    stoppedSession = peer to id
                                    stoppedUntilNanos = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                                }
                                return RtspMessage.Response()
                            }
                            return RtspMessage.Response(status = 403, statusText = "Forbidden")
                        }
                        when (path) {
                            "/stop" -> finishPlayback(PlaybackFinishReason.IPHONE_STOP)
                            "/scrub" -> if (request.method == "POST") {
                                val value = query["position"]?.toDoubleOrNull()
                                require(value != null && value.isFinite() && value >= 0); listener.seek(value)
                            } else {
                                val state = listener.playback()
                                return RtspMessage.Response(headers = mapOf("Content-Type" to "text/parameters"),
                                    body = "duration: ${state.duration}\r\nposition: ${state.position}\r\n".toByteArray())
                            }
                            "/rate" -> {
                                val value = query["value"]?.toDoubleOrNull()
                                require(value != null && ReceiverPlayback.supportsRate(value))
                                listener.rate(value)
                                if (playbackPaused && value > 0.0) playbackConnection = this
                                playbackPaused = value == 0.0
                            }
                            "/playback-info" -> {
                                val state = if (playbackCategory == "photo") ReceiverPlayback(ready = true) else listener.playback()
                                diagnostics.playbackInfo(diagnosticId, state)
                                return xml(state.info())
                            }
                        }
                    }
                    return RtspMessage.Response()
                }
                request.method == "GET_PARAMETER" -> return ReceiverMirrorParameters.reply(request)
                request.method == "SET_PARAMETER" -> return ReceiverMetadata.receive(request) {
                    listener.log("c=$diagnosticId $it")
                }
                request.method == "FLUSH" -> {
                    synchronized(ownership) {
                        if (owner !== this) return RtspMessage.Response(status = 403, statusText = "Forbidden")
                        val rtp = request.headers["rtp-info"].orEmpty().split(';').associate { part ->
                            part.substringBefore('=').trim() to part.substringAfter('=', "").trim()
                        }
                        val sequence = rtp["seq"]?.toIntOrNull()
                        val sample = rtp["rtptime"]?.toLongOrNull()?.toInt()
                        if (rtp.containsKey("seq")) require(sequence != null && sequence in 0..65535)
                        if (rtp.containsKey("rtptime")) {
                            val value = rtp["rtptime"]?.toLongOrNull()
                            require(value != null && value in 0..0xffffffffL)
                        }
                        audioOrder?.flush(sequence, sample)
                        listener.flushMirrorAudio()
                    }
                    return RtspMessage.Response()
                }
                path == "/feedback" -> return RtspMessage.Response()
                else -> return RtspMessage.Response(status = 404)
            }
        }

        fun reverseKey(id: String): ReverseKey? = mediaIdentity?.let {
            ReverseKey(peer, id, java.util.Base64.getEncoder().encodeToString(it))
        }

        fun matchesPlayback(connection: Connection?): Boolean = connection != null && sameVerifiedPeer(connection)

        private fun strongSessionId(id: String): Boolean = id.replace("-", "").matches(Regex("[A-Fa-f0-9]{32}"))

        private fun sameVerifiedPeer(other: Connection): Boolean =
            peer == other.peer && mediaIdentity != null &&
                mediaIdentity?.contentEquals(other.mediaIdentity ?: ByteArray(0)) == true

        private fun setup(request: RtspMessage.Request): RtspMessage.Response = synchronized(ownership) {
            if (closed.get() || (owner != null && owner !== this && !sameVerifiedPeer(owner!!)) ||
                (playbackPeer != null && (playbackConnection?.let { !sameVerifiedPeer(it) } != false))) return busy()
            val dict = BplistCodec.decode(request.body) as? Map<*, *> ?: error("setup must be dictionary")
            diagnostics.setup(diagnosticId, dict, pairing.sharedSecret != null, handshake?.size ?: 0)
            val requestedStreams = dict["streams"]?.let { value ->
                require(value is List<*> && value.size <= 16)
                val entries = value.map { it as? Map<*, *> ?: error("invalid stream") }
                val types = entries.map { (it["type"] as? Number)?.toInt() }
                require(types.all { it == 96 || it == 110 } && types.distinct().size == types.size)
                if (110 in types && !config.mirrorEnabled)
                    return RtspMessage.Response(status = 461, statusText = "Unsupported Transport")
                entries.filter { (it["type"] as Number).toInt() == 96 }.forEach {
                    ReceiverAudioCapabilities.validateStream(it, config.audioOutputFormats)
                }
                entries.filter { (it["type"] as Number).toInt() == 110 }.forEach {
                    require(it["streamConnectionID"] is Number) { "missing connection id" }
                }
                entries
            }
            if (owner != null && owner !== this) { owner?.closeMedia(); owner = null }
            if (playbackPeer != null) finishPlayback(PlaybackFinishReason.IPHONE_STOP)
            val response = linkedMapOf<String, Any?>()
            val encrypted = dict["ekey"] as? ByteArray
            if (encrypted != null) {
                val iv = dict["eiv"] as? ByteArray
                require(iv?.size == 16)
                val shared = pairing.sharedSecret ?: return RtspMessage.Response(status = 403, statusText = "Forbidden")
                val transportHandshake = requireNotNull(handshake)
                val raw = fairPlayDecrypt(transportHandshake, encrypted) ?: error("invalid transport key")
                val hadMirror = mirror != null
                closeMedia()
                if (owner === this) owner = null
                handshake = transportHandshake
                if (hadMirror) listener.status("listening")
                key = AirPlayCrypto.sha512(raw, shared).copyOf(16)
                audioIv = requireNotNull(iv).copyOf()
                val clock = NtpClock(log = { listener.log("c=$diagnosticId $it") },
                    wireTimeline = com.shilapi.xcertplay.airplay.NtpWireTimeline())
                timing = clock
                response["timingPort"] = clock.listen()
                val timingPort = (dict["timingPort"] as? Number)?.toInt() ?: 0
                require(timingPort in 0..65535)
                clock.start(peer, timingPort)
                // Legacy mirroring has no separate event channel; do not point it at the control listener.
                response["eventPort"] = 0
                mirrorPreparation = this
                listener.prepareMirror()
            }
            requestedStreams?.let { streams ->
                response["streams"] = streams.mapNotNull { entry ->
                    val stream = entry
                    if ((stream["type"] as Number).toInt() == 96) {
                        requireNotNull(key)
                        requireNotNull(timing)
                        val format = ReceiverMirrorAudioFormat.parse(stream)
                        val audioKey = requireNotNull(key).copyOf()
                        val iv = audioIv?.copyOf()
                        // AAC NoData units retain RTP ordering and source coordinates; the browser
                        // renders their silence without feeding them to the compressed decoder.
                        val order = ReceiverMirrorAudioTiming(format?.sampleRate ?: 44100, requireNotNull(timing)::ntpTimeNanos)
                        audioOrder = order
                        val controlPort = (stream["controlPort"] as? Number)?.toInt() ?: 0
                        require(controlPort in 0..65535)
                        fun deliver(packets: List<ReceiverMirrorAudioTiming.Packet>) {
                            if (format != null) synchronized(ownership) {
                                if (owner === this && audioOrder === order) packets.forEach {
                                    if (it.discontinuity) listener.flushMirrorAudio()
                                    listener.mirrorAudioTimed(format, it.payload, it.sample, it.presentationNanos)
                                }
                            }
                        }
                        lateinit var receiver: ReceiverAudioDrain
                        fun retransmit() { order.retransmissionRequests().forEach { receiver.sendControl(it, controlPort) } }
                        receiver = ReceiverAudioDrain(peer, { listener.log("c=$diagnosticId $it") }, packetReceived = { packet ->
                            if (format != null && iv != null && synchronized(ownership) { owner === this }) {
                                ReceiverMirrorAudioPacket.decrypt(packet, audioKey, iv)?.let { payload ->
                                    synchronized(ownership) {
                                        if (audioOrder === order && owner === this) deliver(order.offer(packet, payload))
                                    }
                                    retransmit()
                                }
                            }
                        }, controlReceived = { packet ->
                            order.sync(packet)
                            order.control(packet)?.let { recovered ->
                                if (iv != null) ReceiverMirrorAudioPacket.decrypt(recovered, audioKey, iv)?.let { payload ->
                                    synchronized(ownership) {
                                        if (audioOrder === order && owner === this) deliver(order.offer(recovered, payload))
                                    }
                                }
                            }
                            retransmit()
                        }, idle = {
                            synchronized(ownership) { if (audioOrder === order && owner === this) deliver(order.drain()) }
                            retransmit()
                        }, failed = { _, _ ->
                            synchronized(ownership) {
                                // A retired drain cannot mute or release a replacement stream. The picture
                                // and its timing/key negotiation survive a soundtrack transport failure.
                                if (owner === this && audio === receiver && audioOrder === order) {
                                    audio = null; audioOrder = null
                                    listener.stopMirrorAudio()
                                    if (mirror == null) {
                                        listener.stopPlayback()
                                        owner = null
                                        listener.status("listening")
                                    }
                                }
                            }
                        })
                        val ports = receiver.start()
                        if (audio != null && owner === this) listener.stopMirrorAudio()
                        audio?.close()
                        audio = receiver
                        owner = this
                        if (mirror == null && streams.none { (it["type"] as Number).toInt() == 110 }) listener.status("audio")
                        return@mapNotNull mapOf("type" to 96, "dataPort" to ports.first, "controlPort" to ports.second)
                    }
                    val streamKey = requireNotNull(key)
                    val clock = requireNotNull(timing)
                    val connectionId = (stream["streamConnectionID"] as? Number)?.toLong() ?: error("missing connection id")
                    mirrorPreparation = this
                    val token = Any()
                    mirrorToken = token
                    val previous = mirror
                    mirror = null
                    var output: WebMediaSink? = null
                    try {
                        previous?.close()
                        val sink = listener.mirrorSink()
                        output = sink
                        val receiver = ReceiverMirrorStream(streamKey, connectionId, peer, sink, clock,
                            log = { listener.log("c=$diagnosticId $it") }, hevcEnabled = config.hevcEnabled) {
                            synchronized(ownership) {
                                if (owner === this && mirrorToken === token) {
                                    timing?.reportVideoEnd()
                                    mirror = null
                                    mirrorToken = null
                                    owner = if (audio != null) this else null
                                    // A data-channel EOF ends the picture, not the RTSP session. Keep timing
                                    // and transport keys until TEARDOWN/control EOF, allowing its reply or
                                    // another SETUP on this connection.
                                    listener.status(if (audio != null) "audio" else "listening")
                                }
                            }
                        }
                        mirror = receiver; owner = this
                        val dataPort = receiver.start()
                        listener.status("mirror")
                        mapOf("type" to 110, "dataPort" to dataPort)
                    } catch (error: Exception) {
                        if (mirrorToken === token) {
                            // Sink approval and port binding can fail after the preceding stream was
                            // retired. Its old EOF callback has an obsolete token and cannot clean up.
                            mirrorToken = null
                            mirror?.close(); mirror = null
                            output?.close()
                            if (mirrorPreparation === this) mirrorPreparation = null
                            if (owner === this) owner = if (audio != null) this else null
                            timing?.reportVideoEnd()
                            listener.status(if (audio != null) "audio" else "listening")
                        }
                        throw error
                    }
                }
            }
            plist(response)
        }
    }
}

private fun busy() = RtspMessage.Response(status = 453, statusText = "Not Enough Bandwidth")
private fun plist(dict: Map<String, Any?>) = RtspMessage.Response(headers = mapOf("Content-Type" to "application/x-apple-binary-plist"), body = BplistCodec.encode(dict))
private fun xml(dict: Map<String, Any?>) = RtspMessage.Response(headers = mapOf("Content-Type" to "text/x-apple-plist+xml"), body = receiverXml(dict))

internal class ReceiverRequestBodyTooLarge(val request: RtspMessage.Request) : IllegalArgumentException("receiver body too large")

/** Bound allocation by endpoint before passing framing to the shared RTSP parser. */
internal fun readReceiverRequest(input: java.io.InputStream): RtspMessage.Request? {
    val header = ByteArrayOutputStream()
    var end = 0
    while (end != 0x0d0a0d0a) {
        val byte = input.read()
        if (byte < 0) { require(header.size() == 0); return null }
        header.write(byte); require(header.size() <= 16 * 1024)
        end = (end shl 8) or byte
    }
    val bytes = header.toByteArray()
    val lengths = bytes.toString(Charsets.US_ASCII).split("\r\n").filter { it.substringBefore(':').equals("Content-Length", true) }
    require(lengths.size <= 1)
    val length = lengths.firstOrNull()?.substringAfter(':')?.trim()?.toIntOrNull() ?: if (lengths.isEmpty()) 0 else error("invalid content length")
    require(length >= 0)
    val target = bytes.toString(Charsets.US_ASCII).substringBefore("\r\n").split(' ').getOrNull(1).orEmpty()
    val limit = when (receiverRequestPath(target)) {
        "/photo" -> ReceiverPhotos.MAX_IMAGE_BYTES
        "/action" -> 32 * 1024 * 1024
        else -> 1024 * 1024
    }
    if (length > limit) {
        // Header-only parse with zero length preserves protocol/CSeq for the explicit 413 reply.
        val emptyHeader = bytes.toString(Charsets.US_ASCII).replace(Regex("(?im)^Content-Length:[^\r\n]*"), "Content-Length: 0")
        throw ReceiverRequestBodyTooLarge(RtspMessage.parseMessages(emptyHeader.toByteArray()).messages.single())
    }
    val body = ByteArray(length)
    require(readPacket(input, body))
    return RtspMessage.parseMessages(bytes + body).messages.single()
}

internal fun receiverXml(value: Any?): ByteArray {
    fun escape(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    fun render(value: Any?): String = when (value) {
        is Map<*, *> -> "<dict>" + value.entries.joinToString("") { "<key>${escape(it.key.toString())}</key>${render(it.value)}" } + "</dict>"
        is List<*> -> "<array>" + value.joinToString("") { render(it) } + "</array>"
        is Boolean -> if (value) "<true/>" else "<false/>"
        is Float, is Double -> "<real>$value</real>"
        is Number -> "<integer>$value</integer>"
        is ByteArray -> "<data>${java.util.Base64.getEncoder().encodeToString(value)}</data>"
        else -> "<string>${escape(value?.toString().orEmpty())}</string>"
    }
    return ("<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" " +
        "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\">${render(value)}</plist>").toByteArray()
}
