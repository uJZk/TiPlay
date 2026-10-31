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
import org.webrtc.RtpParameters
import org.webrtc.RtpTransceiver
import org.webrtc.MediaStreamTrack
import org.webrtc.RtpSender
import org.webrtc.VideoEncoder
import org.webrtc.VideoEncoderFactory
import org.webrtc.VideoCodecInfo
import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.Closeable
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Injectable so source/JVM harnesses need not load Android native WebRTC. */
fun interface BrowserRtcFactory {
    fun create(session: String, control: (Map<*, *>) -> String): BrowserRtcSession
    val supportsVideoTrack: Boolean get() = false
    val supportsAudioTrack: Boolean get() = false
}

interface BrowserRtcSession : Closeable {
    val session: String
    val epoch: Int
    val live: Boolean
    val videoTransport: String get() = BrowserRtcVideoPolicy.UNAVAILABLE
    val audioTransport: String get() = "unavailable"
    fun answer(offer: String): String
    fun snapshot(): Map<String, Any?>
    fun maintain()
    fun retire(reason: String) { close() }
    fun authenticate()
}

/** Original video and supported audio use RTP; authenticated control and fallback audio retain DataChannels. */
class AndroidBrowserRtcFactory(
    context: Context,
    private val video: WebVideoHub,
    private val audio: WebAudioHub?,
    private val log: (String) -> Unit,
) : BrowserRtcFactory {
    private val context = context.applicationContext
    override val supportsVideoTrack = true
    override val supportsAudioTrack: Boolean get() = audio != null
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
    private val callbackEvents = BrowserRtcCallbackQueue(lifecycle, cleanupExecutor,
        failure = { reason, observedAt ->
            if (!closed.get()) {
                runCatching {
                    if (reason.startsWith("ice-"))
                        log("Browser RTC: stage=ice epoch=$epoch observedAtEpochMs=$observedAt state=${reason.removePrefix("ice-")}")
                    else log("Browser RTC: stage=native-event epoch=$epoch observedAtEpochMs=$observedAt reason=$reason failed=true")
                }
                fail(reason)
            }
        })
    private val media = Executors.newFixedThreadPool(2) { Thread(it, "browser-rtc-media").apply { isDaemon = true } }
    private val controls = BrowserRtcControlQueue(
        authenticated = { authenticated && accepting() },
        capture = { RawTraffic.record("browser/rtc/$epoch/control/in", it) },
        acknowledge = ::receiveAcknowledgement,
        application = ::receiveApplicationControl,
        respond = ::respondToControl,
        failure = ::controlFailure,
    )
    private val channels = ConcurrentHashMap<String, DataChannel>()
    private val channelStarted = ConcurrentHashMap.newKeySet<String>()
    private val credits = mapOf("video" to BrowserRtcCredit(BrowserRtcProtocol.VIDEO_WINDOW),
        "audio" to BrowserRtcCredit(BrowserRtcProtocol.AUDIO_WINDOW))
    private val wake = Object()
    private val nativeLock = ReentrantLock(true)
    private val admission = Any()
    private val gathering = CountDownLatch(1)
    private var factory: PeerConnectionFactory? = null
    private var connection: PeerConnection? = null
    @Volatile private var videoTrack: BrowserRtcVideoTrack? = null
    @Volatile private var videoSender: RtpSender? = null
    private val videoDiagnostics = BrowserRtcVideoDiagnostics.Sampler()
    private var videoCodecOffers = emptyList<BrowserRtcVideoPolicy.Codec>()
    private var previousVideoOffer: String? = null
    private val videoLease = BrowserRtcVideoLease()
    private val videoTransaction = BrowserRtcVideoTransaction()
    private val videoSource = BrowserRtcPendingVideoSource<WebVideoRecord>()
    @Volatile private var videoFailure: String? = null
    override val videoTransport: String get() = if (videoTrack != null) BrowserRtcVideoPolicy.TRACK else BrowserRtcVideoPolicy.UNAVAILABLE
    @Volatile private var videoSubscription: WebVideoSubscription? = null
    @Volatile private var audioSubscription: WebAudioHub.Subscription? = null
    private val audioLease = BrowserRtcAudioLease()
    @Volatile private var connected = false
    @Volatile private var authenticated = false
    @Volatile private var everConnected = false
    @Volatile private var disconnectedSince: Long? = null
    @Volatile private var state = "new"
    private val created = System.nanoTime()
    private var lastControlDiagnostics = created
    @Volatile private var closedChannel = "none"
    @Volatile private var closedChannelPreviousState = "none"
    @Volatile private var firstCandidateNanos: Long? = null
    private val records = java.util.concurrent.atomic.AtomicLong()
    private val audioCapture = BrowserRtcAudioCapture(epoch)
    private val nativeAudioCapture = BrowserRtcAudioCapture(epoch)
    private val nativeAudioSequence = java.util.concurrent.atomic.AtomicInteger()
    private val audioRouteLock = Any()
    @Volatile private var audioFailure: String? = null
    override val audioTransport: String get() = if (audio != null) BrowserRtcAudioRouter.TRANSPORT else "unavailable"
    private val audioRouter = BrowserRtcAudioRouter(onFailure = ::nativeAudioFailure,
        captureNative = { bytes, submit -> nativeAudioCapture.route(nativeAudioSequence.getAndIncrement(), bytes, submit) })
    private val audioSignaling = BrowserRtcAudioSignaling(audioRouter,
        authenticated = { authenticated && audio != null && accepting() }, live = ::accepting,
        respond = { response -> runCatching {
            if ((WebJson.parse(response) as? Map<*, *>)?.get("error") == null) audioFailure = null
            sendControl(response)
        }.onFailure {
            if (!closed.get()) log("Browser RTC: stage=audio-response epoch=$epoch reason=control-send-failed exception=${DiagnosticErrorText.types(it)}")
        } })
    private val candidateCounts = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicInteger>()

    private fun accepting(): Boolean = !closed.get() && callbackEvents.failureReason == null

    override val live: Boolean get() = accepting()

    override fun answer(offer: String): String {
        require(offer.length in 1..48 * 1024 && offer.lineSequence().any { it.startsWith("m=application ") }) { "invalid data offer" }
        require(offer.lineSequence().none { it.startsWith("m=audio ") ||
            (it.startsWith("a=candidate:") && (it.contains(" typ relay") || it.contains(" typ srflx"))) }) { "non-local or media-track offer" }
        val hasVideo = offer.lineSequence().any { it.startsWith("m=video ") }
        require(!hasVideo || BrowserRtcVideoPolicy.receiveOnlyOffer(offer)) { "video-offer-must-be-receive-only" }
        val offeredCodecs = if (hasVideo) BrowserRtcVideoPolicy.codecs(offer).let { codecs ->
            val current = video.info()?.codec
            codecs.sortedByDescending { current != null && BrowserRtcVideoPolicy.matches(current, it) }
        } else emptyList()
        require(offer.lineSequence().filter { it.startsWith("a=max-message-size:") }.all {
            val maximum = it.substringAfter(':').trim().toLongOrNull()
            maximum != null && (maximum == 0L || maximum >= BrowserRtcProtocol.MESSAGE_BYTES)
        }) { "unsupported-message-size" }
        val task = lifecycle.submit<String> {
            check(accepting())
            initialize(context)
            // Hotspot/AP and Shizuku /32 aliases need real interface-bound UDP sockets even when
            // ConnectivityManager does not expose a Network handle for that server interface.
            // M144 AndroidNetworkMonitor otherwise marks such interfaces unavailable. Native
            // getifaddrs enumeration retains IPv4 link-local addresses; never rewrite candidates.
            val videoTrack = offeredCodecs.takeIf { it.isNotEmpty() }?.let {
                BrowserRtcVideoTrack(it, requestKeyFrame = { video.requestKeyFrame() })
            }.also { this.videoTrack = it }
            videoCodecOffers = offeredCodecs
            previousVideoOffer = offer
            val builder = PeerConnectionFactory.builder().setOptions(PeerConnectionFactory.Options().apply {
                disableNetworkMonitor = true
            })
                // This factory owns the video and control peer. The source-rate trial is
                // factory-local; the independent audio peer does not inherit it.
                .setFieldTrials("WebRTC-FrameDropper/Disabled/" +
                    "TiPlay-SourceRateVideo/Enabled/")
            if (videoTrack != null) builder.setVideoEncoderFactory(object : VideoEncoderFactory {
                // libwebrtc caches this list once. Replacement bridges use the same negotiated
                // factory capabilities; only the current video's encoder delegate is replaced.
                override fun getSupportedCodecs(): Array<VideoCodecInfo> = videoCodecOffers.map {
                    VideoCodecInfo(it.name, it.parameters, emptyList())
                }.toTypedArray()
                override fun createEncoder(info: VideoCodecInfo): VideoEncoder? = this@AndroidBrowserRtcPeer.videoTrack?.createEncoder(info)
                // libwebrtc chooses the actual sender independently of answer ordering.
                // Capture this bridge for each stream's selector; retired streams must not
                // redirect callbacks into a later source's bridge.
                override fun getEncoderSelector(): VideoEncoderFactory.VideoEncoderSelector? =
                    this@AndroidBrowserRtcPeer.videoTrack?.getEncoderSelector()
            })
            factory = builder.createPeerConnectionFactory()
            val config = PeerConnection.RTCConfiguration(emptyList()).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE
                // Host candidates only. No Internet STUN, TURN or media relay.
                iceTransportsType = PeerConnection.IceTransportsType.ALL
                tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
                // The source is already encoded: pixel/fps adaptation cannot rewrite it.
                enableCpuOveruseDetection = false
                suspendBelowMinBitrate = false
            }
            connection = requireNotNull(factory?.createPeerConnection(config, observer)) { "peer allocation" }
            awaitSdp("remote-description") { connection!!.setRemoteDescription(it, SessionDescription(SessionDescription.Type.OFFER, offer)) }
            if (videoTrack != null) {
                attachVideoTrack(videoTrack)
            }
            val answer = awaitSdp("create-answer") { connection!!.createAnswer(it, MediaConstraints()) }
            awaitSdp("local-description") { connection!!.setLocalDescription(it, requireNotNull(answer)) }
            videoTrack?.negotiated(requireNotNull(answer).description)
            reportVideoNegotiation(requireNotNull(answer).description)
            val gatherDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (accepting() && gathering.count > 0) {
                val now = System.nanoTime()
                val first = firstCandidateNanos
                if (first != null && now - first >= 500_000_000L) break
                check(now < gatherDeadline) { "ice-gather-timeout" }
                gathering.await(50, TimeUnit.MILLISECONDS)
            }
            check(accepting()) { "peer retired" }
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
                // Signaling can be waiting for this latch on lifecycle. Never put it behind its waiter.
                gathering.countDown()
                val counts = candidateCounts.mapValues { it.value.get() }
                dispatchNative { observedAt ->
                    log("Browser RTC: stage=ice-gather epoch=$epoch observedAtEpochMs=$observedAt state=complete candidateCounts=$counts")
                }
            }
        }
        override fun onIceCandidate(candidate: IceCandidate) {
            if (!accepting()) return
            if (firstCandidateNanos == null) firstCandidateNanos = System.nanoTime()
            val description = candidateDescription(candidate)
            candidateCounts.computeIfAbsent(description) { java.util.concurrent.atomic.AtomicInteger() }.incrementAndGet()
        }
        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent) {
            val local = candidateDescription(event.local)
            val remote = candidateDescription(event.remote)
            val disconnected = event.estimatedDisconnectedTimeMs
            dispatchNative { observedAt -> log("Browser RTC: stage=ice-pair epoch=$epoch observedAtEpochMs=$observedAt local=$local remote=$remote disconnectedMs=$disconnected") }
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) { deferNativeFailure("unexpected-media-track") }
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onRenegotiationNeeded() {}
        override fun onIceConnectionChange(value: PeerConnection.IceConnectionState) {
            if (!accepting()) return
            val nextState = value.name.lowercase()
            state = nextState
            connected = value == PeerConnection.IceConnectionState.CONNECTED || value == PeerConnection.IceConnectionState.COMPLETED
            if (connected) { everConnected = true; disconnectedSince = null }
            else if (value == PeerConnection.IceConnectionState.DISCONNECTED && disconnectedSince == null) disconnectedSince = System.nanoTime()
            if (value == PeerConnection.IceConnectionState.FAILED || value == PeerConnection.IceConnectionState.CLOSED) {
                deferNativeFailure("ice-$nextState")
            } else dispatchNative { observedAt ->
                log("Browser RTC: stage=ice epoch=$epoch observedAtEpochMs=$observedAt state=$nextState")
            }
        }
        override fun onDataChannel(channel: DataChannel) {
            synchronized(admission) {
            if (!accepting()) { disposeOrphan(channel); return }
            val label = channel.label()
            if (label !in setOf("video", "audio", "control") || channels.putIfAbsent(label, channel) != null) {
                disposeOrphan(channel)
                deferNativeFailure("unexpected-channel"); return
            }
            channel.registerObserver(object : DataChannel.Observer {
                private var previousState = channel.state()
                override fun onBufferedAmountChange(previousAmount: Long) { synchronized(wake) { wake.notifyAll() } }
                override fun onStateChange() {
                    if (!accepting()) return
                    val current = channel.state()
                    val before = previousState
                    previousState = current
                    if (current == DataChannel.State.OPEN) dispatchNative { observedAt -> startChannel(label, observedAt) }
                    else if (current == DataChannel.State.CLOSED) {
                        closedChannel = label
                        closedChannelPreviousState = before.name.lowercase()
                        deferNativeFailure("channel-closed")
                    }
                    synchronized(wake) { wake.notifyAll() }
                }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    receiveNativeControl(label, buffer)
                }
            })
            // OPEN may precede registration for remotely-created channels.
            if (channel.state() == DataChannel.State.OPEN) dispatchNative { observedAt -> startChannel(label, observedAt) }
            }
        }
    }

    /** Canonical admission for DataChannel control messages. */
    private fun receiveNativeControl(label: String, buffer: DataChannel.Buffer) {
        if (!accepting()) return
        if (label != "control" || buffer.binary || buffer.data.remaining() > 64 * 1024) {
            deferNativeFailure("invalid-control"); return
        }
        val bytes = ByteArray(buffer.data.remaining()).also(buffer.data::get)
        // Native callback must never perform app callbacks, source writes or HTTP/disk I/O.
        if (accepting()) controls.offer(bytes)
    }

    private fun dispatchNative(action: (Long) -> Unit) {
        val observedAt = System.currentTimeMillis()
        callbackEvents.offer { if (accepting()) action(observedAt) }
    }

    private fun deferNativeFailure(reason: String) {
        // The signaling task can own lifecycle while waiting for this latch.
        gathering.countDown()
        callbackEvents.terminate(reason)
    }

    private fun startChannel(label: String, observedAt: Long) {
        if (!accepting() || !channelStarted.add(label)) return
        log("Browser RTC: stage=channel epoch=$epoch observedAtEpochMs=$observedAt channel=$label state=open")
        val action = when (label) { "video" -> ::pumpVideo; "audio" -> ::pumpAudio; else -> return }
        try { media.execute { if (accepting()) action() } }
        catch (_: java.util.concurrent.RejectedExecutionException) { if (!closed.get()) fail("media-executor-rejected") }
    }

    private fun receiveAcknowledgement(fields: Map<*, *>) {
        val credit = credits[fields["channel"]] ?: error("ack-channel")
        val sequence = BrowserRtcProtocol.unsignedInt(fields["q"]) ?: error("ack-sequence")
        val size = fields["bytes"].exactInt() ?: error("ack-size")
        synchronized(wake) {
            if (!accepting()) return
            check(authenticated) { "authentication-required" }
            check(credit.acknowledge(sequence, size)) { "ack-order" }
            wake.notifyAll()
        }
    }

    private fun receiveApplicationControl(fields: Map<*, *>): String? {
        if (!accepting()) return null
        if (fields["k"] == "video-ready") {
            check(authenticated) { "authentication-required" }
            fields["generation"].exactInt()?.let(videoLease::ready)
            synchronized(wake) { wake.notifyAll() }
            return null
        }
        if (fields["k"] == "video-offer") return replaceVideo(fields)
        if (fields["k"] == "audio-offer") { audioSignaling.offer(fields); return null }
        if (fields["k"] == "audio-track-ready") {
            check(authenticated) { "authentication-required" }
            audioRouter.readyTrack(fields)
            return null
        }
        if (fields["k"] == "audio-ready") {
            val enabled = fields["enabled"] as? Boolean ?: error("audio-ready")
            val generation = BrowserRtcProtocol.unsignedInt(fields["generation"]) ?: error("audio-generation")
            val changed = synchronized(wake) {
                if (!accepting()) return null
                check(authenticated) { "authentication-required" }
                // Retire the old native route before publishing/waking the new consumer.
                // Otherwise the pump could admit its replayed config and then lose it to reset.
                val changed = synchronized(audioRouteLock) {
                    audioLease.request(enabled, generation).also { changed ->
                        if (changed) { audioSubscription?.close(); audioRouter.reset(); audioFailure = null }
                    }
                }
                wake.notifyAll()
                changed
            }
            log("Browser RTC: stage=audio-lease epoch=$epoch generation=${generation.toLong() and 0xffff_ffffL} enabled=$enabled changed=$changed")
            return null
        }
        return control(fields)
    }

    private fun attachVideoTrack(bridge: BrowserRtcVideoTrack) {
        val peer = requireNotNull(connection)
        val owner = requireNotNull(factory)
        val sender = peer.addTrack(bridge.attach(owner), listOf("tiplay-video"))
        videoSender = sender
        val parameters = sender.parameters
        parameters.degradationPreference = RtpParameters.DegradationPreference.DISABLED
        // The source is already compressed. Do not apply sender or peer bitrate limits.
        check(parameters.encodings.size == 1) { "video-sender-encodings" }
        check(sender.setParameters(parameters)) { "video-sender-parameters" }
        peer.transceivers.firstOrNull { it.sender.id() == sender.id() }?.let { transceiver ->
            check(transceiver.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY)) { "video-sender-direction" }
            val sourceCodec = video.info()?.codec
            if (sourceCodec != null) {
                val capabilities = owner.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs
                val matching = capabilities.filter { BrowserRtcVideoPolicy.matches(sourceCodec,
                    BrowserRtcVideoPolicy.Codec(it.name.uppercase(), it.parameters)) }
                if (matching.isNotEmpty()) transceiver.setCodecPreferences(matching + capabilities.filter { it.name.equals("rtx", true) }).throwError()
            }
        }
    }

    /** A video-only control RPC. Its failures never retire audio or the authenticated SCTP peer. */
    private fun replaceVideo(fields: Map<*, *>): String {
        val q = fields["q"]
        val next = fields["generation"].exactInt()
        var replacing = false
        return try {
            check(authenticated && accepting()) { "authentication-required" }
            val offer = fields["sdp"] as? String ?: error("invalid-video-offer")
            val transaction = q.exactInt()?.takeIf { it > 0 } ?: error("video-transaction")
            check(next != null) { "video-generation" }
            videoTransaction.replay(transaction, next, offer)?.let { response ->
                check(videoFailure == null && videoLease.replayAnswered(next)) { "video-generation" }
                return response
            }
            BrowserRtcVideoPolicy.validateReplacement(requireNotNull(previousVideoOffer), offer)
            val codecs = BrowserRtcVideoPolicy.codecs(offer).filter { offered -> videoCodecOffers.any { it.name == offered.name } }
            check(codecs.isNotEmpty()) { "video-codec-not-negotiated" }
            check(videoSource.claim { snapshot -> videoLease.offer(next, snapshot.epoch) }) { "video-source-unavailable" }
            replacing = true
            val task = lifecycle.submit<String> {
                check(accepting()) { "peer-closed" }
                val peer = requireNotNull(connection)
                val old = videoTrack
                old?.disable("video-track-replaced")
                nativeLock.withLock { videoSender?.setTrack(null, false); videoSender = null }
                awaitSdp("video-remote-description") { peer.setRemoteDescription(it, SessionDescription(SessionDescription.Type.OFFER, offer)) }
                val bridge = BrowserRtcVideoTrack(codecs, requestKeyFrame = { video.requestKeyFrame() })
                nativeLock.withLock {
                    videoTrack = bridge
                    old?.close()
                    attachVideoTrack(bridge)
                }
                val answer = requireNotNull(awaitSdp("video-create-answer") { peer.createAnswer(it, MediaConstraints()) })
                awaitSdp("video-local-description") { peer.setLocalDescription(it, answer) }
                bridge.negotiated(answer.description)
                reportVideoNegotiation(answer.description)
                previousVideoOffer = offer
                videoLease.answered()
                WebJson.write(mapOf("q" to q, "k" to "video-answer", "sdp" to answer.description,
                    "generation" to next, "videoTransport" to BrowserRtcVideoPolicy.TRACK))
            }
            task.get(9, TimeUnit.SECONDS).also { videoTransaction.save(transaction, next, offer, it) }
        } catch (error: Exception) {
            val reason = error.message?.takeIf { it.startsWith("video-") || it == "invalid-video-offer" } ?: "video-renegotiation-failed"
            if (replacing) {
                videoFailure = reason
                videoTrack?.disable(reason)
            }
            log("Browser RTC: stage=video-replacement epoch=$epoch reason=$reason failed=true exception=${DiagnosticErrorText.types(error)}")
            WebJson.write(mapOf("q" to q, "k" to "video-answer", "generation" to next, "error" to reason))
        }
    }

    private fun respondToControl(fields: Map<*, *>, response: String) {
        // The queue also guards publication: a slow old owner's result cannot reach a new peer.
        if (!accepting()) return
        sendControl(response)
        if (fields["k"] == "auth") authenticate()
    }

    private fun controlFailure(reason: String, error: Exception?) {
        // An ingress-capacity failure can originate in a native callback. Keep diagnostics,
        // application log I/O and peer retirement on an owned Java lifecycle thread.
        val action = Runnable {
            if (accepting()) {
                if (reason == "control-protocol") error?.let { logFailure("control", it) }
                else log("Browser RTC: stage=control epoch=$epoch reason=$reason exception=${DiagnosticErrorText.types(error)}")
                fail(reason)
            }
        }
        try { lifecycle.execute(action) }
        catch (_: java.util.concurrent.RejectedExecutionException) { cleanupExecutor.execute(action) }
    }

    private fun pumpVideo() {
        var sequence = 0
        var deferredSourceRateRecord: WebVideoRecord? = null
        var config: WebVideoRecord? = null
        var configuredGeneration = videoLease.generation
        var replacementAnnounced = false
        var lastCodecDiagnostic: Map<String, Any?>? = null
        var lastCodecCheckNanos = Long.MIN_VALUE
        var lastFlowBridge: BrowserRtcVideoTrack? = null
        var lastFlowGeneration = videoLease.generation
        var lastFlowCheckNanos = Long.MIN_VALUE
        val sourceRateGuard = BrowserRtcSourceRateGuard()
        val sourceRateRecovery = BrowserRtcSourceRateRecovery()
        var lastNativeStatusGeneration = 0
        var lastNativeStatusNanos = Long.MIN_VALUE
        fun reportFlow(terminal: Boolean = false) {
            val bridge = videoTrack ?: (if (terminal) lastFlowBridge else null) ?: return
            val now = System.nanoTime()
            fun emit(owner: BrowserRtcVideoTrack, generation: Int, reason: String) {
                // Keep even large lifetime counters below Standard's 700-character line cap.
                owner.flowDiagnostics().entries.chunked(9).forEachIndexed { part, fields ->
                    runCatching { log("Browser RTC: stage=video-flow epoch=$epoch generation=$generation mode=source-rate reason=$reason part=${part + 1} " +
                        fields.joinToString(" ") { "${it.key}=${it.value}" }) }
                }
            }
            if (lastFlowBridge !== bridge) {
                lastFlowBridge?.let { emit(it, lastFlowGeneration, "replaced") }
                lastFlowBridge = bridge; lastFlowGeneration = videoLease.generation
                lastFlowCheckNanos = Long.MIN_VALUE
            }
            if (terminal || lastFlowCheckNanos == Long.MIN_VALUE || now - lastFlowCheckNanos >= TimeUnit.SECONDS.toNanos(5)) {
                lastFlowCheckNanos = now
                emit(bridge, lastFlowGeneration, if (terminal) "writer-ended" else "periodic")
            }
        }
        fun reportCodec(force: Boolean = false) {
            val now = System.nanoTime()
            if (!force && lastCodecCheckNanos != Long.MIN_VALUE && now - lastCodecCheckNanos < TimeUnit.SECONDS.toNanos(1)) return
            lastCodecCheckNanos = now
            val values = runCatching { videoTrack?.diagnostics()?.filterKeys { it in setOf(
                "source", "negotiated", "requested", "announced", "current", "preferred", "selection", "failure") } }.getOrNull() ?: return
            if (values == lastCodecDiagnostic) return
            lastCodecDiagnostic = values
            runCatching { log("Browser RTC: stage=video-codec epoch=$epoch generation=${videoLease.generation} " + WebJson.write(values)) }
        }
        fun publishVideoError(reason: String, generation: Int) {
            runCatching { sendControl(WebJson.write(mapOf("k" to "video-error", "reason" to reason,
                "generation" to generation))) }
            log("Browser RTC: stage=video epoch=$epoch generation=$generation transport=${BrowserRtcVideoPolicy.TRACK} reason=$reason state=ended")
        }
        fun endVideo(reason: String) {
            videoFailure = reason
            videoTrack?.disable(reason)
            reportCodec(force = true)
            publishVideoError(reason, videoLease.generation)
            sendRecord("video", sequence++, BrowserRtcRecord.video(WebVideoRecords.end(reason)))
        }
        fun pauseVideo(next: WebVideoRecord?) {
            val announce = videoSource.pause(next) {
                // Source updates and offer snapshot selection share this lock.
                // Only retire the active old bridge, not a replacement bridge.
                if (videoLease.ready) videoTrack?.disable("video-track-replacement")
                videoLease.pause()
                if (next != null && videoLease.awaitingOffer && !replacementAnnounced) {
                    replacementAnnounced = true
                    true
                } else false
            }
            if (announce) sendRecord("video", sequence++, BrowserRtcRecord.video(WebVideoRecords.end("video-renegotiation-required")))
        }
        fun configureVideo(record: WebVideoRecord): Boolean {
            config = record; videoSource.update(record)
            if (videoTrack?.configure(record) != true) {
                val sourceCodec = (WebJson.parse(String(record.payload, Charsets.UTF_8)) as? Map<*, *>)?.get("codec") as? String
                // The first source can appear after initial signaling. Replace just video once
                // its real codec is known instead of transcoding or using a DataChannel fallback.
                val changedDuringOffer = videoLease.sourceChangedSinceOffer(record.epoch) &&
                    videoTrack?.failure == "codec-profile-not-negotiated"
                if ((videoLease.generation == 1 || changedDuringOffer) && sourceCodec != null && videoCodecOffers.any { BrowserRtcVideoPolicy.matches(sourceCodec, it) }) {
                    pauseVideo(record); return true
                }
                endVideo(videoTrack?.failure ?: "video-codec-not-negotiated"); return false
            }
            sendRecord("video", sequence++, BrowserRtcRecord.video(BrowserRtcVideoPolicy.metadata(record,
                BrowserRtcVideoPolicy.TRACK, generation = videoLease.generation)))
            return true
        }
        try {
            awaitAuthentication()
            if (videoTrack == null) { endVideo("video-track-not-negotiated"); return }
            var subscription = video.subscribe(reliable = true).also { videoSubscription = it }
            while (!closed.get()) {
                val record = deferredSourceRateRecord
                    ?: subscription.take(1_000)
                    ?: WebVideoRecords.HEARTBEAT
                deferredSourceRateRecord = null
                reportCodec()
                reportFlow()
                videoFailure?.let { endVideo(it); return }
                videoLease.readyTimeoutGeneration()?.let { publishVideoError("video-ready-timeout", it) }
                val statusNow = System.nanoTime()
                val sourceTransition = BrowserRtcSourceRateRecovery.sourceTransition(
                    record.kind == WebVideoRecords.KIND_CONFIG, record.kind == WebVideoRecords.KIND_IDLE,
                    record.kind == WebVideoRecords.KIND_END, config?.epoch, record.epoch,
                    if (record.kind == WebVideoRecords.KIND_END) String(record.payload, Charsets.UTF_8) else null)
                if (!sourceTransition && videoLease.ready && (videoLease.generation != lastNativeStatusGeneration ||
                        lastNativeStatusNanos == Long.MIN_VALUE ||
                        statusNow - lastNativeStatusNanos >= TimeUnit.MILLISECONDS.toNanos(200))) {
                    val checkedGeneration = videoLease.generation
                    var checkedOwner: BrowserRtcVideoTrack? = null
                    var checkedSender: RtpSender? = null
                    var nativeStatus: Pair<Long, Long>? = null
                    nativeLock.withLock {
                        if (!closed.get()) {
                            checkedOwner = videoTrack
                            checkedSender = videoSender
                            nativeStatus = runCatching {
                                checkedSender?.let {
                                    it.getTiPlaySourceRateStatus().takeIf { status -> status.size == 2 }?.let { status -> status[0] to status[1] }
                                }
                            }.getOrNull()
                        }
                    }
                    val owner = checkedOwner
                    val sender = checkedSender
                    val values = nativeStatus
                    val reason = when {
                        closed.get() -> null
                        owner == null || sender == null -> "video-source-rate-epoch-unavailable"
                        values == null -> "video-source-rate-status-unavailable"
                        else -> sourceRateGuard.inspect(checkedGeneration, sender, owner,
                            values.first, values.second, statusNow)
                    }
                    var scopedFailure: String? = null
                    var scopedRecovery: WebVideoRecord? = null
                    // Do not hold the generation barrier while querying JNI.
                    // Accept even a healthy result only for its original owner.
                    videoLease.runIfReady(checkedGeneration) {
                        nativeLock.withLock {
                            if (!closed.get() && videoTrack === owner && videoSender === sender) {
                                if (reason != "video-source-rate-epoch-pending") {
                                    lastNativeStatusGeneration = checkedGeneration
                                    lastNativeStatusNanos = statusNow
                                }
                                if (reason != null && reason != "video-source-rate-epoch-pending") {
                                    owner?.disable(reason)
                                    val currentConfig = config?.takeIf { configuredGeneration == checkedGeneration }
                                    if (sourceRateRecovery.shouldRetry(reason, currentConfig != null)) {
                                        scopedRecovery = currentConfig
                                    } else {
                                        videoFailure = reason
                                        scopedFailure = reason
                                    }
                                }
                            }
                        }
                    }
                    if (scopedRecovery != null) {
                        log("Browser RTC: stage=video epoch=$epoch generation=$checkedGeneration reason=$reason state=recovering attempt=1")
                        // Preserve CONFIG/END if the source changed during this sample.
                        deferredSourceRateRecord = record
                        pauseVideo(scopedRecovery)
                        continue
                    }
                    if (scopedFailure != null) {
                        reportCodec(force = true)
                        publishVideoError(scopedFailure!!, checkedGeneration)
                        break
                    }
                }
                if (!sourceTransition && videoLease.ready && lastNativeStatusGeneration != videoLease.generation) {
                    // A replacement raced the JNI sample. Preserve this record until
                    // the active sender has passed its own native-epoch check.
                    deferredSourceRateRecord = record
                    Thread.sleep(20)
                    continue
                }
                if (videoLease.ready && configuredGeneration != videoLease.generation) {
                    configuredGeneration = videoLease.generation; replacementAnnounced = false; config = null
                    val pending = videoSource.current()
                    if (pending != null && !configureVideo(pending)) break
                    video.requestKeyFrame(force = true)
                }
                if (videoLease.ready) {
                    val failure = videoTrack?.pollFailure()
                    if (failure != null) { endVideo(failure); break }
                }
                if (record.kind == WebVideoRecords.KIND_CONFIG) {
                    if (!videoLease.ready || config != null && config!!.epoch != record.epoch) pauseVideo(record)
                    else if (!configureVideo(record)) break
                    continue
                }
                if (record.kind == WebVideoRecords.KIND_IDLE && config != null) {
                    // Wait for the next actual source config before asking for a new video track.
                    // The old track is never reused across epochs; audio/SCTP remain untouched.
                    pauseVideo(null)
                }
                if (record.kind == WebVideoRecords.KIND_END) {
                    val reason = String(record.payload, Charsets.UTF_8)
                    if (reason in setOf("source-ended", "source-changed")) {
                        pauseVideo(null)
                        sendRecord("video", sequence++, BrowserRtcRecord.video(WebVideoRecords.IDLE))
                        subscription.close()
                        subscription = video.subscribe(reliable = true).also { videoSubscription = it }
                        continue
                    } else { endVideo(reason); break }
                }
                record.sourceCapture?.let { source ->
                    RawTraffic.recordForSession(source.session, "browser/rtc/video-reference",
                        WebJson.write(source.fields() + mapOf("epoch" to record.epoch,
                            "sequence" to record.sequence, "recordKind" to record.kind)).toByteArray(Charsets.UTF_8))
                }
                WebDebugTiming.record(record, System.nanoTime(), extended = true)?.let {
                    sendRecord("video", sequence++, BrowserRtcRecord.video(it))
                }
                if (record.kind == WebVideoRecords.KIND_FRAME) {
                    // Drain while replacing the track, preserving finite source-side memory.
                    // Resume only after video-ready, then ask the source for a fresh key frame.
                    if (!videoLease.ready) continue
                    val owner = videoTrack ?: continue
                    val ownerGeneration = videoLease.generation
                    // Native cadence uses latest-frame coalescing at queue depth two.
                    // Wait outside nativeLock so callbacks, replacement and disposal can
                    // finish; the existing reliable source queue provides bounded storage.
                    val inputReady = owner.awaitInput(VIDEO_INPUT_TIMEOUT_MS)
                    var inputFailure: String? = null
                    nativeLock.withLock {
                        if (!closed.get() && videoTrack === owner && videoLease.ready && videoLease.generation == ownerGeneration) {
                            val accepted = inputReady && owner.offer(record)
                            if (!accepted) {
                                // Mark only the checked owner. Control publication below
                                // carries its generation and must not hold the send lock.
                                val reason = owner.failure ?: if (inputReady) "video-track-unavailable" else "video-encoder-input-timeout"
                                owner.disable(reason)
                                videoFailure = reason
                                inputFailure = reason
                            }
                        }
                    }
                    if (inputFailure != null) {
                        reportCodec(force = true)
                        // The scoped control error stops the matching reader. An unscoped
                        // END could retire a replacement; blocked video credit must also
                        // leave audio/control free to use the send lock.
                        publishVideoError(inputFailure!!, ownerGeneration)
                        break
                    }
                } else sendRecord("video", sequence++, BrowserRtcRecord.video(record))
            }
        } catch (error: Exception) {
            if (!closed.get()) {
                val reason = logFailure("video", error)
                videoFailure = reason; videoTrack?.disable(reason)
                // A blocked video credit must not retire independently playing audio. Control is
                // a separate bounded channel and can report a video-only error even then.
                runCatching { sendControl(WebJson.write(mapOf("k" to "video-error", "reason" to reason,
                    "generation" to videoLease.generation))) }
            }
        }
        finally { reportFlow(terminal = true); videoSubscription?.close(); videoSubscription = null }
    }

    private fun nativeAudioFailure(reason: String) {
        if (closed.get() || !authenticated) return
        audioFailure = reason
        val generation = (audioRouter.snapshot()["generation"] as? Number)?.toInt()?.coerceAtLeast(1) ?: 1
        val event = if (reason == "audio-slots-exhausted") "audio-restart-required" else "audio-error"
        log("Browser RTC: stage=native-audio epoch=$epoch generation=$generation reason=$reason failed=true")
        runCatching { sendControl(WebJson.write(mapOf("k" to event, "reason" to reason, "generation" to generation))) }
        synchronized(wake) { wake.notifyAll() }
    }

    private fun pumpAudio() {
        var sequence = 0
        var announced: BrowserRtcAudioLease.Lease? = null
        fun send(lease: BrowserRtcAudioLease.Lease, bytes: ByteArray, nativeMetadata: Boolean) {
            val nextSequence = sequence
            if (nativeMetadata) {
                sendRecord("audio", nextSequence, BrowserRtcRecord(listOf(bytes))) { audioLease.owns(lease) }
                nativeAudioCapture.nativeMetadata(nextSequence, bytes)
            } else audioCapture.send(nextSequence, bytes) {
                sendRecord("audio", nextSequence, BrowserRtcRecord(listOf(bytes))) { audioLease.owns(lease) }
            }
            sequence++
        }
        fun flushMetadata(lease: BrowserRtcAudioLease.Lease) {
            val pending = synchronized(audioRouteLock) {
                if (audioLease.owns(lease)) audioRouter.drainMetadata() else emptyList()
            }
            for (record in pending) send(lease, record, nativeMetadata = true)
        }
        try {
            awaitAuthentication()
            while (!closed.get()) {
                val lease = synchronized(wake) {
                    while (!closed.get() && audioLease.current() == null) wake.wait(250)
                    audioLease.current()
                }
                if (closed.get()) break
                if (lease == null) continue
                if (announced != lease) {
                    sendControl(WebJson.write(mapOf("k" to "audio-barrier", "epoch" to epoch,
                        "generation" to (lease.generation.toLong() and 0xffff_ffffL),
                        "sequence" to (sequence.toLong() and 0xffff_ffffL))))
                    announced = lease
                    log("Browser RTC: stage=audio-barrier epoch=$epoch generation=${lease.generation.toLong() and 0xffff_ffffL} minSequence=${sequence.toLong() and 0xffff_ffffL} state=local-enqueue")
                }
                if (!audioLease.owns(lease)) continue
                val subscription = audio?.subscribe(reliable = true)?.also { audioSubscription = it } ?: break
                try {
                    while (!closed.get() && audioLease.owns(lease) && !subscription.closed) {
                        try {
                            flushMetadata(lease)
                            // Native SDP completion can produce metadata without another source
                            // packet. Polling is bounded and never delays fallback decoding on SDP.
                            val bytes = subscription.take(100)
                            flushMetadata(lease)
                            if (bytes == null) continue
                            val routed = synchronized(audioRouteLock) {
                                if (!audioLease.owns(lease) || subscription.closed) throw BrowserRtcAudioLeaseRetired()
                                audioRouter.route(bytes)
                            }
                            if (routed != null) send(lease, routed, nativeMetadata = routed !== bytes)
                            flushMetadata(lease)
                        } catch (_: BrowserRtcAudioLeaseRetired) { break }
                    }
                    if (!closed.get()) audioLease.terminalReason(lease, subscription)?.let { reason ->
                        log("Browser RTC: stage=audio-subscription epoch=$epoch reason=$reason " +
                            "generation=${lease.generation.toLong() and 0xffff_ffffL} " +
                            "overAgePackets=${subscription.ageExceededPackets} maxQueueAgeMs=${subscription.maxQueueAgeMillis}")
                        fail(reason)
                    }
                } finally { subscription.close(); audioSubscription = null }
            }
        } catch (error: Exception) { if (!closed.get()) failed("audio", error) }
    }

    override fun authenticate() {
        synchronized(wake) {
            check(accepting()) { "peer-closed" }
            authenticated = true; wake.notifyAll()
        }
    }

    private fun awaitAuthentication() {
        synchronized(wake) {
            while (accepting() && !authenticated) wake.wait(100)
            check(accepting()) { "peer-closed" }
        }
    }

    private fun sendControl(response: String) {
        val channel = channels["control"] ?: error("control-unavailable")
        nativeLock.withLock {
            if (accepting()) {
                check(channel.bufferedAmount() <= 64 * 1024) { "control-buffer-limit" }
                check(channel.send(DataChannel.Buffer(ByteBuffer.wrap(response.toByteArray(Charsets.UTF_8)), false))) { "control-send" }
            }
        }
    }

    private fun sendRecord(label: String, sequence: Int, bytes: BrowserRtcRecord, admit: () -> Boolean = { true }) {
        val maximum = if (label == "video") WebVideoRecords.MAX_PAYLOAD + WebVideoRecords.HEADER_SIZE else 1024 * 1024
        check(bytes.size in 1..maximum) { "record-size" }
        val credit = requireNotNull(credits[label])
        var deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(6)
        synchronized(wake) {
            while (!closed.get() && !credit.canSend(bytes.size)) {
                if (!admit()) throw BrowserRtcAudioLeaseRetired()
                check(credit.noProgressMillis(System.nanoTime()) < 6_000) { "consumer-credit-timeout" }
                wake.wait(100)
            }
            check(!closed.get()) { "peer-closed" }
            if (!admit()) throw BrowserRtcAudioLeaseRetired()
            credit.sent(sequence, bytes.size, System.nanoTime())
        }
        var offset = 0
        var previousBuffered = Long.MAX_VALUE
        while (offset < bytes.size && !closed.get()) {
            val channel = requireNotNull(channels[label])
            while (!closed.get()) {
                val buffered = nativeLock.withLock { if (closed.get()) 0 else channel.bufferedAmount() }
                if (buffered < previousBuffered) deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(6)
                previousBuffered = buffered
                // A fair send lock gives a waiting control response its next send opportunity.
                // Pending diagnostics and tiny control buffers must not stop both media pumps.
                if (buffered <= 256 * 1024) break
                check(System.nanoTime() < deadline) { "transport-buffer-timeout" }
                synchronized(wake) { if (!closed.get()) wake.wait(10) }
            }
            val fragment = BrowserRtcProtocol.fragment(epoch, sequence, bytes, offset)
            val count = fragment.remaining() - BrowserRtcProtocol.HEADER
            nativeLock.withLock {
                check(!closed.get() && channel.send(DataChannel.Buffer(fragment, true))) { "transport-send" }
            }
            offset += count
            deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(6)
        }
        check(offset == bytes.size) { "peer-closed" }
        records.incrementAndGet()
    }

    override fun maintain() {
        if (closed.get()) return
        callbackEvents.failureReason?.let { fail(it); return }
        val now = System.nanoTime()
        val reason = synchronized(wake) {
            if (credits.any { (label, credit) -> (label != "video" || videoFailure == null) && credit.noProgressMillis(now) > 6_000 }) "consumer-stalled"
            else if (now - created > TimeUnit.SECONDS.toNanos(15) &&
                (!authenticated || !everConnected || !channelStarted.containsAll(setOf("video", "audio", "control")))) "peer-open-timeout"
            else if (disconnectedSince?.let { now - it > TimeUnit.SECONDS.toNanos(6) } == true) "ice-disconnected-timeout"
            else null
        }
        reason?.let(::fail)
        if (!closed.get() && authenticated && connected && RawTraffic.enabled) sampleVideoSender(now)
        if (!closed.get() && RawTraffic.enabled && now - lastControlDiagnostics >= TimeUnit.SECONDS.toNanos(10)) {
            lastControlDiagnostics = now
            controls.diagnosticLines(epoch, "periodic").forEach(log)
        }
    }

    /** Runs on the signaling executor after the actual answer and sender parameters are applied. */
    private fun reportVideoNegotiation(answer: String) {
        if (closed.get()) return
        runCatching {
            val sender = videoSender ?: return
            val mid = connection?.transceivers?.firstOrNull { it.sender.id() == sender.id() }?.mid
            val values = BrowserRtcVideoDiagnostics.negotiation(answer, mid, sender.parameters.headerExtensions.map { it.uri })
            log("Browser RTC: stage=video-feedback epoch=$epoch generation=${videoLease.generation} " +
                values.entries.joinToString(" ") { "${it.key}=${it.value}" })
        }
    }

    private fun sampleVideoSender(now: Long) {
        val sender = videoSender ?: return
        val bridge = videoTrack ?: return
        val generation = videoLease.generation
        if (!videoLease.ready) return
        val request = videoDiagnostics.begin(sender, generation, now) ?: return
        fun current() = !closed.get() && videoTrack === bridge && videoSender === sender &&
            videoLease.generation == generation && videoLease.ready &&
            videoDiagnostics.current(request, sender, generation, System.nanoTime())
        try {
            lifecycle.execute {
                try {
                    nativeLock.withLock {
                        if (!current()) return@withLock
                        // The native callback only enqueues the result. Parsing and log I/O stay
                        // on our existing executor; one expiring request bounds callback work.
                        connection?.getStats(sender) { report ->
                            if (!current()) return@getStats
                            try {
                                lifecycle.execute publish@ {
                                    val sampledAt = System.nanoTime()
                                    if (!current() || !videoDiagnostics.complete(request, videoSender, videoLease.generation, sampledAt)) return@publish
                                    val values = mapOf("sampleAgeMs" to TimeUnit.NANOSECONDS.toMillis(sampledAt - request.startedNanos)) +
                                        BrowserRtcVideoDiagnostics.sender(report)
                                    values.entries.chunked(7).forEachIndexed { part, fields ->
                                        log("Browser RTC: stage=video-send epoch=$epoch generation=$generation part=${part + 1} " +
                                            fields.joinToString(" ") { "${it.key}=${it.value}" })
                                    }
                                }
                            } catch (_: java.util.concurrent.RejectedExecutionException) { /* Peer retired. */ }
                        }
                    }
                } catch (_: Exception) {
                    if (current() && videoDiagnostics.complete(request, videoSender, videoLease.generation, System.nanoTime()))
                        log("Browser RTC: stage=video-send epoch=$epoch generation=$generation state=unavailable")
                }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) { /* Peer retired. */ }
    }

    override fun snapshot(): Map<String, Any?> {
        // Encoder callbacks have their own monitor; do not acquire it while
        // holding the transport wake lock.
        val videoCodec = videoTrack?.diagnostics()
        val videoFlow = videoTrack?.flowDiagnostics()?.plus("rateControlMode" to "source-rate")
        return synchronized(wake) {
        mapOf("transport" to BrowserRtcProtocol.NAME, "videoTransport" to videoTransport,
            "audioTransport" to audioTransport, "audioError" to audioFailure, "nativeAudio" to audioRouter.snapshot(),
            "videoError" to (videoFailure ?: videoTrack?.failure), "videoCodec" to videoCodec, "videoFlow" to videoFlow, "epoch" to epoch, "state" to state,
            "live" to live, "authenticated" to authenticated, "records" to records.get(), "videoInFlightBytes" to credits["video"]?.bytes,
            "audioInFlightBytes" to credits["audio"]?.bytes,
            "oldestAgeMs" to credits.values.maxOf { it.oldestAgeMillis(System.nanoTime()) },
            "noProgressMs" to credits.values.maxOf { it.noProgressMillis(System.nanoTime()) },
            "networkMode" to "kernel-interfaces", "ready" to (authenticated && connected), "closed" to closed.get(),
            "video" to creditSnapshot("video"), "audio" to creditSnapshot("audio"), "control" to controls.summary())
        }
    }

    private fun creditSnapshot(label: String): Map<String, Any?> {
        val credit = requireNotNull(credits[label])
        return mapOf("receiverWindowBytes" to if (label == "video") BrowserRtcProtocol.VIDEO_WINDOW else BrowserRtcProtocol.AUDIO_WINDOW,
            "receiverReservedBytes" to credit.reservedBytes, "receiverConsumedBytes" to credit.consumedBytes,
            "receiverInFlightBytes" to credit.bytes, "oldestUnackedAgeMs" to credit.oldestAgeMillis(System.nanoTime()),
            "noProgressMs" to credit.noProgressMillis(System.nanoTime()))
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
        val evidence = runCatching { snapshot() }.getOrDefault(emptyMap())
        runCatching { log("Browser RTC: stage=retire epoch=$epoch reason=$reason closedChannel=$closedChannel closedChannelPreviousState=$closedChannelPreviousState videoInFlightBytes=${evidence["videoInFlightBytes"]} audioInFlightBytes=${evidence["audioInFlightBytes"]} oldestAgeMs=${evidence["oldestAgeMs"]} records=${records.get()}") }
        retire(reason)
    }

    override fun close() = retire("lease-retired")

    override fun retire(reason: String) {
        if (!closed.compareAndSet(false, true)) return
        callbackEvents.close()
        videoDiagnostics.close()
        synchronized(wake) { authenticated = false; wake.notifyAll() }
        val retiredChannels = synchronized(admission) { channels.values.toList().also { channels.clear() } }
        state = "closed"
        val evidence = runCatching { snapshot() }.getOrDefault(emptyMap())
        runCatching { log("Browser RTC: stage=close epoch=$epoch reason=$reason closedChannel=$closedChannel closedChannelPreviousState=$closedChannelPreviousState videoInFlightBytes=${evidence["videoInFlightBytes"]} audioInFlightBytes=${evidence["audioInFlightBytes"]} oldestAgeMs=${evidence["oldestAgeMs"]} records=${records.get()}") }
        for (label in listOf("video", "audio")) {
            val credit = synchronized(wake) { creditSnapshot(label) }
            runCatching { log("Browser RTC: stage=close-credit epoch=$epoch channel=$label reason=$reason " +
                credit.entries.joinToString(" ") { "${it.key}=${it.value}" }) }
        }
        cleanup("control-close") { controls.close() }
        cleanup("audio-signaling-close") { synchronized(audioRouteLock) { audioSignaling.close() } }
        runCatching { controls.diagnosticLines(epoch, reason).forEach { runCatching { log(it) } } }
        cleanup("video-subscription-close") { videoSubscription?.close() }
        cleanup("audio-subscription-close") { audioSubscription?.close() }
        synchronized(wake) { wake.notifyAll() }
        media.shutdownNow()
        gathering.countDown()
        // Never dispose inside a libwebrtc callback; native signaling-thread joins can deadlock.
        val cleanup = Runnable {
            nativeLock.withLock {
                retiredChannels.forEach(::disposeChannel)
                connection?.let { peer ->
                    cleanup("peer-close") { peer.close() }
                    cleanup("peer-dispose") { peer.dispose() }
                }
                connection = null
                videoTrack?.let { owner -> cleanup("video-track-dispose") { owner.close() } }
                videoTrack = null
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
        cleanupExecutor.execute { nativeLock.withLock { disposeChannel(channel) } }
    }

    private fun disposeChannel(channel: DataChannel) {
        cleanup("channel-unregister") { channel.unregisterObserver() }
        cleanup("channel-close") { channel.close() }
        cleanup("channel-dispose") { channel.dispose() }
    }

    private fun cleanup(operation: String, action: () -> Unit) {
        runCatching(action).onFailure {
            runCatching { log("Browser RTC: stage=cleanup epoch=$epoch operation=$operation failed=true exception=${DiagnosticErrorText.types(it)}") }
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
        private const val VIDEO_INPUT_TIMEOUT_MS = 6_000L
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
