package com.shilapi.xcertplay.media

import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.web.WebAudioHub
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** Decodes on bounded workers, without AudioTrack or AudioRecord. The car browser owns playback/capture. */
class BrowserAudioMediaSink(private val video: MediaSink, private val hub: WebAudioHub, initiallyPaused: Boolean = false) : MediaSink by video, Closeable {
    private val renderers = mutableMapOf<AudioStreamId, Decoder>()
    private var microphone: BrowserMicrophone? = null
    private var microphoneId: AudioStreamId? = null
    private var closed = false
    @Volatile private var paused = initiallyPaused

    init { if (!paused) hub.begin(this) }

    @Synchronized override fun onAudioStarted(id: AudioStreamId, format: AudioFormat, firstSample: Int) {
        if (closed) return
        renderers.remove(id)?.close()
        renderers[id] = Decoder(id, format)
    }

    override fun onAudioRtp(id: AudioStreamId, format: AudioFormat, rtp: ByteArray, sample: Int) {
        val renderer = synchronized(this) { if (closed) null else renderers[id] } ?: return
        renderer.offer(rtp, sample)
    }

    @Synchronized override fun onAudioClock(id: AudioStreamId, sample: Int, presentationNanos: Long) {
        renderers[id]?.timeline?.anchor(sample, presentationNanos)
    }

    @Synchronized override fun onAudioStopped(id: AudioStreamId) {
        renderers.remove(id)?.close()
        hub.flush(this, semanticType(id))
    }

    @Synchronized fun pauseAudio() { paused = true; hub.end(this) }

    @Synchronized fun resumeAudio() {
        if (closed || !paused) return
        paused = false
        hub.begin(this)
        microphone?.let { capture -> hub.microphone(this, capture.sampleRate) { capture.accept(it) } }
    }

    @Synchronized override fun onMicrophoneStarted(id: AudioStreamId, config: MicrophoneConfig) {
        if (closed) return
        microphone?.close()
        microphone = null
        microphoneId = null
        hub.microphone(this, 0, null)
        val capture = try { BrowserMicrophone(config) } catch (error: Exception) {
            Log.w("tiplay-microphone", "browser microphone start failed codec=${config.codec} error=${error.javaClass.simpleName}")
            return
        }
        microphone = capture
        microphoneId = id
        hub.microphone(this, capture.sampleRate) { capture.accept(it) }
    }

    @Synchronized override fun onMicrophoneStopped(id: AudioStreamId) {
        if (microphoneId != id) return
        hub.microphone(this, 0, null)
        microphone?.close()
        microphone = null
        microphoneId = null
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        hub.end(this)
        microphone?.close()
        microphone = null
        renderers.values.forEach { it.close() }
        renderers.clear()
    }

