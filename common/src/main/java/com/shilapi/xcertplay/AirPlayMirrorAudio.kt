package com.shilapi.xcertplay

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.util.Log
import com.shilapi.xcertplay.receiver.ReceiverMirrorAudioFormat
import com.shilapi.xcertplay.web.WebAudioHub
import java.io.Closeable
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** AAC-ELD mirror soundtrack only. ALAC/standalone AirTunes are deliberately excluded. */
internal class AirPlayMirrorAudio(private val format: ReceiverMirrorAudioFormat,
                                  private val hub: WebAudioHub) : Closeable {
    private data class Packet(val payload: ByteArray, val sample: Long, val presentationNanos: Long?)
    private val packets = ArrayBlockingQueue<Packet>(24)
    private val presentation = java.util.TreeMap<Long, Long?>()
    @Volatile private var running = true
    private var reset = true
    private val thread: Thread

    init {
        hub.beginMirror(this)
        thread = Thread(::decode, "tiplay-airplay-mirror-audio").apply { isDaemon = true; start() }
    }

    fun offer(payload: ByteArray, sample: Long, presentationNanos: Long?) {
        if (!running || payload.isEmpty() || payload.size > 65536) return
        val packet = Packet(payload, sample, presentationNanos)
        if (!packets.offer(packet)) { packets.poll(); packets.offer(packet) }
    }

    private fun decode() {
        var codec: MediaCodec? = null
        try {
            require(format.sampleRate == 44100 && format.channels == 2)
            val media = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, format.sampleRate, format.channels).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectELD)
                setInteger(MediaFormat.KEY_PCM_ENCODING, 2)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 65536)
                // ISO AudioSpecificConfig used by UxPlay: AOT 39, 44.1 kHz, stereo, 480 samples.
                setByteBuffer("csd-0", ByteBuffer.wrap(byteArrayOf(0xf8.toByte(), 0xe8.toByte(), 0x50, 0x00)))
            }
            codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            codec.configure(media, null, null, 0); codec.start()
            val info = MediaCodec.BufferInfo()
            while (running) {
                val packet = packets.poll(10, TimeUnit.MILLISECONDS)
                if (packet != null) {
                    var input = codec.dequeueInputBuffer(10_000)
                    while (running && input < 0) { drain(codec, info); input = codec.dequeueInputBuffer(10_000) }
                    if (!running) break
                    val buffer = requireNotNull(codec.getInputBuffer(input)); buffer.clear(); buffer.put(packet.payload)
                    val timeUs = packet.sample * 1_000_000L / format.sampleRate
                    presentation[timeUs] = packet.presentationNanos
                    while (presentation.size > 128) presentation.pollFirstEntry()
                    codec.queueInputBuffer(input, 0, packet.payload.size, timeUs, 0)
                }
                drain(codec, info)
            }
        } catch (_: InterruptedException) {
        } catch (error: Exception) {
            Log.w("TiPlayAirPlayAudio", "Mirror AAC-ELD decoder unavailable", error)
        } finally {
            running = false
            runCatching { codec?.stop() }; runCatching { codec?.release() }
            hub.endMirror(this)
        }
    }

    private fun drain(codec: MediaCodec, info: MediaCodec.BufferInfo) {
        while (running) {
            val index = codec.dequeueOutputBuffer(info, 0)
            if (index == MediaCodec.INFO_TRY_AGAIN_LATER) return
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                val output = codec.outputFormat
                require(output.getInteger(MediaFormat.KEY_SAMPLE_RATE) == 44100 && output.getInteger(MediaFormat.KEY_CHANNEL_COUNT) == 2)
                require(!output.containsKey(MediaFormat.KEY_PCM_ENCODING) || output.getInteger(MediaFormat.KEY_PCM_ENCODING) == 2)
            } else if (index >= 0) {
                try {
                    if (info.size > 0) {
                        val buffer = requireNotNull(codec.getOutputBuffer(index)); buffer.position(info.offset); buffer.limit(info.offset + info.size)
                        val anchor = presentation.floorEntry(info.presentationTimeUs)
                        val mapped = anchor?.value?.let { it + (info.presentationTimeUs - anchor.key) * 1000L }
                        if (anchor != null) presentation.headMap(anchor.key, false).clear()
                        hub.publish(this, WebAudioHub.AIRPLAY_MIRROR_STREAM, format.sampleRate, format.channels, ByteArray(info.size).also { buffer.get(it) }, reset = reset,
                            presentationNanos = mapped, mode = com.shilapi.xcertplay.web.BrowserPlaybackMode.AIRPLAY_MIRROR)
                        reset = false
                    }
                } finally { codec.releaseOutputBuffer(index, false) }
            }
        }
    }

    override fun close() { running = false; packets.clear(); thread.interrupt(); hub.endMirror(this) }
}
