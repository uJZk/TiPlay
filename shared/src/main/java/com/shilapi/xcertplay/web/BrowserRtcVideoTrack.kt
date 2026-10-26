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
    @Volatile private var selected: BrowserRtcVideoPolicy.Codec? = null
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

    override fun createEncoder(info: VideoCodecInfo): VideoEncoder? {
        if (offered.none { it.name.equals(info.name, true) }) return null
        // Negotiation may lower the level or normalize fmtp keys. Check the actual resulting
        // format against the source in configure()/encode(), rather than requiring map identity.
        val codec = BrowserRtcVideoPolicy.Codec(info.name.uppercase(), info.params)
        selected = codec
        return PassthroughEncoder(codec)
    }

    /** Use the answer's first primary payload, not WebCodecs capability, as the negotiated format. */
    fun negotiated(answer: String) { selected = BrowserRtcVideoPolicy.codecs(answer).firstOrNull() }

    @Synchronized fun configure(record: WebVideoRecord): Boolean {
        if (closed || failure != null) return false
        val old = configuredEpoch
        if (old != null && old != record.epoch) { disable("source-changed"); return false }
        val fields = WebJson.parse(String(record.payload, Charsets.UTF_8)) as? Map<*, *> ?: return false
        val codec = fields["codec"] as? String ?: return false
        val negotiated = selected ?: return false
        if (!BrowserRtcVideoPolicy.matches(codec, negotiated)) { disable("codec-profile-not-negotiated"); return false }
        val width = (fields["width"] as? Number)?.toInt() ?: return false
        val height = (fields["height"] as? Number)?.toInt() ?: return false
        if (width !in 1..8192 || height !in 1..8192) { disable("invalid-video-size"); return false }
        configuredEpoch = record.epoch; configuration = fields
        active = true; waitingForKey = true; lastTimestampUs = null; clock = BrowserRtcVideoPolicy.SourceClock()
        return true
    }

    /** False means this source cannot use the negotiated track and must end with a video error. */
    @Synchronized fun offer(record: WebVideoRecord): Boolean {
        if (!active || closed || failure != null) return false
        if (record.epoch != configuredEpoch) { disable("source-changed"); return false }
        if (record.flags and WebVideoRecords.FLAG_DECODE_ONLY != 0) { disable("decode-only-video"); return false }
        if (record.codec == WebVideoRecords.CODEC_H264 && BrowserRtcVideoPolicy.hasH264BSlice(record.payload)) {
            disable("reordered-video"); return false
        }
        val last = lastTimestampUs
        if (last != null && record.timestampUs <= last) { disable("reordered-video-timestamp"); return false }
        lastTimestampUs = record.timestampUs
        if (waitingForKey && !record.keyFrame) { requestKeyFrame(); return true }
        if (pending.get() >= MAX_PENDING || record.payloadLength > WebVideoRecords.MAX_PAYLOAD ||
            pendingBytes.get() + record.payloadLength > MAX_PENDING_BYTES) {
            lost(); return true
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
        if (active && !everEncoded.get() && firstSubmittedNanos?.let { nowNanos() - it >= START_TIMEOUT_NANOS } == true)
            disable("video-encoder-start-timeout")
        return failure
    }

    private fun lost() {
        if (!active || closed) return
        waitingForKey = true; lossGeneration.incrementAndGet(); requestKeyFrame()
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
        override fun toI420(): VideoFrame.I420Buffer? { disable("pixel-conversion-requested"); return null }
        override fun retain() { references.incrementAndGet() }
        override fun release() {
            if (references.decrementAndGet() == 0) {
                pending.decrementAndGet()
                pendingBytes.addAndGet(-record.payloadLength.toLong())
                if (!encoded.get() && owner == generation.get()) lost()
            }
        }
        override fun cropAndScale(x: Int, y: Int, cropWidth: Int, cropHeight: Int, scaleWidth: Int, scaleHeight: Int): VideoFrame.Buffer {
            if (x != 0 || y != 0 || cropWidth != sourceWidth || cropHeight != sourceHeight || scaleWidth != sourceWidth || scaleHeight != sourceHeight)
                disable("pixel-adaptation-requested")
            retain(); return this
        }
    }

    private inner class PassthroughEncoder(private val codec: BrowserRtcVideoPolicy.Codec) : VideoEncoder {
        private var callback: VideoEncoder.Callback? = null
        override fun initEncode(settings: VideoEncoder.Settings, encodeCallback: VideoEncoder.Callback): VideoCodecStatus {
            if (settings.numberOfSimulcastStreams > 1) { disable("simulcast-not-supported"); return VideoCodecStatus.ERR_PARAMETER }
            callback = encodeCallback
            return VideoCodecStatus.OK
        }
        override fun release(): VideoCodecStatus { callback = null; return VideoCodecStatus.OK }
        override fun encode(frame: VideoFrame, info: VideoEncoder.EncodeInfo): VideoCodecStatus {
            val unit = frame.buffer as? AccessUnit ?: run { disable("native-buffer-not-preserved"); return VideoCodecStatus.NO_OUTPUT }
            // Screen-source cadence adapters may repeat a buffer with a new capture time. A
            // compressed delta AU must never be replayed as if it were a newly encoded frame.
            if (!unit.encoded.compareAndSet(false, true)) return VideoCodecStatus.NO_OUTPUT
            if (!active || closed || unit.owner != generation.get()) return VideoCodecStatus.NO_OUTPUT
            val config = configuration?.get("codec") as? String
            if (config == null || !BrowserRtcVideoPolicy.matches(config, codec)) {
                disable("encoder-codec-mismatch"); return VideoCodecStatus.NO_OUTPUT
            }
            if (unit.chain != lossGeneration.get() || waitingForKey && !unit.record.keyFrame) return VideoCodecStatus.NO_OUTPUT
            if (info.frameTypes.contains(EncodedImage.FrameType.VideoFrameKey) && !unit.record.keyFrame) {
                lost(); return VideoCodecStatus.NO_OUTPUT
            }
            if (unit.record.keyFrame) waitingForKey = false
            val output = callback ?: return VideoCodecStatus.UNINITIALIZED
            val record = unit.record
            val bytes = ByteBuffer.allocateDirect(record.payloadLength)
            record.prefix?.let(bytes::put); bytes.put(record.payload); bytes.flip()
            val image = EncodedImage.builder().setBuffer(bytes, null)
                .setEncodedWidth(unit.getWidth()).setEncodedHeight(unit.getHeight()).setCaptureTimeNs(frame.timestampNs)
                .setFrameType(if (record.keyFrame) EncodedImage.FrameType.VideoFrameKey else EncodedImage.FrameType.VideoFrameDelta)
                .setRotation(0).createEncodedImage()
            try {
                output.onEncodedFrame(image, if (codec.name == "H265") VideoEncoder.CodecSpecificInfoH265() else VideoEncoder.CodecSpecificInfoH264())
                everEncoded.set(true)
            } catch (_: Exception) { disable("encoded-video-rejected") }
            finally { image.release() }
            return VideoCodecStatus.OK
        }
        override fun setRateAllocation(allocation: VideoEncoder.BitrateAllocation, framerate: Int) = VideoCodecStatus.OK
        override fun getScalingSettings(): VideoEncoder.ScalingSettings = VideoEncoder.ScalingSettings.OFF
        override fun getImplementationName() = "TiPlay original access-unit passthrough"
        override fun isHardwareEncoder() = false // There is no encoder, hardware or software.
    }

    companion object {
        private const val MAX_PENDING = 16
        private const val MAX_PENDING_BYTES = 16 * 1024 * 1024L
        private const val START_TIMEOUT_NANOS = 6_000_000_000L
    }
}
