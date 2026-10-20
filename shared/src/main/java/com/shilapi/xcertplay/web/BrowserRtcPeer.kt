package com.shilapi.xcertplay.web

import android.content.Context
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.CandidatePairChangeEvent
import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.Closeable
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Injectable so source/JVM harnesses need not load Android native WebRTC. */
fun interface BrowserRtcFactory {
    fun create(session: String, control: (Map<*, *>) -> String): BrowserRtcSession
}

interface BrowserRtcSession : Closeable {
    val session: String
    val epoch: Int
    val live: Boolean
    fun answer(offer: String): String
    fun snapshot(): Map<String, Any?>
    fun maintain()
    fun retire(reason: String) { close() }
}

/** Only the Android product constructs this factory. No RTP tracks, microphone or video encoder. */
class AndroidBrowserRtcFactory(
    context: Context,
    private val video: WebVideoHub,
    private val audio: WebAudioHub?,
    private val log: (String) -> Unit,
) : BrowserRtcFactory {
    private val context = context.applicationContext
    override fun create(session: String, control: (Map<*, *>) -> String): BrowserRtcSession =
        AndroidBrowserRtcPeer(context, session, video, audio, log, control)
}

private class AndroidBrowserRtcPeer(
    private val context: Context,
    override val session: String,
    private val video: WebVideoHub,
    private val audio: WebAudioHub?,
    private val log: (String) -> Unit,
    private val control: (Map<*, *>) -> String,
) : BrowserRtcSession {
    override val epoch = SecureRandom().nextInt(Int.MAX_VALUE - 1) + 1
    private val closed = AtomicBoolean(false)
    private val lifecycle = Executors.newSingleThreadExecutor { Thread(it, "browser-rtc-peer").apply { isDaemon = true } }
    private val media = Executors.newFixedThreadPool(2) { Thread(it, "browser-rtc-media").apply { isDaemon = true } }
    private val controls = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(64),
        { Thread(it, "browser-rtc-control").apply { isDaemon = true } })
    private val controlPending = java.util.concurrent.atomic.AtomicInteger()
    private val channels = ConcurrentHashMap<String, DataChannel>()
    private val channelStarted = ConcurrentHashMap.newKeySet<String>()
    private val credits = mapOf("video" to BrowserRtcCredit(BrowserRtcProtocol.VIDEO_WINDOW),
        "audio" to BrowserRtcCredit(BrowserRtcProtocol.AUDIO_WINDOW))
    private val wake = Object()
    private val nativeLock = Any()
    private val admission = Any()
    private val gathering = CountDownLatch(1)
    private var factory: PeerConnectionFactory? = null
    private var connection: PeerConnection? = null
    @Volatile private var videoSubscription: WebVideoSubscription? = null
    @Volatile private var audioSubscription: WebAudioHub.Subscription? = null
    private val audioLease = BrowserRtcAudioLease()
    @Volatile private var connected = false
    @Volatile private var everConnected = false
    @Volatile private var disconnectedSince: Long? = null
    @Volatile private var state = "new"
    private val created = System.nanoTime()
    private val records = java.util.concurrent.atomic.AtomicLong()
    private val audioCapture = BrowserRtcAudioCapture(epoch)
    private val candidateCounts = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicInteger>()

    override val live: Boolean get() = !closed.get()

    override fun answer(offer: String): String {
        require(offer.length in 1..48 * 1024 && offer.lineSequence().any { it.startsWith("m=application ") }) { "invalid data offer" }
        require(offer.lineSequence().none { it.startsWith("m=audio ") || it.startsWith("m=video ") ||
            (it.startsWith("a=candidate:") && (it.contains(" typ relay") || it.contains(" typ srflx"))) }) { "non-local or media-track offer" }
        require(offer.lineSequence().filter { it.startsWith("a=max-message-size:") }.all {
            val maximum = it.substringAfter(':').trim().toLongOrNull()
            maximum != null && (maximum == 0L || maximum >= BrowserRtcProtocol.MESSAGE_BYTES)
        }) { "unsupported-message-size" }
        val task = lifecycle.submit<String> {
            check(!closed.get())
            initialize(context)
            // Hotspot/AP and Shizuku /32 aliases need real interface-bound UDP sockets even when
            // ConnectivityManager does not expose a Network handle for that server interface.
            // M144 AndroidNetworkMonitor otherwise marks such interfaces unavailable. Native
            // getifaddrs enumeration retains IPv4 link-local addresses; never rewrite candidates.
            factory = PeerConnectionFactory.builder().setOptions(PeerConnectionFactory.Options().apply {
                disableNetworkMonitor = true
            }).createPeerConnectionFactory()
            val config = PeerConnection.RTCConfiguration(emptyList()).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE
                // Host candidates only. No Internet STUN, TURN or media relay.
                iceTransportsType = PeerConnection.IceTransportsType.ALL
                tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
            }
            connection = requireNotNull(factory?.createPeerConnection(config, observer)) { "peer allocation" }
            awaitSdp("remote-description") { connection!!.setRemoteDescription(it, SessionDescription(SessionDescription.Type.OFFER, offer)) }
            val answer = awaitSdp("create-answer") { connection!!.createAnswer(it, MediaConstraints()) }
            awaitSdp("local-description") { connection!!.setLocalDescription(it, requireNotNull(answer)) }
            check(gathering.await(5, TimeUnit.SECONDS)) { "ice-gather-timeout" }
            check(!closed.get()) { "peer retired" }
            state = "connecting"
            log("Browser RTC: stage=signaling epoch=$epoch state=answer candidates=host enumeration=interfaces transport=${BrowserRtcProtocol.NAME}")
            requireNotNull(connection!!.localDescription).description
        }
        return try { task.get(9, TimeUnit.SECONDS) } catch (error: Exception) {
            log("Browser RTC: stage=signaling epoch=$epoch reason=answer-failed exception=${DiagnosticErrorText.describe(error)}")
            retire("signaling-failed"); throw IllegalStateException("rtc-signaling-failed", error)
        }
    }

    private val observer = object : PeerConnection.Observer {
        override fun onSignalingChange(value: PeerConnection.SignalingState) {}
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(value: PeerConnection.IceGatheringState) {
            if (value == PeerConnection.IceGatheringState.COMPLETE) {
                log("Browser RTC: stage=ice-gather epoch=$epoch state=complete candidateCounts=${candidateCounts.mapValues { it.value.get() }}")
                gathering.countDown()
            }
        }
        override fun onIceCandidate(candidate: IceCandidate) {
            val description = candidateDescription(candidate)
            candidateCounts.computeIfAbsent(description) { java.util.concurrent.atomic.AtomicInteger() }.incrementAndGet()
        }
        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent) {
            log("Browser RTC: stage=ice-pair epoch=$epoch local=${candidateDescription(event.local)} remote=${candidateDescription(event.remote)} disconnectedMs=${event.estimatedDisconnectedTimeMs}")
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) { fail("unexpected-media-track") }
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onRenegotiationNeeded() {}
        override fun onIceConnectionChange(value: PeerConnection.IceConnectionState) {
            state = value.name.lowercase()
            connected = value == PeerConnection.IceConnectionState.CONNECTED || value == PeerConnection.IceConnectionState.COMPLETED
            if (connected) { everConnected = true; disconnectedSince = null }
            else if (value == PeerConnection.IceConnectionState.DISCONNECTED && disconnectedSince == null) disconnectedSince = System.nanoTime()
            log("Browser RTC: stage=ice epoch=$epoch state=$state")
            if (value == PeerConnection.IceConnectionState.FAILED || value == PeerConnection.IceConnectionState.CLOSED) fail("ice-$state")
        }
        override fun onDataChannel(channel: DataChannel) {
            synchronized(admission) {
            if (closed.get()) { disposeOrphan(channel); return }
            val label = channel.label()
            if (label !in setOf("video", "audio", "control") || channels.putIfAbsent(label, channel) != null) {
                disposeOrphan(channel)
                fail("unexpected-channel"); return
            }
            channel.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previousAmount: Long) { synchronized(wake) { wake.notifyAll() } }
                override fun onStateChange() {
                    if (closed.get()) return
                    if (channel.state() == DataChannel.State.OPEN) startChannel(label)
                    else if (channel.state() == DataChannel.State.CLOSED) fail("channel-closed")
                    synchronized(wake) { wake.notifyAll() }
                }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    if (label != "control" || buffer.binary || buffer.data.remaining() > 64 * 1024) { fail("invalid-control"); return }
                    val bytes = ByteArray(buffer.data.remaining()).also(buffer.data::get)
                    // Native callback must never perform app callbacks, source writes or HTTP/disk I/O.
                    if (!closed.get()) {
                        controlPending.incrementAndGet()
                        try { controls.execute { try { receiveControl(bytes) } finally {
                            controlPending.decrementAndGet(); synchronized(wake) { wake.notifyAll() }
                        } } } catch (_: java.util.concurrent.RejectedExecutionException) {
                            controlPending.decrementAndGet(); fail("control-overload")
                        }
                    }
                }
            })
            // OPEN may precede registration for remotely-created channels.
            if (channel.state() == DataChannel.State.OPEN) startChannel(label)
            }
        }
    }

    private fun startChannel(label: String) {
        if (closed.get() || !channelStarted.add(label)) return
        log("Browser RTC: stage=channel epoch=$epoch channel=$label state=open")
        val action = when (label) { "video" -> ::pumpVideo; "audio" -> ::pumpAudio; else -> return }
        try { media.execute { if (!closed.get()) action() } }
        catch (_: java.util.concurrent.RejectedExecutionException) { if (!closed.get()) fail("media-executor-rejected") }
    }

    private fun receiveControl(bytes: ByteArray) {
        if (closed.get()) return
        // Canonical application-visible DC control input, before parsing/rejection. Capture
        // stays on the bounded control executor, never on libwebrtc's native callback thread.
        RawTraffic.record("browser/rtc/$epoch/control/in", bytes)
        try {
            val fields = WebJson.parse(String(bytes, Charsets.UTF_8)) as? Map<*, *> ?: error("control-object")
            when (fields["k"]) {
                "ack" -> {
                    val credit = credits[fields["channel"]] ?: error("ack-channel")
                    val sequence = BrowserRtcProtocol.unsignedInt(fields["q"]) ?: error("ack-sequence")
                    val size = fields["bytes"].exactInt() ?: error("ack-size")
                    synchronized(wake) {
                        check(credit.acknowledge(sequence, size)) { "ack-order" }
                        wake.notifyAll()
                    }
                }
                "audio-ready" -> {
                    val enabled = fields["enabled"] as? Boolean ?: error("audio-ready")
                    val generation = BrowserRtcProtocol.unsignedInt(fields["generation"]) ?: error("audio-generation")
                    val changed = synchronized(wake) {
                        val changed = audioLease.request(enabled, generation)
                        if (changed) audioSubscription?.close()
                        wake.notifyAll()
                        changed
                    }
                    log("Browser RTC: stage=audio-lease epoch=$epoch generation=${generation.toLong() and 0xffff_ffffL} enabled=$enabled changed=$changed")
                }
                else -> {
                    val response = control(fields)
                    sendControl(response)
                }
            }
        } catch (error: Exception) {
            logFailure("control", error)
            fail("control-protocol")
        }
    }

    private fun pumpVideo() {
        var sequence = 0
        try {
            val subscription = video.subscribe(reliable = true).also { videoSubscription = it }
            while (!closed.get()) {
                val record = subscription.take(1_000) ?: WebVideoRecords.HEARTBEAT
                WebDebugTiming.record(record, System.nanoTime())?.let {
                    sendRecord("video", sequence++, BrowserRtcRecord.video(it))
                }
                sendRecord("video", sequence++, BrowserRtcRecord.video(record))
                if (record.kind == WebVideoRecords.KIND_END) { fail(String(record.payload, Charsets.UTF_8)); break }
            }
        } catch (error: Exception) { if (!closed.get()) failed("video", error) }
        finally { videoSubscription?.close(); videoSubscription = null }
    }

    private fun pumpAudio() {
        var sequence = 0
        var announced: BrowserRtcAudioLease.Lease? = null
        try {
            while (!closed.get()) {
                val lease = synchronized(wake) {
                    while (!closed.get() && audioLease.current() == null) wake.wait(250)
                    audioLease.current()
                }
                if (closed.get()) break
                if (lease == null) continue
                // This pump is the sole audio sender: the previous lease's admitted record and
                // subscription are finished before this cross-channel boundary is announced.
                if (announced != lease) {
                    sendControl(WebJson.write(mapOf("k" to "audio-barrier", "epoch" to epoch,
                        "generation" to (lease.generation.toLong() and 0xffff_ffffL),
                        "sequence" to (sequence.toLong() and 0xffff_ffffL))))
                    announced = lease
                    log("Browser RTC: stage=audio-barrier epoch=$epoch generation=${lease.generation.toLong() and 0xffff_ffffL} minSequence=${sequence.toLong() and 0xffff_ffffL} state=local-enqueue")
                }
                if (!audioLease.owns(lease)) continue
                val subscription = audio?.subscribe()?.also { audioSubscription = it } ?: break
                try {
                    while (!closed.get() && audioLease.owns(lease) && !subscription.closed) {
                        val bytes = subscription.take(1_000) ?: continue
                        if (!audioLease.owns(lease) || subscription.closed) break
                        val nextSequence = sequence
                        try {
                            audioCapture.send(nextSequence, bytes) {
                                sendRecord("audio", nextSequence, BrowserRtcRecord(listOf(bytes))) {
                                    audioLease.owns(lease)
                                }
                            }
                            sequence++
                        } catch (_: BrowserRtcAudioLeaseRetired) {
                            // No credit or fragment was admitted, so the wire sequence is unused.
                            // Finishing an admitted partial record never depends on another credit.
                            break
                        }
                    }
                } finally { subscription.close(); audioSubscription = null }
            }
        } catch (error: Exception) { if (!closed.get()) failed("audio", error) }
    }

    private fun sendControl(response: String) {
        val channel = channels["control"] ?: error("control-unavailable")
        synchronized(nativeLock) {
            if (!closed.get()) {
                check(channel.bufferedAmount() <= 64 * 1024) { "control-buffer-limit" }
                check(channel.send(DataChannel.Buffer(ByteBuffer.wrap(response.toByteArray(Charsets.UTF_8)), false))) { "control-send" }
            }
        }
    }

    private fun sendRecord(label: String, sequence: Int, bytes: BrowserRtcRecord, admit: () -> Boolean = { true }) {
        val maximum = if (label == "video") WebVideoRecords.MAX_PAYLOAD + WebVideoRecords.HEADER_SIZE else 1024 * 1024
        check(bytes.size in 1..maximum) { "record-size" }
        val credit = requireNotNull(credits[label])
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(6)
        synchronized(wake) {
            while (!closed.get() && !credit.canSend(bytes.size)) {
                if (!admit()) throw BrowserRtcAudioLeaseRetired()
                check(System.nanoTime() < deadline) { "consumer-credit-timeout" }
                wake.wait(100)
            }
            check(!closed.get()) { "peer-closed" }
            if (!admit()) throw BrowserRtcAudioLeaseRetired()
            credit.sent(sequence, bytes.size, System.nanoTime())
        }
        var offset = 0
        while (offset < bytes.size && !closed.get()) {
            val channel = requireNotNull(channels[label])
            while (!closed.get()) {
                val busy = synchronized(nativeLock) { !closed.get() &&
                    (channel.bufferedAmount() > 256 * 1024 || controlPending.get() > 0 ||
                        (channels["control"]?.bufferedAmount() ?: 0) > 0) }
                if (!busy) break
                check(System.nanoTime() < deadline) { "transport-buffer-timeout" }
                synchronized(wake) { if (!closed.get()) wake.wait(10) }
            }
            val fragment = BrowserRtcProtocol.fragment(epoch, sequence, bytes, offset)
            val count = fragment.remaining() - BrowserRtcProtocol.HEADER
            synchronized(nativeLock) {
                check(!closed.get() && channel.send(DataChannel.Buffer(fragment, true))) { "transport-send" }
            }
            offset += count
        }
        check(offset == bytes.size) { "peer-closed" }
        records.incrementAndGet()
    }

    override fun maintain() {
        if (closed.get()) return
        val now = System.nanoTime()
        val reason = synchronized(wake) {
            if (credits.values.any { it.oldestAgeMillis(now) > 6_000 }) "consumer-stalled"
            else if (now - created > TimeUnit.SECONDS.toNanos(15) &&
                (!everConnected || !channelStarted.containsAll(setOf("video", "audio", "control")))) "peer-open-timeout"
            else if (disconnectedSince?.let { now - it > TimeUnit.SECONDS.toNanos(6) } == true) "ice-disconnected-timeout"
            else null
        }
        reason?.let(::fail)
    }

    override fun snapshot(): Map<String, Any?> = synchronized(wake) {
        mapOf("transport" to BrowserRtcProtocol.NAME, "epoch" to epoch, "state" to state,
            "live" to live, "records" to records.get(), "videoInFlightBytes" to credits["video"]?.bytes,
            "audioInFlightBytes" to credits["audio"]?.bytes,
            "oldestAgeMs" to credits.values.maxOf { it.oldestAgeMillis(System.nanoTime()) })
    }

    private fun failed(stage: String, error: Exception) {
        fail(logFailure(stage, error))
    }

    private fun logFailure(stage: String, error: Exception): String {
        val reason = failureReason(error)
        log("Browser RTC: stage=$stage epoch=$epoch reason=$reason exception=${DiagnosticErrorText.types(error)}")
        if (reason == "operation-failed") {
            log("Browser RTC: stage=$stage-detail epoch=$epoch reason=$reason failed=true errorText=${DiagnosticErrorText.describe(error)}")
        }
        return reason
    }
    private fun fail(reason: String) {
        if (closed.get()) return
        val evidence = snapshot()
        log("Browser RTC: stage=retire epoch=$epoch reason=$reason videoInFlightBytes=${evidence["videoInFlightBytes"]} audioInFlightBytes=${evidence["audioInFlightBytes"]} oldestAgeMs=${evidence["oldestAgeMs"]} records=${records.get()}")
        retire(reason)
    }

    override fun close() = retire("lease-retired")

    override fun retire(reason: String) {
        if (!closed.compareAndSet(false, true)) return
        val retiredChannels = synchronized(admission) { channels.values.toList().also { channels.clear() } }
        state = "closed"
        val evidence = snapshot()
        log("Browser RTC: stage=close epoch=$epoch reason=$reason videoInFlightBytes=${evidence["videoInFlightBytes"]} audioInFlightBytes=${evidence["audioInFlightBytes"]} oldestAgeMs=${evidence["oldestAgeMs"]} records=${records.get()}")
        videoSubscription?.close()
        audioSubscription?.close()
        synchronized(wake) { wake.notifyAll() }
        media.shutdownNow(); controls.shutdownNow()
        gathering.countDown()
        // Never dispose inside a libwebrtc callback; native signaling-thread joins can deadlock.
        val cleanup = Runnable {
            synchronized(nativeLock) {
                retiredChannels.forEach(::disposeChannel)
                connection?.let { peer ->
                    cleanup("peer-close") { peer.close() }
                    cleanup("peer-dispose") { peer.dispose() }
                }
                connection = null
                factory?.let { owner -> cleanup("factory-dispose") { owner.dispose() } }
                factory = null
            }
        }
        try { lifecycle.execute(cleanup) }
        catch (_: java.util.concurrent.RejectedExecutionException) { cleanupExecutor.execute(cleanup) }
        lifecycle.shutdown()
    }

    private fun disposeOrphan(channel: DataChannel) {
        // A DCEP callback can arrive after this peer's executor is shut down.
        // Process-owned disposal keeps native joins off the signaling callback thread.
        cleanupExecutor.execute { synchronized(nativeLock) { disposeChannel(channel) } }
    }

    private fun disposeChannel(channel: DataChannel) {
        cleanup("channel-unregister") { channel.unregisterObserver() }
        cleanup("channel-close") { channel.close() }
        cleanup("channel-dispose") { channel.dispose() }
    }

    private fun cleanup(operation: String, action: () -> Unit) {
        runCatching(action).onFailure {
            log("Browser RTC: stage=cleanup epoch=$epoch operation=$operation failed=true exception=${DiagnosticErrorText.types(it)}")
        }
    }

    private fun awaitSdp(operation: String, action: (SdpObserver) -> Unit): SessionDescription? {
        val done = CountDownLatch(1)
        val result = AtomicReference<SessionDescription?>()
        val failure = AtomicReference<String?>()
        action(object : SdpObserver {
            override fun onCreateSuccess(value: SessionDescription) { result.set(value); done.countDown() }
            override fun onSetSuccess() { done.countDown() }
            override fun onCreateFailure(value: String) { failure.set(value); done.countDown() }
            override fun onSetFailure(value: String) { failure.set(value); done.countDown() }
        })
        if (!done.await(2, TimeUnit.SECONDS)) {
            log("Browser RTC: stage=sdp epoch=$epoch operation=$operation reason=timeout failed=true")
            error("sdp-$operation-timeout")
        }
        failure.get()?.let {
            log("Browser RTC: stage=sdp epoch=$epoch operation=$operation reason=failed exception=${DiagnosticErrorText.sanitize(it)}")
            error("sdp-$operation-failed")
        }
        return result.get()
    }

    private fun candidateDescription(candidate: IceCandidate): String {
        val fields = candidate.sdp.trim().split(Regex("\\s+"))
        val protocol = fields.getOrNull(2)?.lowercase()?.takeIf { it in setOf("udp", "tcp") } ?: "unknown"
        val kind = fields.indexOf("typ").takeIf { it >= 0 }?.let { fields.getOrNull(it + 1) }
            ?.takeIf { it in setOf("host", "srflx", "prflx", "relay") } ?: "unknown"
        val address = fields.getOrNull(4).orEmpty()
        val family = when { address.startsWith("169.254.") -> "ipv4-link-local"
            address.contains(':') -> "ipv6"; address.endsWith(".local") -> "mdns"
            address.count { it == '.' } == 3 -> "ipv4"; else -> "unknown" }
        val adapter = candidate.adapterType?.name?.lowercase() ?: "unknown"
        return "$protocol/$kind/$family/$adapter"
    }

    private fun Any?.exactInt(): Int? = (this as? Number)?.toDouble()?.takeIf {
        it.isFinite() && it >= Int.MIN_VALUE && it <= Int.MAX_VALUE && it == it.toInt().toDouble()
    }?.toInt()

    private fun failureReason(error: Exception): String = error.message?.takeIf { it in setOf(
        "consumer-credit-timeout", "transport-buffer-timeout", "transport-send", "control-buffer-limit",
        "control-send", "record-size", "ack-channel", "ack-sequence", "ack-size", "ack-order",
        "control-object", "audio-ready", "audio-generation", "control-unavailable", "peer-closed", "rtc-session", "rtc-owner-retired",
    ) } ?: "operation-failed"

    companion object {
        private val cleanupExecutor = Executors.newSingleThreadExecutor {
            Thread(it, "browser-rtc-cleanup").apply { isDaemon = true }
        }
        @Synchronized private fun initialize(context: Context) {
            if (initialized) return
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false).createInitializationOptions())
            initialized = true
        }
        private var initialized = false
    }
}
