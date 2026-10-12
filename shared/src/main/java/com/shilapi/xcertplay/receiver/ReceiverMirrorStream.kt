package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.ScreenCodec
import com.shilapi.xcertplay.airplay.NtpClock
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoCodecs
import com.shilapi.xcertplay.network.TcpLiveness
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

/** Ordinary AirPlay AES-CTR screen packets. Cipher state continues across partial frame blocks. */
class ReceiverMirrorStream(key: ByteArray, connectionId: Long, private val peer: InetAddress,
                           private val sink: WebMediaSink, private val clock: NtpClock,
                           log: (String) -> Unit = {},
                           private val ended: () -> Unit) : Closeable {
    private val closed = AtomicBoolean(false)
    private val server = ServerSocket()
    @Volatile private var socket: Socket? = null
    private val diagnostics = ReceiverMirrorDiagnostics(log)
    private val cipher = aesCtr(
        AirPlayCrypto.sha512("AirPlayStreamKey${java.lang.Long.toUnsignedString(connectionId)}".toByteArray(), key).copyOf(16),
        AirPlayCrypto.sha512("AirPlayStreamIV${java.lang.Long.toUnsignedString(connectionId)}".toByteArray(), key).copyOf(16),
    )

    fun start(): Int {
        server.bind(InetSocketAddress(InetAddress.getByName("::"), 0))
        sink.setVideoClockHandler(110, clock::mediaTimeNanos)
        diagnostics.listening()
        Thread(::run, "tiplay-airplay-mirror").apply { isDaemon = true; start() }
        return server.localPort
    }

    private fun run() {
        var stage = ReceiverMirrorDiagnostics.Stage.ACCEPT
        var reason = ReceiverMirrorDiagnostics.End.CLOSED
        try {
            var accepted: Socket
            do {
                accepted = server.accept()
                if (accepted.inetAddress != peer) accepted.close()
            } while (accepted.inetAddress != peer && !closed.get())
            socket = accepted
            if (closed.get()) { accepted.close(); return }
            diagnostics.accepted()
            TcpLiveness.configure(accepted) {}
            accepted.tcpNoDelay = true
            val input = accepted.getInputStream()
            while (!closed.get()) {
                stage = ReceiverMirrorDiagnostics.Stage.HEADER
                val header = ByteArray(128)
                if (!readPacket(input, header)) { reason = ReceiverMirrorDiagnostics.End.HEADER_EOF; break }
                val data = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
                val size = data.int
                require(size in 0..8 * 1024 * 1024)
                val type = header[4].toInt() and 0xff
                diagnostics.packet(type, size)
                val body = ByteArray(size)
                stage = ReceiverMirrorDiagnostics.Stage.BODY
                val bodyStart = System.nanoTime()
                if (!readPacket(input, body)) { reason = ReceiverMirrorDiagnostics.End.BODY_EOF; break }
                val arrivalNanos = System.nanoTime()
                when (type) {
                    0 -> {
                        stage = ReceiverMirrorDiagnostics.Stage.DECRYPT
                        val plain = cipher.update(body)
                        if (plain != null && plain.isNotEmpty()) {
                            val frame = ScreenCodec.lengthPrefixedToAnnexB(plain)
                            stage = ReceiverMirrorDiagnostics.Stage.PUBLISH
                            val senderNanos = ScreenCodec.senderNanos(header)
                            val publishStart = System.nanoTime()
                            sink.onVideoFrame(110, frame, senderNanos, arrivalNanos)
                            val publishNanos = System.nanoTime() - publishStart
                            val annexB = frame.size >= 5 && frame[0] == 0.toByte() && frame[1] == 0.toByte() &&
                                (frame[2] == 1.toByte() || (frame[2] == 0.toByte() && frame[3] == 1.toByte()))
                            diagnostics.forwarded(frame.size, WebVideoCodecs.isKeyFrame(VideoCodec.H264, frame), annexB)
                            diagnostics.timing(senderNanos, arrivalNanos, arrivalNanos - bodyStart, publishNanos)
                        }
                    }
                    1 -> {
                        stage = ReceiverMirrorDiagnostics.Stage.CONFIG
                        val width = data.getFloat(56).toInt()
                        val height = data.getFloat(60).toInt()
                        diagnostics.geometry(width, height)
                        require(width in 16..8192 && height in 16..8192)
                        sink.updateCanvas(width, height)
                        sink.onScreenStreamActive(110, true)
                        val config = ScreenCodec.describeConfig(body)
                        diagnostics.config(config.codec, config.record.size)
                        require(config.codec == VideoCodec.H264) // no multi-codec capability advertised
                        stage = ReceiverMirrorDiagnostics.Stage.PUBLISH
                        sink.onVideoCodec(110, config.codec)
                        sink.onVideoConfig(110, config.record)
                    }
                }
            }
        } catch (error: Exception) {
            reason = if (closed.get()) ReceiverMirrorDiagnostics.End.CLOSED else ReceiverMirrorDiagnostics.End.FAILED
            if (!closed.get()) diagnostics.failure(stage, error)
        } finally {
            diagnostics.end(reason)
            close()
            ended()
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        runCatching { server.close() }
        runCatching { socket?.close() }
        sink.close()
    }
}

internal fun readPacket(input: java.io.InputStream, bytes: ByteArray): Boolean {
    var offset = 0
    while (offset < bytes.size) {
        val count = input.read(bytes, offset, bytes.size - offset)
        if (count < 0) return false
        offset += count
    }
    return true
}
