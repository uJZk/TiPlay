package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.diagnostics.RawTraffic
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
import java.net.SocketTimeoutException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

/** Ordinary AirPlay AES-CTR screen packets. Cipher state continues across partial frame blocks. */
class ReceiverMirrorStream(key: ByteArray, connectionId: Long, private val peer: InetAddress,
                           private val sink: WebMediaSink, private val clock: NtpClock,
                           log: (String) -> Unit = {},
                           private val hevcEnabled: Boolean = false,
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
        var codec = VideoCodec.H264
        var lengthBytes = 4
        var suspended = false
        var configuredWidth: Int? = null
        var configuredHeight: Int? = null
        try {
            var input: InputStream? = null
            var reconnectDeadline = 0L
            val header = ByteArray(128)
            val data = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
            while (!closed.get()) {
                if (input == null) {
                    stage = ReceiverMirrorDiagnostics.Stage.ACCEPT
                    if (reconnectDeadline != 0L) {
                        val remaining = reconnectDeadline - System.nanoTime()
                        if (remaining <= 0L) break
                        server.soTimeout = (remaining / 1_000_000).coerceIn(1, RECONNECT_MILLIS).toInt()
                    }
                    val accepted = server.accept()
                    if (accepted.inetAddress != peer) { accepted.close(); continue }
                    socket = accepted
                    if (closed.get()) { accepted.close(); return }
                    diagnostics.accepted()
                    TcpLiveness.configure(accepted) {}
                    accepted.tcpNoDelay = true
                    accepted.soTimeout = 120_000
                    input = RawTraffic.input("iphone/ReceiverMirrorStream/${accepted.remoteSocketAddress}/${accepted.localPort}/in", accepted.getInputStream())
                    reconnectDeadline = 0L
                }
                stage = ReceiverMirrorDiagnostics.Stage.HEADER
                val headerBytes = readMirrorPacket(requireNotNull(input), header)
                if (headerBytes != header.size) {
                    reason = ReceiverMirrorDiagnostics.End.HEADER_EOF
                    // Only an EOF at a complete packet boundary can resume the existing CTR byte stream.
                    if (headerBytes != 0) break
                    runCatching { socket?.close() }; socket = null; input = null
                    reconnectDeadline = System.nanoTime() + RECONNECT_MILLIS * 1_000_000
                    diagnostics.reconnecting(RECONNECT_MILLIS)
                    continue
                }
                val size = data.getInt(0)
                require(size in 0..8 * 1024 * 1024)
                val type = header[4].toInt() and 0xff
                diagnostics.packet(type, size)
                val body = ByteArray(size)
                stage = ReceiverMirrorDiagnostics.Stage.BODY
                val bodyStart = System.nanoTime()
                if (!readPacket(requireNotNull(input), body)) { reason = ReceiverMirrorDiagnostics.End.BODY_EOF; break }
                val arrivalNanos = System.nanoTime()
                when (type) {
                    0 -> {
                        stage = ReceiverMirrorDiagnostics.Stage.DECRYPT
                        val plain = cipher.update(body)
                        if (plain != null && plain.isNotEmpty() && !suspended) {
                            stage = ReceiverMirrorDiagnostics.Stage.FRAME_VALIDATE
                            val frame = ReceiverMirrorCodec.annexB(plain, lengthBytes)
                            ReceiverMirrorCodec.requireSdrFrame(frame, codec)
                            stage = ReceiverMirrorDiagnostics.Stage.PUBLISH
                            val senderNanos = ScreenCodec.senderNanos(header)
                            val publishStart = System.nanoTime()
                            sink.onVideoFrame(110, frame, senderNanos, arrivalNanos)
                            val publishNanos = System.nanoTime() - publishStart
                            val annexB = frame.size >= 5 && frame[0] == 0.toByte() && frame[1] == 0.toByte() &&
                                (frame[2] == 1.toByte() || (frame[2] == 0.toByte() && frame[3] == 1.toByte()))
                            diagnostics.forwarded(frame.size, WebVideoCodecs.isKeyFrame(codec, frame), annexB)
                            diagnostics.timing(senderNanos, arrivalNanos, arrivalNanos - bodyStart, publishNanos)
                        }
                    }
                    1 -> {
                        stage = ReceiverMirrorDiagnostics.Stage.CONFIG
                        suspended = ReceiverMirrorCodec.suspended(header[6].toInt() and 255, suspended)
                        if (body.isEmpty() && suspended) continue
                        val width = data.getFloat(56).toInt()
                        val height = data.getFloat(60).toInt()
                        diagnostics.configInput(body.size, ScreenCodec.describeConfig(body).codec)
                        diagnostics.geometry(width, height)
                        if (width !in 16..8192 || height !in 16..8192)
                            throw ReceiverMirrorCodec.ConfigurationException(ReceiverMirrorCodec.Reason.INVALID_GEOMETRY)
                        val config = ReceiverMirrorCodec.config(body, hevcEnabled)
                        diagnostics.config(config.codec, config.record.size)
                        diagnostics.envelope(config)
                        codec = config.codec
                        lengthBytes = config.lengthBytes
                        if (suspended) continue
                        stage = ReceiverMirrorDiagnostics.Stage.PUBLISH
                        val geometryChanged = width != configuredWidth || height != configuredHeight
                        if (geometryChanged) {
                            sink.onScreenStreamActive(110, false)
                            sink.updateCanvas(width, height)
                        }
                        sink.onVideoCodec(110, config.codec)
                        if (geometryChanged) sink.onScreenStreamActive(110, true)
                        // The sender repeats its configuration around sleep/resume without an IDR.
                        // Keep the live prediction chain; the hub itself detects actual record changes.
                        sink.onVideoConfig(110, config.record)
                        configuredWidth = width
                        configuredHeight = height
                    }
                }
            }
        } catch (error: Exception) {
            val endedGrace = error is SocketTimeoutException && stage == ReceiverMirrorDiagnostics.Stage.ACCEPT &&
                reason == ReceiverMirrorDiagnostics.End.HEADER_EOF
            if (!endedGrace) {
                reason = if (closed.get()) ReceiverMirrorDiagnostics.End.CLOSED else ReceiverMirrorDiagnostics.End.FAILED
                if (!closed.get()) diagnostics.failure(stage, error)
            }
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

    companion object { private const val RECONNECT_MILLIS = 5_000L }
}

/** Reports a partial header separately from a clean boundary EOF, which alone may reconnect. */
internal fun readMirrorPacket(input: InputStream, bytes: ByteArray): Int {
    var offset = 0
    while (offset < bytes.size) {
        val count = input.read(bytes, offset, bytes.size - offset)
        if (count < 0) break
        if (count == 0) continue
        offset += count
    }
    return offset
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
