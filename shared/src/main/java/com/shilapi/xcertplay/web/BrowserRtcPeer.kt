package com.shilapi.xcertplay.web

import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtcCertificatePem
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.ArrayDeque
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** A DataChannel-only peer. No native audio/video tracks, microphone, STUN servers or relays. */
class BrowserRtcPeer internal constructor(
    private val factory: PeerConnectionFactory,
    private val certificate: RtcCertificatePem,
    private val onControl: (String) -> Unit,
    private val onFailure: (String) -> Unit,
) : BrowserRtcConnection {
    override val id: Int = SecureRandom().nextInt(Int.MAX_VALUE - 1) + 1
    private val closed = AtomicBoolean(false)
    @Volatile private var authenticated = false
    private val worker = ScheduledThreadPoolExecutor(1) { task -> Thread(task, "browser-rtc-media").apply { isDaemon = true } }
    private val controls = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(128),
        { task -> Thread(task, "browser-rtc-control").apply { isDaemon = true } })
    private val nativeLock = Any()
    private val channelsLock = Any()
    private val receivedChannels = ArrayList<DataChannel>(3)
    private val pendingTasks = AtomicInteger()
    private var peer: PeerConnection? = null
    @Volatile private var control: DataChannel? = null
    private var answerCallback: ((String) -> Unit)? = null
    private var answerStarted = false
    private var messageLimit = BrowserRtcProtocol.MAX_MESSAGE_BYTES
    @Volatile private var ready = false
    @Volatile private var controlBufferedBytes = 0L
    @Volatile private var nativeSampleNanos = 0L
    @Volatile private var controlRecordsSent = 0L
    @Volatile private var controlBytesSent = 0L
    @Volatile private var terminalDiagnostics: Map<String, Any?>? = null
    private val video = Sender("video", BrowserRtcProtocol.MAX_VIDEO_BYTES, 12 * 1024 * 1024, 10 * 1024 * 1024L)
    private val audio = Sender("audio", BrowserRtcProtocol.MAX_AUDIO_BYTES, 2 * 1024 * 1024, 1024 * 1024L)

    init {
        worker.removeOnCancelPolicy = true
        worker.schedule({ if (!authenticated) fail("WebRTC authentication timed out") }, 15, TimeUnit.SECONDS)
        worker.scheduleWithFixedDelay({ guarded { pump() } }, 0, 5, TimeUnit.MILLISECONDS)
    }

    /** Exactly one offer per peer. Answer contains gathered host ICE candidates; no trickle endpoint. */
    override fun answer(offerSdp: String, onAnswer: (String) -> Unit) = execute {
        check(!answerStarted) { "offer already supplied" }
        require(offerSdp.length in 1..131072) { "invalid SDP size" }
        require(!Regex("(?m)^m=(audio|video) ").containsMatchIn(offerSdp)) { "native media tracks are not supported" }
        messageLimit = BrowserRtcProtocol.messageLimit(offerSdp)
        answerStarted = true
        answerCallback = onAnswer
        val configuration = PeerConnection.RTCConfiguration(emptyList()).apply {
            certificate = this@BrowserRtcPeer.certificate
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE
            enableCpuOveruseDetection = false
        }
        val connection = checkNotNull(factory.createPeerConnection(configuration, observer)) { "cannot create WebRTC peer" }
        synchronized(nativeLock) { peer = connection }
        connection.setAudioPlayout(false)
        connection.setAudioRecording(false)
        connection.setRemoteDescription(sdpObserver(onSet = {
            connection.createAnswer(sdpObserver(onCreate = { description ->
                connection.setLocalDescription(sdpObserver(onSet = {
                    if (connection.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE) finishAnswer()
                }), description)
            }), MediaConstraints())
        }), SessionDescription(SessionDescription.Type.OFFER, offerSdp))
        worker.schedule({ if (answerCallback != null) fail("WebRTC ICE gathering timed out") }, 10, TimeUnit.SECONDS)
    }

    /** Called only after the pairing gate validates the code inside the pinned encrypted channel. */
    override fun authenticate() { authenticated = true }

    /** Numeric snapshots only: status/control never waits for the native signaling thread or media locks. */
    override fun diagnostics(): Map<String, Any?> {
        terminalDiagnostics?.let { return it }
        val now = System.nanoTime()
        return mapOf(
            "session" to id, "authenticated" to authenticated, "ready" to ready, "closed" to closed.get(),
            "video" to video.diagnostics(now), "audio" to audio.diagnostics(now),
            "control" to mapOf("nativeBufferedBytes" to controlBufferedBytes,
                "recordsSent" to controlRecordsSent, "bytesSent" to controlBytesSent,
                "pendingReceiveTasks" to controls.queue.size),
            "nativeSampleAgeMs" to ageMillis(now, nativeSampleNanos),
            "pendingWorkerTasks" to pendingTasks.get(), "transportBudgetMs" to 200,
        )
    }

    override fun sendControl(message: String): Boolean {
        val bytes = message.toByteArray(Charsets.UTF_8)
        if (closed.get() || bytes.size > BrowserRtcProtocol.MAX_MESSAGE_BYTES) return false
        return synchronized(nativeLock) {
            val channel = control ?: return@synchronized false
            if (closed.get() || channel.state() != DataChannel.State.OPEN) false
            else {
                controlBufferedBytes = channel.bufferedAmount()
                if (controlBufferedBytes > 256 * 1024) { fail("control send queue exceeded"); false }
                else channel.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false)).also { sent ->
                    if (sent) { controlRecordsSent++; controlBytesSent += bytes.size }
                }
            }
        }
    }

    override fun sendVideo(record: WebVideoRecord): Boolean {
        if (record.payloadLength !in 0..WebVideoRecords.MAX_PAYLOAD) {
            fail("video record too large"); return false
        }
        return enqueue(video, WebVideoRecords.encode(record))
    }
    override fun sendAudio(record: ByteArray): Boolean = enqueue(audio, record)

    private fun enqueue(sender: Sender, bytes: ByteArray): Boolean {
        if (closed.get() || !authenticated) return false
        var overload = false
        val accepted = synchronized(sender) {
            if (closed.get()) false
            else if (bytes.isEmpty() || bytes.size > sender.recordLimit || bytes.size > sender.queueLimit - sender.queuedBytes) {
                overload = true; false
            } else {
                sender.queue.addLast(Pending(bytes, System.nanoTime()))
                sender.queuedBytes += bytes.size
                sender.queuedRecords = sender.queue.size
                sender.oldestQueuedNanos = sender.queue.peekFirst()?.queuedNanos ?: 0
                sender.acceptedRecords++
                sender.acceptedBytes += bytes.size
                true
            }
        }
        if (overload) fail("${sender.label} sender capacity exceeded; reconnect required")
        return accepted
    }

    private fun pump() {
        if (closed.get() || !authenticated) return
        synchronized(nativeLock) {
            if (closed.get()) return
            for (sender in listOf(audio, video)) {
                sender.channel?.let { sender.nativeBufferedBytes = it.bufferedAmount() }
            }
            control?.let { controlBufferedBytes = it.bufferedAmount() }
            nativeSampleNanos = System.nanoTime()
        }
        for (sender in listOf(audio, video)) synchronized(sender) {
            val now = System.nanoTime()
            check(sender.queue.peekFirst()?.let { now - it.queuedNanos > MEDIA_DEADLINE_NANOS } != true &&
                sender.credit.oldestNanos?.let { now - it > MEDIA_DEADLINE_NANOS } != true) {
                "${sender.label} transport exceeded 200 ms budget; reconnect required"
            }
        }
        if (!ready) return
        // Alternate small fragments: audio/control must not wait for an entire large video IDR.
        repeat(16) { pumpOne(audio); pumpOne(video) }
    }

    private fun pumpOne(sender: Sender) = synchronized(sender) {
        val pending = sender.queue.peekFirst() ?: return@synchronized
        check(System.nanoTime() - pending.queuedNanos <= MEDIA_DEADLINE_NANOS) {
            "${sender.label} transport exceeded 200 ms budget; reconnect required"
        }
        synchronized(nativeLock) {
            if (closed.get()) return@synchronized
            val channel = sender.channel ?: return@synchronized
            sender.nativeBufferedBytes = channel.bufferedAmount()
            if (channel.state() != DataChannel.State.OPEN || sender.nativeBufferedBytes > 128 * 1024) return@synchronized
            if (!pending.reserved) {
                if (!sender.credit.reserve(pending.bytes.size, pending.queuedNanos)) return@synchronized
                sender.captureCredit()
                pending.reserved = true
                check(sender.nextRecord < Int.MAX_VALUE) { "record sequence exhausted" }
                pending.record = sender.nextRecord++
            }
            val fragment = BrowserRtcProtocol.fragment(id, pending.record, pending.bytes, pending.offset, messageLimit)
            check(channel.send(DataChannel.Buffer(ByteBuffer.wrap(fragment), true))) { "${sender.label} send failed" }
            val sentNanos = System.nanoTime()
            sender.fragmentsSent++
            sender.wireBytesSent += fragment.size
            sender.recordBytesSent += fragment.size - BrowserRtcProtocol.HEADER_BYTES
            if (pending.offset == 0) {
                val wait = sentNanos - pending.queuedNanos
                sender.queueWaitNanosSum += wait
                sender.queueWaitNanosMax = maxOf(sender.queueWaitNanosMax, wait)
                sender.recordsStarted++
            }
            pending.offset += fragment.size - BrowserRtcProtocol.HEADER_BYTES
            if (pending.offset == pending.bytes.size) {
                sender.queue.removeFirst()
                sender.queuedBytes -= pending.bytes.size
                sender.queuedRecords = sender.queue.size
                sender.oldestQueuedNanos = sender.queue.peekFirst()?.queuedNanos ?: 0
                val elapsed = sentNanos - pending.queuedNanos
                sender.queuedToNativeNanosSum += elapsed
                sender.queuedToNativeNanosMax = maxOf(sender.queuedToNativeNanosMax, elapsed)
                sender.recordsSent++
            }
        }
    }

    private fun receive(json: String) {
        val body = WebJson.parse(json) as? Map<*, *> ?: error("invalid control object")
        when (body["type"]) {
            "rtc-ready" -> execute {
                check(authenticated && !ready) { "unauthenticated or duplicate media readiness" }
                check(body["session"] as? Long == id.toLong()) { "stale media session" }
                val remoteLimit = body["maxMessageSize"] as? Long ?: error("missing message limit")
                require(remoteLimit in (BrowserRtcProtocol.HEADER_BYTES + 1L)..BrowserRtcProtocol.MAX_MESSAGE_BYTES.toLong())
                messageLimit = minOf(messageLimit, remoteLimit.toInt())
                synchronized(video) { video.credit.initialize(body["videoCredit"] as? Long ?: 0); video.captureCredit() }
                synchronized(audio) { audio.credit.initialize(body["audioCredit"] as? Long ?: 0); audio.captureCredit() }
                ready = true
            }
            "rtc-ack" -> {
                check(authenticated) { "unauthenticated credit" }
                val sender = when (body["channel"]) { "video" -> video; "audio" -> audio; else -> error("unknown channel") }
                synchronized(sender) {
                    sender.credit.acknowledge(body["consumed"] as? Long ?: -1)
                    sender.captureCredit()
                }
            }
            else -> onControl(json)
        }
    }

    private fun attach(channel: DataChannel) {
        val label = channel.label()
        synchronized(nativeLock) {
            if (closed.get()) return
            when (label) {
                "control" -> { check(control == null) { "duplicate control channel" }; control = channel }
                "video" -> { check(video.channel == null) { "duplicate video channel" }; video.channel = channel }
                "audio" -> { check(audio.channel == null) { "duplicate audio channel" }; audio.channel = channel }
                else -> error("unknown data channel")
            }
            channel.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previousAmount: Long) = Unit
                override fun onStateChange() {
                    execute { if (channel.state() == DataChannel.State.CLOSED) fail("$label channel closed") }
                }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    if (label != "control" || buffer.binary || buffer.data.remaining() > BrowserRtcProtocol.MAX_MESSAGE_BYTES) {
                        fail("invalid inbound $label message"); return
                    }
                    val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
                    try { controls.execute { guarded { receive(String(bytes, Charsets.UTF_8)) } } }
                    catch (_: RejectedExecutionException) { fail("control receive capacity exceeded") }
                }
            })
        }
    }

    private fun finishAnswer() {
        if (closed.get()) return
        val callback = answerCallback ?: return
        val description = peer?.localDescription?.description ?: return
        answerCallback = null
        callback(description)
    }

    private fun execute(task: () -> Unit) {
        if (closed.get()) return
        if (pendingTasks.incrementAndGet() > 64) {
            pendingTasks.decrementAndGet()
            fail("WebRTC worker capacity exceeded")
            return
        }
        try {
            worker.execute {
                try { guarded { synchronized(nativeLock) { if (!closed.get()) task() } } }
                finally { pendingTasks.decrementAndGet() }
            }
        } catch (_: RejectedExecutionException) { pendingTasks.decrementAndGet() }
    }

    private fun guarded(task: () -> Unit) {
        if (!closed.get()) try { task() } catch (failure: Exception) { fail(failure.message ?: "WebRTC failure") }
    }

    private fun fail(reason: String) {
        if (!closed.compareAndSet(false, true)) return
        terminalDiagnostics = diagnostics() + mapOf("failure" to reason)
        dispose(reason)
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            terminalDiagnostics = diagnostics()
            dispose()
        }
    }

    private fun dispose(failureReason: String? = null) {
        worker.shutdownNow()
        controls.shutdownNow()
        // A libwebrtc callback must return before disposing its native signaling thread.
        Thread({
            val channels = synchronized(channelsLock) { receivedChannels.toList().also { receivedChannels.clear() } }
            synchronized(nativeLock) {
                channels.forEach {
                    runCatching { it.unregisterObserver(); it.close(); it.dispose() }
                }
                control = null; video.channel = null; audio.channel = null
                peer?.let { runCatching { it.close(); it.dispose() } }; peer = null
            }
            for (sender in listOf(video, audio)) synchronized(sender) {
                sender.queue.clear(); sender.queuedBytes = 0; sender.queuedRecords = 0; sender.oldestQueuedNanos = 0
            }
            if (failureReason != null) runCatching { onFailure(failureReason) }
        }, "browser-rtc-dispose").apply { isDaemon = true }.start()
    }

    private fun sdpObserver(onCreate: (SessionDescription) -> Unit = {}, onSet: () -> Unit = {}) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = execute { onCreate(description) }
        override fun onSetSuccess() = execute(onSet)
        override fun onCreateFailure(error: String) { fail("SDP create: $error") }
        override fun onSetFailure(error: String) { fail("SDP set: $error") }
    }

    private val observer = object : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            if (state == PeerConnection.IceConnectionState.FAILED) fail("WebRTC ICE failed")
        }
        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
            if (state == PeerConnection.PeerConnectionState.FAILED) fail("WebRTC connection failed")
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
            if (state == PeerConnection.IceGatheringState.COMPLETE) execute { finishAnswer() }
        }
        override fun onIceCandidate(candidate: IceCandidate) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(channel: DataChannel) {
            val accepted = synchronized(channelsLock) {
                if (closed.get()) false else { receivedChannels.add(channel); true }
            }
            if (!accepted) { runCatching { channel.close(); channel.dispose() }; return }
            if (synchronized(channelsLock) { receivedChannels.size > 3 }) fail("too many data channels")
            else execute { attach(channel) }
        }
        override fun onRenegotiationNeeded() = Unit
    }

    private class Sender(val label: String, val recordLimit: Int, val queueLimit: Int, maxCredit: Long) {
        @Volatile var channel: DataChannel? = null
        val queue = ArrayDeque<Pending>()
        @Volatile var queuedBytes = 0
        @Volatile var queuedRecords = 0
        @Volatile var oldestQueuedNanos = 0L
        @Volatile var oldestUnackedNanos = 0L
        @Volatile var receiverWindowBytes = 0L
        @Volatile var receiverReservedBytes = 0L
        @Volatile var receiverConsumedBytes = 0L
        @Volatile var nativeBufferedBytes = 0L
        @Volatile var acceptedRecords = 0L
        @Volatile var acceptedBytes = 0L
        @Volatile var fragmentsSent = 0L
        @Volatile var recordsStarted = 0L
        @Volatile var recordsSent = 0L
        @Volatile var recordBytesSent = 0L
        @Volatile var wireBytesSent = 0L
        @Volatile var queueWaitNanosSum = 0L
        @Volatile var queueWaitNanosMax = 0L
        @Volatile var queuedToNativeNanosSum = 0L
        @Volatile var queuedToNativeNanosMax = 0L
        var nextRecord = 1
        val credit = BrowserRtcCredit(maxCredit)

        /** Called with this sender's lock, never while collecting diagnostics. */
        fun captureCredit() {
            receiverWindowBytes = credit.window
            receiverReservedBytes = credit.reserved
            receiverConsumedBytes = credit.consumed
            oldestUnackedNanos = credit.oldestNanos ?: 0L
        }

        fun diagnostics(now: Long): Map<String, Any?> {
            val reserved = receiverReservedBytes
            val consumed = receiverConsumedBytes
            val sent = recordsSent
            val started = recordsStarted
            return mapOf(
                "queueBytes" to queuedBytes, "queueRecords" to queuedRecords,
                "queueLimitBytes" to queueLimit, "oldestQueuedAgeMs" to ageMillis(now, oldestQueuedNanos),
                "receiverWindowBytes" to receiverWindowBytes, "receiverReservedBytes" to reserved,
                "receiverConsumedBytes" to consumed, "receiverInFlightBytes" to maxOf(0L, reserved - consumed),
                "oldestUnackedAgeMs" to ageMillis(now, oldestUnackedNanos),
                "nativeBufferedBytes" to nativeBufferedBytes, "acceptedRecords" to acceptedRecords,
                "acceptedBytes" to acceptedBytes, "fragmentsSent" to fragmentsSent, "recordsSent" to sent,
                "recordBytesSent" to recordBytesSent, "wireBytesSent" to wireBytesSent,
                "queueWaitMsMean" to if (started > 0) queueWaitNanosSum / started / 1e6 else null,
                "queueWaitMsMax" to queueWaitNanosMax / 1e6,
                "queuedToNativeSendMsMean" to if (sent > 0) queuedToNativeNanosSum / sent / 1e6 else null,
                "queuedToNativeSendMsMax" to queuedToNativeNanosMax / 1e6,
            )
        }
    }

    private class Pending(val bytes: ByteArray, val queuedNanos: Long) {
        var offset = 0
        var record = 0
        var reserved = false
    }

    private companion object {
        // Local queue/credit watchdog only; physical sender-relative output also needs clock/panel evidence.
        val MEDIA_DEADLINE_NANOS = TimeUnit.MILLISECONDS.toNanos(200)
        fun ageMillis(now: Long, started: Long): Double? = if (started == 0L) null else maxOf(0L, now - started) / 1e6
    }
}