    private inner class Decoder(val id: AudioStreamId, val format: AudioFormat) : Closeable {
        private val packets = ArrayBlockingQueue<Pair<ByteArray, Int>>(24)
        val timeline = RtpAudioTimeline(format.sampleRate)
        private val order = AudioPacketOrder<Pair<ByteArray, Int>>()
        @Volatile private var running = true
        private var reset = true
        private var outputRate = format.sampleRate
        private var outputChannels = format.channels
        private val thread = Thread(::run, "browser-audio-decode").apply { isDaemon = true; start() }

        fun offer(rtp: ByteArray, sample: Int) {
            if (!running || rtp.size <= 12) return
            if (id.type == 103) enqueue(rtp to sample)
            else {
                val sequence = ((rtp[2].toInt() and 255) shl 8) or (rtp[3].toInt() and 255)
                synchronized(order) { order.offer(sequence, rtp to sample).forEach(::enqueue) }
            }
        }

        private fun enqueue(packet: Pair<ByteArray, Int>) {
            if (id.type == 103) {
                while (running && !packets.offer(packet, 100, TimeUnit.MILLISECONDS)) Unit
            } else if (!packets.offer(packet)) {
                packets.poll()
                packets.offer(packet)
            }
        }

        private fun run() {
            var codec: MediaCodec? = null
            try {
                if (format.codec != AudioCodecKind.LPCM) codec = decoder(format)
                while (running) {
                    if (id.type != 103) synchronized(order) { order.drain().forEach(::enqueue) }
                    val packet = packets.poll(10, TimeUnit.MILLISECONDS)
                    if (packet != null) {
                        val sample = timeline.unwrap(packet.second)
                        val payload = packet.first.copyOfRange(12, packet.first.size)
                        if (format.codec == AudioCodecKind.LPCM) {
                            send(MicrophonePacketizer.toWirePcm(payload), timeline.presentation(sample)) // endian conversion is symmetric
                        } else {
                            val decoder = codec ?: continue
                            var index = decoder.dequeueInputBuffer(10_000)
                            while (running && index < 0) { drain(decoder); index = decoder.dequeueInputBuffer(10_000) }
                            if (!running) break
                            val input = decoder.getInputBuffer(index) ?: error("decoder input unavailable")
                            input.clear()
                            val data = if (format.codec == AudioCodecKind.AAC_LC) MediaCodecSupport.adtsFrame(payload, format.sampleRate, format.channels) else payload
                            if (data.size > input.remaining()) error("audio packet too large")
                            input.put(data)
                            val timeUs = sample * 1_000_000L / format.sampleRate
                            decoder.queueInputBuffer(index, 0, data.size, timeUs, 0)
                        }
                    }
                    codec?.let(::drain)
                }
            } catch (_: InterruptedException) {
            } catch (error: Exception) {
                Log.w("TiPlayBrowserAudio", "Browser audio decoder ended codec=${format.codec}", error)
            } finally {
                running = false
                runCatching { codec?.stop() }; runCatching { codec?.release() }
            }
        }

        private fun drain(codec: MediaCodec) {
            val info = MediaCodec.BufferInfo()
            while (running) {
                val index = codec.dequeueOutputBuffer(info, 0)
                if (index == MediaCodec.INFO_TRY_AGAIN_LATER) return
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val output = codec.outputFormat
                    outputRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    outputChannels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    if (output.containsKey(MediaFormat.KEY_PCM_ENCODING) && output.getInteger(MediaFormat.KEY_PCM_ENCODING) != 2) error("unsupported decoder PCM encoding")
                } else if (index >= 0) {
                    try {
                        if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                            val buffer = codec.getOutputBuffer(index) ?: error("decoder output unavailable")
                            buffer.position(info.offset); buffer.limit(info.offset + info.size)
                            val scaled = info.presentationTimeUs * format.sampleRate
                            val sample = (scaled + if (scaled < 0) -500_000L else 500_000L) / 1_000_000L
                            send(ByteArray(info.size).also { buffer.get(it) }, timeline.presentation(sample))
                        }
                    } finally { codec.releaseOutputBuffer(index, false) }
                }
            }
        }

        @Synchronized private fun send(pcm: ByteArray, presentationNanos: Long?) {
            if (!running || paused) return
            val type = semanticType(id)
            hub.publish(this@BrowserAudioMediaSink, type, outputRate, outputChannels, pcm, buffered = id.type == 103, reset = reset,
                presentationNanos = presentationNanos)
            reset = false
        }

        @Synchronized override fun close() { running = false; packets.clear(); thread.interrupt() }
    }

    private companion object {
        fun semanticType(id: AudioStreamId): Int = when (id.audioType.lowercase()) {
            "media" -> 0; "telephony" -> 2; "speechrecognition" -> 3; "alert" -> 4; else -> 1
        }
        fun decoder(format: AudioFormat): MediaCodec {
            val opus = format.codec == AudioCodecKind.OPUS
            val mime = if (opus) MediaFormat.MIMETYPE_AUDIO_OPUS else MediaFormat.MIMETYPE_AUDIO_AAC
            val media = MediaFormat.createAudioFormat(mime, format.sampleRate, format.channels).apply {
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 65536)
                setInteger(MediaFormat.KEY_PCM_ENCODING, 2)
                if (opus) {
                    val head = ByteArray(19)
                    "OpusHead".toByteArray(Charsets.US_ASCII).copyInto(head)
                    head[8] = 1; head[9] = format.channels.toByte(); head[10] = 0x38; head[11] = 1
                    ByteBuffer.wrap(head, 12, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(format.sampleRate)
                    setByteBuffer("csd-0", ByteBuffer.wrap(head))
                    setByteBuffer("csd-1", ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(6_500_000).apply { flip() })
                    setByteBuffer("csd-2", ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(80_000_000).apply { flip() })
                } else {
                    setInteger(MediaFormat.KEY_IS_ADTS, 1)
                    val asc = (2 shl 11) or (MediaCodecSupport.aacFrequencyIndex(format.sampleRate) shl 7) or (format.channels shl 3)
                    setByteBuffer("csd-0", ByteBuffer.wrap(byteArrayOf((asc ushr 8).toByte(), asc.toByte())))
                }
            }
            val codec = MediaCodec.createDecoderByType(mime)
            try { codec.configure(media, null, null, 0); codec.start(); return codec }
            catch (error: Exception) { codec.release(); throw error }
        }
    }
}
