package com.shilapi.xcertplay.media

import android.util.Log
import com.shilapi.xcertplay.airplay.AudioCodecKind
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import com.shilapi.xcertplay.airplay.MicrophoneCounters
import com.shilapi.xcertplay.airplay.MicrophonePacketizer
import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket

/** Browser capture supplies echo-cancelled mono PCM; Android only encodes and seals the uplink. */
internal class BrowserMicrophone(private val config: MicrophoneConfig) : Closeable {
    val sampleRate: Int get() = if (config.codec == AudioCodecKind.OPUS) 48_000 else config.sampleRate
    init { require(config.channels == 1); require(config.codec in listOf(AudioCodecKind.OPUS, AudioCodecKind.LPCM)) }
    private val socket = DatagramSocket()
    private val encoder = if (config.codec == AudioCodecKind.OPUS) OpusEncoder(config.bitrate ?: 48_000) else null
    private val counters = MicrophoneCounters()
    private var pending = ByteArray(0)
    private var closed = false
    private var uploadedBytes = 0L
    private var encodedFrames = 0L
    private var emptyFrames = 0L
    private var sentPackets = 0L
    private var sendErrors = 0L
    private var reportAt = System.nanoTime()

    init {
        if (encoder != null && !encoder.available) { socket.close(); encoder.close(); error("microphone encoder unavailable") }
        Log.i(TAG, "start codec=${config.codec} captureRate=$sampleRate rtpRate=${config.opusClockRate} frameBytes=${config.frameBytes}")
    }

    @Synchronized fun accept(pcm: ByteArray) {
        if (closed || pcm.size % 2 != 0 || pcm.size > sampleRate * 2 / 10) return
        uploadedBytes += pcm.size
        val data = pending + pcm
        var offset = 0
        while (offset + config.frameBytes <= data.size) {
            val frame = data.copyOfRange(offset, offset + config.frameBytes)
            val payloads = encoder?.encode(frame) ?: listOf(MicrophonePacketizer.toWirePcm(frame))
            encodedFrames++
            if (payloads.isEmpty()) emptyFrames++
            for (payload in payloads) {
                val packet = MicrophonePacketizer.sealPacket(config.key, config.payloadType, counters, payload, config.rtpSamplesPerPacket)
                try {
                    socket.send(DatagramPacket(packet, packet.size, config.host, config.port))
                    sentPackets++
                } catch (error: Exception) {
                    sendErrors++
                    report(force = true)
                    throw error
                }
            }
            offset += config.frameBytes
        }
        pending = data.copyOfRange(offset, data.size)
        report()
    }

    private fun report(force: Boolean = false) {
        val now = System.nanoTime()
        if (!force && now - reportAt < 5_000_000_000L) return
        // Counts only: no PCM, codec payload, encryption key or peer endpoint is logged.
        Log.i(TAG, "stats uploadedBytes=$uploadedBytes encodedFrames=$encodedFrames emptyFrames=$emptyFrames udpSent=$sentPackets sendErrors=$sendErrors")
        reportAt = now
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        report(force = true)
        pending = ByteArray(0)
        socket.close()
        encoder?.close()
    }

    private companion object { const val TAG = "tiplay-microphone" }
}
