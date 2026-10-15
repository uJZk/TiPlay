package com.shilapi.xcertplay

import com.shilapi.xcertplay.receiver.ReceiverMirrorAudioFormat
import com.shilapi.xcertplay.web.WebAudioHub
import java.io.Closeable

/** Ordinary AirPlay transport only. Decrypted AAC, ALAC and packed PCM are decoded in the browser. */
internal class AirPlayMirrorAudio(private val format: ReceiverMirrorAudioFormat,
                                  private val hub: WebAudioHub,
                                  private val failure: (Throwable) -> Unit = {}) : Closeable {
    private var running = true

    init {
        val codec = when (format.codec) { 1 -> "pcm"; 2 -> "alac"; 4 -> "aac-lc"; 8 -> "aac-eld"; else -> error("Unsupported AirPlay audio format") }
        val config = if (format.codec == 1) ByteArray(0) else format.codecConfig()
        val cookie = if (format.codec == 2) byteArrayOf(0, 0, 0, 36, 'a'.code.toByte(), 'l'.code.toByte(), 'a'.code.toByte(), 'c'.code.toByte(), 0, 0, 0, 0) + config else ByteArray(0)
        hub.beginEncoded(this, WebAudioHub.EncodedFormat(codec, format.sampleRate, format.channels,
            format.bitDepth, format.samplesPerFrame, asc = if (format.codec in listOf(4, 8)) config else ByteArray(0), cookie = cookie))
    }

    @Synchronized fun offer(payload: ByteArray, sample: Long, presentationNanos: Long?) {
        if (!running || payload.isEmpty() || payload.size > 65536) return
        try {
            hub.publishEncoded(this, payload, sample.toDouble() * 1_000_000.0 / format.sampleRate, presentationNanos, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        } catch (error: Throwable) {
            running = false
            hub.endMirror(this)
            runCatching { failure(error) }
        }
    }

    @Synchronized fun flush() { if (running) hub.flushEncoded(this, WebAudioHub.AIRPLAY_MIRROR_STREAM) }

    @Synchronized override fun close() {
        if (!running) return
        running = false
        hub.endMirror(this)
    }
}
