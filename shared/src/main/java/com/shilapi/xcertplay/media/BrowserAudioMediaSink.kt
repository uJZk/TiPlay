package com.shilapi.xcertplay.media

import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import android.os.Handler
import android.os.Looper
import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.web.WebAudioHub
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** Browser decoding while idle; Android decoding only for verified HFP/SCO microphone demand. */
class BrowserAudioMediaSink(
    private val video: MediaSink,
    private val hub: WebAudioHub,
    initiallyPaused: Boolean = false,
    private val voiceFactory: BluetoothVoiceFactory? = null,
    private val decoderFactory: (AudioFormat) -> MediaCodec = ::decoder,
) : MediaSink by video, Closeable {
    private val renderers = mutableMapOf<AudioStreamId, Decoder>()
    private val microphoneDemands = linkedMapOf<AudioStreamId, MicrophoneConfig>()
    private var microphoneId: AudioStreamId? = null
    private var voice: BluetoothVoiceChannel? = null
    @Volatile private var closed = false
    @Volatile private var paused = initiallyPaused
    @Volatile private var voiceMuted = false
    @Volatile private var voiceActive = false
    @Volatile private var routeEpoch = 0
    private val routeHandler = Handler(Looper.getMainLooper())
    private val routeRetry = Runnable { synchronized(this) { if (!closed && !paused && microphoneDemands.isNotEmpty()) selectMicrophone(force = true) } }

    init { if (!paused) hub.begin(this) }

    @Synchronized override fun onAudioStarted(id: AudioStreamId, format: AudioFormat, firstSample: Int) {
        if (closed) return
        renderers.remove(id)?.close()
        voice?.clear(id)
        renderers[id] = Decoder(id, format)
    }

    override fun onAudioRtp(id: AudioStreamId, format: AudioFormat, rtp: ByteArray, sample: Int) {
        if (paused || (voiceMuted && !BluetoothVoicePolicy.allowed(id))) return
        val renderer = synchronized(this) { if (closed) null else renderers[id] } ?: return
        renderer.offer(rtp, sample)
    }

    @Synchronized override fun onAudioClock(id: AudioStreamId, sample: Int, presentationNanos: Long) {
        renderers[id]?.timeline?.anchor(sample, presentationNanos)
    }

    @Synchronized override fun onAudioStopped(id: AudioStreamId) {
        renderers.remove(id)?.let { renderer ->
            hub.endEncodedStream(this, semanticType(id), renderer.publication)
            renderer.close()
        }
        voice?.clear(id)
    }

    @Synchronized fun pauseAudio() {
        paused = true
        microphoneId = null
        stopVoice()
        hub.end(this)
        resetDecoders()
    }

    @Synchronized fun resumeAudio() {
        if (closed || !paused) return
        paused = false
        hub.begin(this)
        resetDecoders()
        selectMicrophone()
    }

    @Synchronized override fun onMicrophoneStarted(id: AudioStreamId, config: MicrophoneConfig) {
        if (closed) return
        microphoneDemands[id] = config
        if (!paused) selectMicrophone(force = microphoneId == id)
    }

    @Synchronized override fun onMicrophoneStopped(id: AudioStreamId) {
        microphoneDemands.remove(id)
        if (!paused) selectMicrophone()
    }

    private fun selectMicrophone(force: Boolean = false) {
        // A call takes priority over a simultaneous assistant demand; ending one never ends the other.
        val entry = microphoneDemands.entries.lastOrNull { it.key.audioType.equals("telephony", true) }
            ?: microphoneDemands.entries.lastOrNull()
        if (!force && microphoneId == entry?.key) return
        microphoneId = entry?.key
        if (entry == null) { stopVoice(); return }
        voiceMuted = true; voiceActive = false
        resetDecoders()
        if (!hub.voiceRoute(this, "connecting", true)) {
            // Reconnect can create the next tap before the previous tap has actually released SCO.
            routeHandler.removeCallbacks(routeRetry)
            routeHandler.postDelayed(routeRetry, 100)
            return
        }
        routeHandler.removeCallbacks(routeRetry)
        val factory = voiceFactory
        if (factory == null) { hub.voiceRoute(this, "failed", true, "car-bluetooth-unavailable"); return }
        try {
            voice = voice ?: factory.create(::voiceState)
            voice?.start(entry.value)
        } catch (_: Exception) { voiceState(BluetoothVoiceState("failed", "bluetooth-start-failed", released = true)) }
    }

    private fun stopVoice() {
        routeHandler.removeCallbacks(routeRetry)
        voiceActive = false
        voiceMuted = voice != null
        resetDecoders()
        if (voice == null) {
            voiceMuted = false
            hub.voiceRoute(this, "idle", false)
        } else {
            voiceMuted = true
            hub.voiceRoute(this, "releasing", true)
            voice?.stop()
        }
    }

    @Synchronized private fun voiceState(next: BluetoothVoiceState) {
        val demanded = !closed && !paused && microphoneId != null
        val muted = demanded || !next.released
        val active = demanded && next.state == "active"
        val changed = voiceMuted != muted || voiceActive != active
        voiceMuted = muted; voiceActive = active
        if (changed) resetDecoders()
        hub.voiceRoute(this, if (demanded || !next.released) next.state else "idle", muted,
            next.error.takeIf { demanded || !next.released })
    }

    /** Retire workers and codec input/output, not just transport queues; in-flight PCM belongs to the old route. */
    private fun resetDecoders() {
        routeEpoch++
        val previous = renderers.toMap()
        renderers.clear()
        previous.forEach { (id, decoder) ->
            decoder.close()
            voice?.clear(id)
            if (!closed) renderers[id] = Decoder(id, decoder.format, decoder.timeline)
        }
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        routeHandler.removeCallbacks(routeRetry)
        microphoneDemands.clear(); microphoneId = null
        voiceActive = false
        voice?.close()
        if (voice == null) hub.voiceRoute(this, "idle", false)
        hub.end(this)
        resetDecoders()
    }

    private inner class Decoder(val id: AudioStreamId, val format: AudioFormat, val timeline: RtpAudioTimeline = RtpAudioTimeline(format.rtpClockRate)) : Closeable {
        private val epoch = routeEpoch
        private val packets = ArrayBlockingQueue<Pair<ByteArray, Int>>(24)
        private val order = AudioPacketOrder<Pair<ByteArray, Int>>()
        @Volatile private var running = true
        private var outputRate = format.sampleRate
        private var outputChannels = format.channels
        val publication = hub.publication(this@BrowserAudioMediaSink)
        private val bluetoothDecode = !paused && voiceActive && microphoneId != null && BluetoothVoicePolicy.allowed(id)
        private val browserForward = !paused && !voiceMuted
        private val thread = Thread(::run, if (browserForward) "browser-audio-transport" else "car-bluetooth-audio-decode").apply { isDaemon = true; start() }

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
                if (browserForward) hub.beginEncodedStream(this@BrowserAudioMediaSink, semanticType(id), browserFormat(format),
                    publication = publication, buffered = id.type == 103)
                if (bluetoothDecode && format.codec != AudioCodecKind.LPCM) codec = decoderFactory(format)
                val info = MediaCodec.BufferInfo()
                while (running) {
                    if (id.type != 103) synchronized(order) { order.drain().forEach(::enqueue) }
                    val packet = packets.poll(10, TimeUnit.MILLISECONDS)
                    if (packet != null) {
                        val sample = synchronized(this@BrowserAudioMediaSink) {
                            if (!running || paused || epoch != routeEpoch) null else timeline.unwrap(packet.second)
                        } ?: continue
                        val payload = packet.first.copyOfRange(12, packet.first.size)
                        if (browserForward) {
                            hub.publishEncoded(this@BrowserAudioMediaSink, payload,
                                sample.toDouble() * 1_000_000.0 / format.rtpClockRate, timeline.presentation(sample),
                                id = semanticType(id), buffered = id.type == 103, publication = publication)
                        } else if (!bluetoothDecode) {
                            continue
                        } else if (format.codec == AudioCodecKind.LPCM) {
                            send(MicrophonePacketizer.toWirePcm(payload), timeline.presentation(sample)) // endian conversion is symmetric
                        } else {
                            val decoder = codec ?: continue
                            var index = decoder.dequeueInputBuffer(10_000)
                            while (running && index < 0) { drain(decoder, info); index = decoder.dequeueInputBuffer(10_000) }
                            if (!running) break
                            val input = decoder.getInputBuffer(index) ?: error("decoder input unavailable")
                            input.clear()
                            val data = if (format.codec == AudioCodecKind.AAC_LC) MediaCodecSupport.adtsFrame(payload, format.sampleRate, format.channels) else payload
                            if (data.size > input.remaining()) error("audio packet too large")
                            input.put(data)
                            val timeUs = sample * 1_000_000L / format.rtpClockRate
                            decoder.queueInputBuffer(index, 0, data.size, timeUs, 0)
                        }
                    }
                    codec?.let { drain(it, info) }
                }
            } catch (_: InterruptedException) {
            } catch (error: Exception) {
                Log.w("TiPlayBrowserAudio", "Browser audio decoder ended codec=${format.codec}", error)
            } finally {
                running = false
                publication.close()
                runCatching { codec?.stop() }; runCatching { codec?.release() }
            }
        }

        private fun drain(codec: MediaCodec, info: MediaCodec.BufferInfo) {
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
                            val scaled = info.presentationTimeUs * format.rtpClockRate
                            val sample = (scaled + if (scaled < 0) -500_000L else 500_000L) / 1_000_000L
                            send(ByteArray(info.size).also { buffer.get(it) }, timeline.presentation(sample))
                        }
                    } finally { codec.releaseOutputBuffer(index, false) }
                }
            }
        }

        private fun send(pcm: ByteArray, @Suppress("UNUSED_PARAMETER") presentationNanos: Long?) {
            synchronized(this@BrowserAudioMediaSink) {
                if (!running || paused || epoch != routeEpoch || !voiceMuted || !voiceActive || microphoneId == null) return
                if (BluetoothVoicePolicy.allowed(id)) voice?.play(id, outputRate, outputChannels, pcm)
            }
        }

        @Synchronized override fun close() { running = false; publication.close(); packets.clear(); thread.interrupt() }
    }

    private companion object {
        fun semanticType(id: AudioStreamId): Int = when (id.audioType.lowercase()) {
            "media" -> 0; "telephony" -> 2; "speechrecognition" -> 3; "alert" -> 4; else -> 1
        }
        fun browserFormat(format: AudioFormat): WebAudioHub.EncodedFormat {
            val codec = when (format.codec) { AudioCodecKind.LPCM -> "pcm"; AudioCodecKind.AAC_LC -> "aac-lc"; AudioCodecKind.OPUS -> "opus" }
            val asc = if (format.codec == AudioCodecKind.AAC_LC) {
                val bits = (2 shl 11) or (MediaCodecSupport.aacFrequencyIndex(format.sampleRate) shl 7) or (format.channels shl 3)
                byteArrayOf((bits ushr 8).toByte(), bits.toByte())
            } else ByteArray(0)
            val head = if (format.codec == AudioCodecKind.OPUS) ByteArray(19).apply {
                "OpusHead".toByteArray(Charsets.US_ASCII).copyInto(this)
                this[8] = 1; this[9] = format.channels.toByte(); this[10] = 0x38; this[11] = 1
                ByteBuffer.wrap(this, 12, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(format.sampleRate)
            } else ByteArray(0)
            return WebAudioHub.EncodedFormat(codec, format.sampleRate, format.channels, 16,
                if (format.codec == AudioCodecKind.AAC_LC) 1024 else if (format.codec == AudioCodecKind.OPUS) 960 else 352,
                asc = asc, cookie = head, littleEndian = false)
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
