package com.shilapi.xcertplay.receiver

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

/** Explicitly started LAN receiver, on its own port and identity, separate from CarPlay. */
class ReceiverServer(@Volatile private var config: ReceiverConfig, private val listener: Listener,
                     private val fairPlayReply: (ByteArray) -> ByteArray? = { ReceiverFairPlay.reply(it) },
                     private val fairPlayDecrypt: (ByteArray, ByteArray) -> ByteArray? = { message, key -> ReceiverFairPlay.decrypt(message, key) }) : Closeable {
    interface Listener {
        fun mirrorSink(): WebMediaSink
        fun play(item: ReceiverPlay)
        fun photo(bytes: ByteArray) {}
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
    private var playbackPeer: InetAddress? = null
    private var playbackId: String? = null
    private var photoSession: Pair<InetAddress, String>? = null
    private var photos = ReceiverPhotos()
    private val reverse = ConcurrentHashMap<String, Connection>()
    private val connectionIds = AtomicLong()
    private val diagnostics = ReceiverProtocolDiagnostics(listener::log)
    private val resources = ReceiverResourceRequests()
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

    fun start(): Int {
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
        runCatching { server.close() }
        sockets.forEach { runCatching { it.close() } }
        synchronized(ownership) {
            owner?.closeMedia(); owner = null
            playbackPeer = null; playbackId = null
            photos = ReceiverPhotos(); photoSession = null
            listener.stopPlayback()
        }
        reverse.clear()
        resources.clear()
    }

    /** Playback updates use the iPhone's reverse HTTP channel, never the browser's control channel. */
    fun playbackEvent(state: String) = synchronized(ownership) {
        val id = playbackId ?: return@synchronized
        reverse[id]?.event(state, id)
    }

    fun finishPlayback() = synchronized(ownership) {
        if (playbackPeer == null) return@synchronized
        playbackEvent("stopped")
        playbackPeer = null; playbackId = null
        photos = ReceiverPhotos(); photoSession = null
        resources.clear()
        listener.stopPlayback()
        listener.status("listening")
    }

    /** An iPhone app may own its HLS playlists. Request them on reverse HTTP, as UxPlay does. */
    fun loadResource(url: String): ReceiverResource? {
        if (!com.shilapi.xcertplay.airplay.VideoInCar.isPlayableUrl(url, iphoneLoadsAppSchemes = true)) return null
        val acquisition = synchronized(ownership) {
            if (closed.get()) return null
            val session = playbackId ?: return null
            val peer = playbackPeer ?: return null
            val channel = reverse[session] ?: run {
                diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.UNAVAILABLE)
                return null
            }
            val acquisition = resources.acquire(session, peer, url) ?: return null
            if (acquisition.created) {
                val pending = acquisition.pending
                channel.sendEvent(receiverXml(mapOf("sessionID" to 1, "type" to "unhandledURLRequest", "request" to mapOf(
                    "FCUP_Response_ClientInfo" to 1, "FCUP_Response_ClientRef" to 40030004,
                    "FCUP_Response_RequestID" to pending.id, "FCUP_Response_URL" to url,
                    "FCUP_Response_IsContentKeyRequest" to false, "sessionID" to 1,
                    "FCUP_Response_Headers" to mapOf("X-Playback-Session-Id" to pending.session,
                        "User-Agent" to "AppleCoreMedia/1.0.0.11B554a (Apple TV; U; CPU OS 7_0_4 like Mac OS X; en_us)"),
                ))), pending.session)
            }
            acquisition
        }
        val pending = acquisition.pending
        val requestId = pending.id
        var interrupted = false
        try {
            diagnostics.resource(if (acquisition.created) ReceiverProtocolDiagnostics.ResourceStage.REQUEST
                else ReceiverProtocolDiagnostics.ResourceStage.REUSED, requestId)
            return pending.future.get(resources.remainingNanos(pending), TimeUnit.NANOSECONDS).also {
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
        finally { if (!interrupted && pending.future.isDone) resources.remove(pending) }
    }

    private inner class Connection(private val socket: Socket) {
        private val pairing = ReceiverPairing(config.identity)
        private var handshake: ByteArray? = null
        private var key: ByteArray? = null
        private var mirror: ReceiverMirrorStream? = null
        private var mirrorToken: Any? = null
        private var audio: ReceiverAudioDrain? = null
        private var audioIv: ByteArray? = null
        private var timing: NtpClock? = null
        private val output = socket.getOutputStream()
        // One ordered, bounded writer per connection; neither ownership nor shutdown waits for its I/O.
        private val events = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(32)) {
            Thread(it, "tiplay-airplay-events").apply { isDaemon = true }
        }
        private var reverseId: String? = null
        private val peer = socket.inetAddress
        val diagnosticId = connectionIds.incrementAndGet()

        fun run() {
            var stage = ReceiverProtocolDiagnostics.Stage.ACCEPT
            diagnostics.stage(diagnosticId, stage)
            try {
                TcpLiveness.configure(socket) {}
                socket.tcpNoDelay = true
                socket.soTimeout = 120_000
                val input = BufferedInputStream(socket.getInputStream())
                while (!closed.get() && !socket.isClosed) {
                    stage = ReceiverProtocolDiagnostics.Stage.READ
                    val request = readReceiverRequest(input) ?: break
                    // Replies to our POST /event have the same framing, but are not requests.
                    if (request.method.startsWith("HTTP/")) continue
                    diagnostics.request(diagnosticId, request)
                    stage = ReceiverProtocolDiagnostics.Stage.DISPATCH
                    val response = try { dispatch(request) }
                    catch (error: IllegalArgumentException) {
                        diagnostics.failure(diagnosticId, stage, error); RtspMessage.Response(status = 400)
                    }
                    catch (error: IllegalStateException) {
                        diagnostics.failure(diagnosticId, stage, error); RtspMessage.Response(status = 400)
                    }
                    catch (error: Exception) {
                        diagnostics.failure(diagnosticId, stage, error); RtspMessage.Response(status = 500)
                    }
                    diagnostics.response(diagnosticId, response)
                    stage = ReceiverProtocolDiagnostics.Stage.WRITE
                    synchronized(output) {
                        if (response.status == 101) reverseId?.let {
                            reverse.put(it, this)?.takeIf { old -> old !== this }?.socket?.close()
                        }
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
            reverseId?.let { id ->
                if (reverse.remove(id, this)) synchronized(ownership) {
                    if (playbackId == id && playbackPeer == peer) finishPlayback()
                }
            }
            synchronized(ownership) {
                closeMedia()
                if (owner === this) { owner = null; listener.status("listening") }
            }
        }

        fun closeMedia() {
            if (owner === this) listener.stopMirrorAudio()
            mirrorToken = null
            mirror?.close(); mirror = null
            audio?.close(); audio = null
            timing?.close(); timing = null
            key = null; handshake = null
            audioIv?.fill(0); audioIv = null
        }

        fun event(state: String, id: String) {
            val body = receiverXml(mapOf("category" to "video", "state" to state))
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
                    }
                }
            } catch (_: RejectedExecutionException) {
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
            when {
                path == "/info" -> {
                    return ReceiverInfoProtocol.response(config, request)
                }
                path == "/server-info" -> return xml(config.serverInfo())
                path == "/pair-setup" -> return ReceiverHandshake.pairing { pairing.setup(request.body) }
                path == "/pair-verify" -> return ReceiverHandshake.pairing { pairing.verify(request.body) }
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
                            if (96 in types) { audio?.close(); audio = null; if (owner === this) listener.stopMirrorAudio() }
                            if (110 in types) {
                                mirrorToken = null
                                val hadMirror = mirror != null
                                mirror?.close(); mirror = null
                                if (hadMirror && owner === this) listener.status("listening")
                            }
                            if (audio != null || mirror != null) return RtspMessage.Response()
                            closeMedia()
                        }
                        if (owner === this) { owner = null; listener.status("listening") }
                    }
                    return RtspMessage.Response(headers = mapOf("Connection" to "close"))
                }
                path == "/reverse" && request.method == "POST" -> {
                    if (!request.headers["upgrade"].equals("PTTH/1.0", true)) return RtspMessage.Response(status = 400)
                    synchronized(ownership) {
                        if (playbackPeer != null && playbackPeer != peer) return busy()
                    }
                    reverseId = id
                    return RtspMessage.Response(status = 101, statusText = "Switching Protocols",
                        headers = mapOf("Connection" to "Upgrade", "Upgrade" to "PTTH/1.0"))
                }
                path == "/play" && request.method == "POST" -> {
                    val item = ReceiverPlay.parse(request)
                    synchronized(ownership) {
                        if (closed.get()) return busy()
                        if ((owner != null && owner !== this) || (playbackPeer != null && playbackPeer != peer)) return busy()
                        owner?.closeMedia(); owner = null
                        resources.clear()
                        playbackPeer = peer; playbackId = id
                        listener.play(item.copy(iphoneHost = peer.hostAddress)); listener.status("video")
                    }
                    return RtspMessage.Response()
                }
                path == "/photo" && request.method == "PUT" -> {
                    synchronized(ownership) {
                        if (closed.get() || owner != null || (playbackPeer != null &&
                                (playbackPeer != peer || playbackId != id))) return busy()
                        if (photoSession != (peer to id)) { photos = ReceiverPhotos(); photoSession = peer to id }
                        val image = photos.receive(request.headers["x-apple-assetaction"],
                            request.headers["x-apple-assetkey"], request.body)
                        if (image != null) {
                            playbackPeer = peer; playbackId = id
                            listener.photo(image); listener.status("photo")
                        }
                    }
                    return RtspMessage.Response()
                }
                path == "/action" && request.method == "POST" -> {
                    val message = BplistCodec.decode(request.body) as? Map<*, *> ?: error("invalid action")
                    if (message["type"] != "unhandledURLResponse") return RtspMessage.Response(status = 501, statusText = "Not Implemented")
                    val params = message["params"] as? Map<*, *> ?: error("missing params")
                    val requestId = (params["FCUP_Response_RequestID"] as? Number)?.toLong() ?: error("missing request id")
                    val pending = resources[requestId] ?: return RtspMessage.Response(status = 404)
                    if (pending.session != id || pending.peer != peer || pending.url != params["FCUP_Response_URL"]) {
                        return RtspMessage.Response(status = 403, statusText = "Forbidden")
                    }
                    val headers = params["FCUP_Response_Headers"] as? Map<*, *>
                    val location = headers?.entries?.firstOrNull { it.key.toString().equals("Location", true) }?.value as? String
                    diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.RESPONSE, requestId,
                        (params["FCUP_Response_StatusCode"] as? Number)?.toInt(),
                        (params["FCUP_Response_Data"] as? ByteArray)?.size)
                    pending.future.complete(ReceiverResource(params["FCUP_Response_Data"] as? ByteArray,
                        (params["FCUP_Response_StatusCode"] as? Number)?.toInt(), location))
                    return RtspMessage.Response()
                }
                ReceiverVideoProperties.handles(request) -> {
                    synchronized(ownership) {
                        if (path != "/fp-setup2" && (playbackPeer != peer || playbackId != id)) {
                            return RtspMessage.Response(status = 403, statusText = "Forbidden")
                        }
                        return ReceiverVideoProperties.response(request)
                    }
                }
                path in listOf("/stop", "/scrub", "/rate", "/playback-info") -> {
                    synchronized(ownership) {
                        if (playbackPeer != peer || playbackId != id) return RtspMessage.Response(status = 403, statusText = "Forbidden")
                        when (path) {
                            "/stop" -> finishPlayback()
                            "/scrub" -> if (request.method == "POST") {
                                val value = query["position"]?.toDoubleOrNull()
                                require(value != null && value.isFinite() && value >= 0); listener.seek(value)
                            } else {
                                val state = listener.playback()
                                return RtspMessage.Response(headers = mapOf("Content-Type" to "text/parameters"),
                                    body = "duration: ${state.duration}\r\nposition: ${state.position}\r\n".toByteArray())
                            }
                            "/rate" -> { val value = query["value"]?.toDoubleOrNull(); require(value == 0.0 || value == 1.0); listener.rate(value!!) }
                            "/playback-info" -> return xml(listener.playback().info())
                        }
                    }
                    return RtspMessage.Response()
                }
                request.method == "GET_PARAMETER" -> return ReceiverMirrorParameters.reply(request)
                request.method == "SET_PARAMETER" -> return ReceiverMetadata.receive(request) {
                    listener.log("c=$diagnosticId $it")
                }
                request.method == "FLUSH" || path == "/feedback" -> return RtspMessage.Response()
                else -> return RtspMessage.Response(status = 404)
            }
        }

        private fun setup(request: RtspMessage.Request): RtspMessage.Response = synchronized(ownership) {
            if (closed.get() || (owner != null && owner !== this) || playbackPeer != null) return busy()
            val dict = BplistCodec.decode(request.body) as? Map<*, *> ?: error("setup must be dictionary")
            diagnostics.setup(diagnosticId, dict, pairing.sharedSecret != null, handshake?.size ?: 0)
            val requestedStreams = dict["streams"]?.let { value ->
                require(value is List<*> && value.size <= 16)
                val entries = value.map { it as? Map<*, *> ?: error("invalid stream") }
                val types = entries.map { (it["type"] as? Number)?.toInt() }
                require(types.all { it == 96 || it == 110 } && types.distinct().size == types.size)
                entries.filter { (it["type"] as Number).toInt() == 96 }.forEach(ReceiverAudioCapabilities::validateStream)
                entries.filter { (it["type"] as Number).toInt() == 110 }.forEach {
                    require(it["streamConnectionID"] is Number) { "missing connection id" }
                }
                entries
            }
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
                        val order = ReceiverMirrorAudioTiming(format?.sampleRate ?: 44100, requireNotNull(timing)::ntpTimeNanos)
                        fun deliver(packets: List<ReceiverMirrorAudioTiming.Packet>) {
                            if (format != null && synchronized(ownership) { mirror != null && owner === this }) {
                                packets.forEach { listener.mirrorAudioTimed(format, it.payload, it.sample, it.presentationNanos) }
                            }
                        }
                        val receiver = ReceiverAudioDrain(peer, { listener.log("c=$diagnosticId $it") }, packetReceived = { packet ->
                            // Ordinary audio without an active mirror is deliberately not a product mode.
                            if (format != null && iv != null && synchronized(ownership) { mirror != null && owner === this }) {
                                ReceiverMirrorAudioPacket.decrypt(packet, audioKey, iv)?.let { payload ->
                                    deliver(order.offer(packet, payload))
                                }
                            }
                        }, controlReceived = order::sync, idle = { deliver(order.drain()) })
                        val ports = receiver.start()
                        audio?.close()
                        audio = receiver
                        owner = this
                        return@mapNotNull mapOf("type" to 96, "dataPort" to ports.first, "controlPort" to ports.second)
                    }
                    val streamKey = requireNotNull(key)
                    val clock = requireNotNull(timing)
                    val connectionId = (stream["streamConnectionID"] as? Number)?.toLong() ?: error("missing connection id")
                    mirror?.close()
                    val token = Any()
                    mirrorToken = token
                    val receiver = ReceiverMirrorStream(streamKey, connectionId, peer, listener.mirrorSink(), clock,
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
                                listener.status("listening")
                            }
                        }
                    }
                    mirror = receiver; owner = this
                    val dataPort = receiver.start()
                    listener.status("mirror")
                    mapOf("type" to 110, "dataPort" to dataPort)
                }
            }
            plist(response)
        }
    }
}

private fun busy() = RtspMessage.Response(status = 453, statusText = "Not Enough Bandwidth")
private fun plist(dict: Map<String, Any?>) = RtspMessage.Response(headers = mapOf("Content-Type" to "application/x-apple-binary-plist"), body = BplistCodec.encode(dict))
private fun xml(dict: Map<String, Any?>) = RtspMessage.Response(headers = mapOf("Content-Type" to "text/x-apple-plist+xml"), body = receiverXml(dict))

/** Bound allocation before passing framing to the shared RTSP parser. */
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
    require(length in 0..1024 * 1024)
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
