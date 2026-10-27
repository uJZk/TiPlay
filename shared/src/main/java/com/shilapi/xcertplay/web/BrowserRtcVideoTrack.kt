package com.shilapi.xcertplay.web

import org.webrtc.EncodedImage
import org.webrtc.PeerConnectionFactory
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoEncoder
import org.webrtc.VideoEncoderFactory
import org.webrtc.VideoFrame
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.io.Closeable
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Original access units carried through libwebrtc's public Java encoder seam. The native buffer
 * contains NO pixels: no MediaCodec, software video codec, I420 allocation or transcoding occurs.
 * Unsupported adaptation and encoder-input loss retire the dependency chain until a source IDR.
 */
internal class BrowserRtcVideoTrack(
    private val offered: List<BrowserRtcVideoPolicy.Codec>,
    private val requestKeyFrame: () -> Unit,
    private val captureFrame: ((VideoFrame) -> Unit)? = null,
    private val nowNanos: () -> Long = System::nanoTime,
) : VideoEncoderFactory, Closeable {
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    private var negotiatedCodec: BrowserRtcVideoPolicy.Codec? = null
    @Volatile private var sourceCodec: String? = null
    @Volatile private var activeEncoder: PassthroughEncoder? = null
    private var requestedCodec: BrowserRtcVideoPolicy.Codec? = null
    private var announcedCodec: BrowserRtcVideoPolicy.Codec? = null
    private var currentCodec: BrowserRtcVideoPolicy.Codec? = null
    private var encoderSerial = 0L
    private var initializedSerial = 0L
    private var selectorSerial = 0L
    private var selectionStartedNanos: Long? = null
    @Volatile private var active = false
    @Volatile private var closed = false
    @Volatile private var waitingForKey = true
    @Volatile var failure: String? = null; private set
    private var configuredEpoch: Int? = null
    private var configuration: Map<*, *>? = null
    private var lastTimestampUs: Long? = null
    private val pending = AtomicInteger()
    private val pendingBytes = AtomicLong()
    private val generation = AtomicInteger()
    private val lossGeneration = AtomicInteger()
    private var clock = BrowserRtcVideoPolicy.SourceClock()
    private var firstSubmittedNanos: Long? = null
    private val everEncoded = AtomicBoolean()
    private val receivedFrames = AtomicLong()
    private val submittedFrames = AtomicLong()
    private val outputFrames = AtomicLong()
    private val outputBytes = AtomicLong()
    private val awaitingKeyFrames = AtomicLong()
    private val queueRejectedFrames = AtomicLong()
    private val releasedUnencodedFrames = AtomicLong()
    private val nativeKeyFrameRequests = AtomicLong()
    private val chainRejectedFrames = AtomicLong()
    private val codecMismatchFrames = AtomicLong()
    private val duplicateEncoderInputs = AtomicLong()
    private val lossEvents = AtomicLong()
    private val rateUpdates = AtomicLong()
    private val allocatedBitrateBps = AtomicLong()
    private val allocatedFramerate = AtomicInteger()

    fun attach(factory: PeerConnectionFactory): VideoTrack {
        check(source == null && !closed)
        val source = factory.createVideoSource(true, false)
        this.source = source
        source.capturerObserver.onCapturerStarted(true)
        return factory.createVideoTrack("tiplay-original-video", source).also { track = it }
    }

    override fun getSupportedCodecs(): Array<VideoCodecInfo> = offered.map {
        VideoCodecInfo(it.name, it.parameters, emptyList())
    }.toTypedArray()

    @Synchronized override fun createEncoder(info: VideoCodecInfo): VideoEncoder? {
        if (closed || offered.none { it.name.equals(info.name, true) }) return null
        val codec = codecInfo(info)
        requestedCodec = codec
        // libwebrtc can pre-create/query an encoder and still select a different format.
        // Factory allocation must never replace the authenticated receive contract.
        return PassthroughEncoder(codec, ++encoderSerial)
    }

    /** Use the answer's first primary payload, not WebCodecs capability, as the negotiated format. */
    @Synchronized fun negotiated(answer: String) {
        if (!closed) negotiatedCodec = BrowserRtcVideoPolicy.codecs(answer).firstOrNull()
    }

    /** Each native stream retains this bridge's selector, including after a replacement retires it. */
    @Synchronized override fun getEncoderSelector(): VideoEncoderFactory.VideoEncoderSelector {
        val owner = ++selectorSerial
        return object : VideoEncoderFactory.VideoEncoderSelector {
            override fun onCurrentEncoder(info: VideoCodecInfo) = synchronized(this@BrowserRtcVideoTrack) {
                if (!closed && owner == selectorSerial) announcedCodec = codecInfo(info)
            }
            override fun onAvailableBitrate(kbps: Int): VideoCodecInfo? = preferredEncoder(owner)
            override fun onResolutionChange(width: Int, height: Int): VideoCodecInfo? = preferredEncoder(owner)
            override fun onEncoderBroken(): VideoCodecInfo? = preferredEncoder(owner, broken = true)
        }
    }

    private fun preferredCodec(): BrowserRtcVideoPolicy.Codec? = sourceCodec?.let { source ->
        val allowed = offered.firstOrNull { BrowserRtcVideoPolicy.matches(source, it) } ?: return@let null
        // Switching must retain the answer's complete format, including its lower level.
        // Native factory allocation and the remote offer are not a replacement answer.
        negotiatedCodec?.takeIf { BrowserRtcVideoPolicy.matches(source, it) }
            ?: allowed.takeIf { negotiatedCodec == null }
    }

    @Synchronized private fun preferredEncoder(owner: Long, broken: Boolean = false): VideoCodecInfo? {
        if (closed || !active || failure != null) return null
        val source = sourceCodec ?: return null
        val preferred = preferredCodec() ?: return null
        if (owner != selectorSerial && !broken) return null
        if (!broken && activeEncoder?.let { BrowserRtcVideoPolicy.matches(source, it.codec) } == true) return null
        // The fixed SDK invokes this before the first frame's Encode(), then applies its
        // switch on the worker thread. The old encoder must safely reject that interim AU.
        // A broken encoder must return the source's allowed format even if a newer stream
        // already selected it: null would invite libwebrtc's unrelated default fallback.
        return VideoCodecInfo(preferred.name, preferred.parameters, emptyList())
    }

    /** Only fixed codec/profile fields are exposed; never SDP, arbitrary fmtp, URLs or identities. */
    @Synchronized fun diagnostics(): Map<String, Any?> = linkedMapOf(
        "source" to sourceCodec?.takeIf { Regex("(?:avc1\\.[0-9a-fA-F]{6}|hvc1\\.[0-9A-Fa-f.LH]+)").matches(it) },
        "offered" to offered.map(::codecDiagnostic),
        "negotiated" to negotiatedCodec?.let(::codecDiagnostic),
        "requested" to requestedCodec?.let(::codecDiagnostic),
        "announced" to announcedCodec?.let(::codecDiagnostic),
        "current" to currentCodec?.let(::codecDiagnostic),
        "preferred" to preferredCodec()?.let(::codecDiagnostic),
        "selection" to when {
            closed -> "closed"
            failure != null -> "failed"
            selectionStartedNanos != null -> "waiting"
            activeEncoder != null && active -> "ready"
            else -> "idle"
        },
        "failure" to failure,
    )

    /** Bridge-lifetime observations, not RTP delivery or browser decode/display counts. */
    fun flowDiagnostics(): Map<String, Any?> = linkedMapOf(
        "scope" to "bridge-lifetime", "receivedFrames" to receivedFrames.get(),
        "submittedFrames" to submittedFrames.get(), "outputFrames" to outputFrames.get(),
        "outputBytes" to outputBytes.get(), "awaitingKeyFrames" to awaitingKeyFrames.get(),
        "queueRejectedFrames" to queueRejectedFrames.get(), "releasedUnencodedFrames" to releasedUnencodedFrames.get(),
        "nativeKeyFrameRequests" to nativeKeyFrameRequests.get(), "chainRejectedFrames" to chainRejectedFrames.get(),
        "codecMismatchFrames" to codecMismatchFrames.get(), "duplicateEncoderInputs" to duplicateEncoderInputs.get(),
        "lossEvents" to lossEvents.get(), "pendingFrames" to pending.get(), "pendingBytes" to pendingBytes.get(),
        "waitingForKey" to waitingForKey, "rateUpdates" to rateUpdates.get(),
        "allocatedBitrateBps" to allocatedBitrateBps.get(), "allocatedFramerate" to allocatedFramerate.get(),
    )

    @Synchronized fun configure(record: WebVideoRecord): Boolean {
        if (closed || failure != null) return false
        val old = configuredEpoch
        if (old != null && old != record.epoch) { disable("source-changed"); return false }
        val fields = WebJson.parse(String(record.payload, Charsets.UTF_8)) as? Map<*, *> ?: return false
        val codec = fields["codec"] as? String ?: return false
        if (offered.none { BrowserRtcVideoPolicy.matches(codec, it) } ||
            negotiatedCodec?.let { !BrowserRtcVideoPolicy.matches(codec, it) } == true) {
            disable("codec-profile-not-negotiated"); return false
        }
        val width = (fields["width"] as? Number)?.toInt() ?: return false
        val height = (fields["height"] as? Number)?.toInt() ?: return false
        if (width !in 1..8192 || height !in 1..8192) { disable("invalid-video-size"); return false }
        configuredEpoch = record.epoch; configuration = fields; sourceCodec = codec
        active = true; waitingForKey = true; lastTimestampUs = null; clock = BrowserRtcVideoPolicy.SourceClock()
        updateSelectionWait()
        return true
    }

    /** False means this source cannot use the negotiated track and must end with a video error. */
    @Synchronized fun offer(record: WebVideoRecord): Boolean {
        receivedFrames.incrementAndGet()
        if (!active || closed || failure != null) return false
        if (record.epoch != configuredEpoch) { disable("source-changed"); return false }
        if (record.flags and WebVideoRecords.FLAG_DECODE_ONLY != 0) { disable("decode-only-video"); return false }
        if (record.codec == WebVideoRecords.CODEC_H264 && BrowserRtcVideoPolicy.hasH264BSlice(record.payload)) {
            disable("reordered-video"); return false
        }
        val last = lastTimestampUs
        if (last != null && record.timestampUs <= last) { disable("reordered-video-timestamp"); return false }
        lastTimestampUs = record.timestampUs
        if (waitingForKey && !record.keyFrame) { awaitingKeyFrames.incrementAndGet(); requestKeyFrame(); return true }
        if (pending.get() >= MAX_PENDING || record.payloadLength > WebVideoRecords.MAX_PAYLOAD ||
            pendingBytes.get() + record.payloadLength > MAX_PENDING_BYTES) {
            queueRejectedFrames.incrementAndGet(); lost(); return true
        }
        if (record.keyFrame) waitingForKey = false
        val fields = configuration ?: return false
        val width = (fields["width"] as Number).toInt()
        val height = (fields["height"] as Number).toInt()
        val timestamp = clock.map(record.timestampUs, record.captureNanos ?: nowNanos())
            ?: run { disable("video-timestamp-overflow"); return false }
        if (firstSubmittedNanos == null) firstSubmittedNanos = nowNanos()
        pending.incrementAndGet()
        pendingBytes.addAndGet(record.payloadLength.toLong())
        submittedFrames.incrementAndGet()
        val buffer = AccessUnit(record, width, height, generation.get(), lossGeneration.get())
        // Capture timestamps must be monotonic in the local clock domain. The Java source's
        // timestamp aligner may move them; encode() echoes the actual frame timestamp for JNI.
        val frame = VideoFrame(buffer, 0, timestamp)
        try {
            val capture = captureFrame
            if (capture != null) capture(frame) else source?.capturerObserver?.onFrameCaptured(frame)
        }
        catch (_: Exception) { disable("video-source-rejected") }
        finally { frame.release() }
        return failure == null
    }

    @Synchronized fun disable(reason: String) {
        active = false; waitingForKey = true; generation.incrementAndGet()
        if (failure == null) failure = reason
    }

    /** A JNI/source path that never calls the encoder must not leave the browser waiting forever. */
    @Synchronized fun pollFailure(): String? {
        if (active && selectionStartedNanos?.let { nowNanos() - it >= START_TIMEOUT_NANOS } == true)
            disable("video-encoder-selection-timeout")
        if (active && !everEncoded.get() && firstSubmittedNanos?.let { nowNanos() - it >= START_TIMEOUT_NANOS } == true)
            disable("video-encoder-start-timeout")
        return failure
    }

    private fun lost() {
        if (markLost()) requestKeyFrame()
    }

    private fun markLost(): Boolean {
        if (!active || closed) return false
        lossEvents.incrementAndGet()
        waitingForKey = true; lossGeneration.incrementAndGet()
        return true
    }

    private fun updateSelectionWait() {
        val source = sourceCodec ?: return
        val encoder = activeEncoder ?: return
        if (BrowserRtcVideoPolicy.matches(source, encoder.codec)) selectionStartedNanos = null
        else if (selectionStartedNanos == null) selectionStartedNanos = nowNanos()
    }

    override fun close() {
        if (closed) return
        closed = true; active = false; generation.incrementAndGet()
        source?.capturerObserver?.onCapturerStopped()
        track?.dispose(); track = null
        source?.dispose(); source = null
    }

    private inner class AccessUnit(
        val record: WebVideoRecord,
        private val sourceWidth: Int,
        private val sourceHeight: Int,
        val owner: Int,
        val chain: Int,
    ) : VideoFrame.Buffer {
        private val references = AtomicInteger(1)
        val encoded = AtomicBoolean(false)
        override fun getWidth() = sourceWidth
        override fun getHeight() = sourceHeight
        // A native caller attempting pixel conversion must fail, never decode/reencode silently.
        override fun toI420(): VideoFrame.I420Buffer? {
            if (active && owner == generation.get() && chain == lossGeneration.get()) disable("pixel-conversion-requested")
            return null
        }
        override fun retain() { references.incrementAndGet() }
        override fun release() {
            if (references.decrementAndGet() == 0) {
                pending.decrementAndGet()
                pendingBytes.addAndGet(-record.payloadLength.toLong())
                if (!encoded.get()) {
                    releasedUnencodedFrames.incrementAndGet()
                    if (owner == generation.get() && chain == lossGeneration.get()) lost()
                }
            }
        }
        override fun cropAndScale(x: Int, y: Int, cropWidth: Int, cropHeight: Int, scaleWidth: Int, scaleHeight: Int): VideoFrame.Buffer {
            if (active && owner == generation.get() && chain == lossGeneration.get() &&
                (x != 0 || y != 0 || cropWidth != sourceWidth || cropHeight != sourceHeight || scaleWidth != sourceWidth || scaleHeight != sourceHeight))
                disable("pixel-adaptation-requested")
            retain(); return this
        }
    }

    private inner class PassthroughEncoder(val codec: BrowserRtcVideoPolicy.Codec, private val serial: Long) : VideoEncoder {
        // The published AAR's callback captures a native pointer. Release must wait for
        // an in-flight callback and prevent any later invocation of that pointer.
        private val callbackGate = Any()
        private var callback: VideoEncoder.Callback? = null
        override fun initEncode(settings: VideoEncoder.Settings, encodeCallback: VideoEncoder.Callback): VideoCodecStatus {
            var refresh = false
            val status = synchronized(callbackGate) {
                synchronized(this@BrowserRtcVideoTrack) {
                    if (closed || failure != null || serial < initializedSerial) VideoCodecStatus.ERR_PARAMETER
                    else if (settings.numberOfSimulcastStreams > 1) {
                        disable("simulcast-not-supported"); VideoCodecStatus.ERR_PARAMETER
                    } else {
                        val previous = activeEncoder
                        initializedSerial = serial; activeEncoder = this; currentCodec = codec
                        callback = encodeCallback
                        if (previous !== this) refresh = markLost()
                        updateSelectionWait()
                        VideoCodecStatus.OK
                    }
                }
            }
            if (refresh) requestKeyFrame()
            return status
        }
        override fun release(): VideoCodecStatus {
            synchronized(callbackGate) {
                synchronized(this@BrowserRtcVideoTrack) {
                    callback = null
                    if (activeEncoder === this) activeEncoder = null
                }
            }
            return VideoCodecStatus.OK
        }
        override fun encode(frame: VideoFrame, info: VideoEncoder.EncodeInfo): VideoCodecStatus {
            if (!active || closed || activeEncoder !== this) return VideoCodecStatus.NO_OUTPUT
            val unit = frame.buffer as? AccessUnit ?: run { disable("native-buffer-not-preserved"); return VideoCodecStatus.NO_OUTPUT }
            if (unit.owner != generation.get()) return VideoCodecStatus.NO_OUTPUT
            val config = sourceCodec
            if (config == null || !BrowserRtcVideoPolicy.matches(config, codec)) {
                codecMismatchFrames.incrementAndGet()
                val refresh = synchronized(this@BrowserRtcVideoTrack) {
                    if (!active || closed || activeEncoder !== this) return VideoCodecStatus.NO_OUTPUT
                    updateSelectionWait(); markLost()
                }
                if (refresh) requestKeyFrame()
                // Resolution/bitrate selection is applied asynchronously by libwebrtc.
                // Keep dropping this old format until its matching encoder is initialized;
                // NO_OUTPUT avoids resetting it or invoking an unrelated fallback codec.
                return VideoCodecStatus.NO_OUTPUT
            }
            // Screen-source cadence adapters may repeat a buffer with a new capture time. A
            // compressed delta AU must never be replayed as if it were a newly encoded frame.
            if (!unit.encoded.compareAndSet(false, true)) { duplicateEncoderInputs.incrementAndGet(); return VideoCodecStatus.NO_OUTPUT }
            if (!active || closed || unit.owner != generation.get()) return VideoCodecStatus.NO_OUTPUT
            if (unit.chain != lossGeneration.get() || waitingForKey && !unit.record.keyFrame) {
                chainRejectedFrames.incrementAndGet(); return VideoCodecStatus.NO_OUTPUT
            }
            if (info.frameTypes.contains(EncodedImage.FrameType.VideoFrameKey) && !unit.record.keyFrame) {
                nativeKeyFrameRequests.incrementAndGet()
                lost(); return VideoCodecStatus.NO_OUTPUT
            }
            val record = unit.record
            val bytes = ByteBuffer.allocateDirect(record.payloadLength)
            record.prefix?.let(bytes::put); bytes.put(record.payload); bytes.flip()
            val image = EncodedImage.builder().setBuffer(bytes, null)
                .setEncodedWidth(unit.getWidth()).setEncodedHeight(unit.getHeight()).setCaptureTimeNs(frame.timestampNs)
                .setFrameType(if (record.keyFrame) EncodedImage.FrameType.VideoFrameKey else EncodedImage.FrameType.VideoFrameDelta)
                .setRotation(0).createEncodedImage()
            try {
                synchronized(callbackGate) {
                    if (!active || closed || activeEncoder !== this || unit.owner != generation.get()) return VideoCodecStatus.NO_OUTPUT
                    if (unit.chain != lossGeneration.get() || waitingForKey && !record.keyFrame) {
                        chainRejectedFrames.incrementAndGet(); return VideoCodecStatus.NO_OUTPUT
                    }
                    val output = callback ?: return VideoCodecStatus.UNINITIALIZED
                    if (record.keyFrame) waitingForKey = false
                    output.onEncodedFrame(image, if (codec.name == "H265") VideoEncoder.CodecSpecificInfoH265() else VideoEncoder.CodecSpecificInfoH264())
                    outputFrames.incrementAndGet()
                    outputBytes.addAndGet(record.payloadLength.toLong())
                    everEncoded.set(true)
                }
            } catch (_: Exception) {
                synchronized(this@BrowserRtcVideoTrack) {
                    if (active && activeEncoder === this && unit.owner == generation.get()) disable("encoded-video-rejected")
                }
            }
            finally { image.release() }
            return VideoCodecStatus.OK
        }
        override fun setRateAllocation(allocation: VideoEncoder.BitrateAllocation, framerate: Int): VideoCodecStatus {
            rateUpdates.incrementAndGet()
            allocatedBitrateBps.set(allocation.sum.toLong())
            allocatedFramerate.set(framerate)
            return VideoCodecStatus.OK
        }
        override fun getScalingSettings(): VideoEncoder.ScalingSettings = VideoEncoder.ScalingSettings.OFF
        override fun getImplementationName() = "TiPlay original access-unit passthrough"
        override fun isHardwareEncoder() = false // There is no encoder, hardware or software.
    }

    companion object {
        private fun codecInfo(info: VideoCodecInfo) = BrowserRtcVideoPolicy.Codec(info.name.uppercase(),
            info.params.entries.associate { it.key.lowercase() to it.value })

        private fun codecDiagnostic(codec: BrowserRtcVideoPolicy.Codec): Map<String, String> {
            val fields = linkedMapOf("codec" to codec.name.takeIf { it == "H264" || it == "H265" }.orEmpty())
            if (codec.name == "H264") {
                codec.parameters["profile-level-id"]?.takeIf { Regex("[0-9a-fA-F]{6}").matches(it) }
                    ?.let { fields["profileLevelId"] = it.lowercase() }
                codec.parameters["packetization-mode"]?.takeIf { it == "0" || it == "1" }?.let { fields["packetizationMode"] = it }
            } else if (codec.name == "H265") {
                for (key in listOf("profile-id", "tier-flag", "level-id"))
                    codec.parameters[key]?.takeIf { Regex("[0-9]{1,3}").matches(it) }?.let { fields[key] = it }
            }
            return fields
        }

        private const val MAX_PENDING = 16
        private const val MAX_PENDING_BYTES = 16 * 1024 * 1024L
        private const val START_TIMEOUT_NANOS = 6_000_000_000L
    }
}
