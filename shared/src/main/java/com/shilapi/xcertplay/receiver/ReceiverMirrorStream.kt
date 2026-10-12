package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.ScreenCodec
import com.shilapi.xcertplay.airplay.NtpClock
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.web.WebMediaSink
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
                           private val ended: () -> Unit) : Closeable {
    private val closed = AtomicBoolean(false)
    private val server = ServerSocket()
    @Volatile private var socket: Socket? = null
    private val cipher = aesCtr(
        AirPlayCrypto.sha512("AirPlayStreamKey${java.lang.Long.toUnsignedString(connectionId)}".toByteArray(), key).copyOf(16),
        AirPlayCrypto.sha512("AirPlayStreamIV${java.lang.Long.toUnsignedString(connectionId)}".toByteArray(), key).copyOf(16),
    )

    fun start(): Int {
        server.bind(InetSocketAddress(InetAddress.getByName("::"), 0))
        sink.setVideoClockHandler(110, clock::mediaTimeNanos)
        Thread(::run, "tiplay-airplay-mirror").apply { isDaemon = true; start() }
        return server.localPort
    }

    private fun run() {
        try {
            var accepted: Socket
            do {
                accepted = server.accept()
                if (accepted.inetAddress != peer) accepted.close()
            } while (accepted.inetAddress != peer && !closed.get())
            socket = accepted
            if (closed.get()) { accepted.close(); return }
            TcpLiveness.configure(accepted) {}
            accepted.tcpNoDelay = true
            val input = accepted.getInputStream()
            while (!closed.get()) {
                val header = ByteArray(128)
                if (!readPacket(input, header)) break
                val data = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
                val size = data.int
                require(size in 0..8 * 1024 * 1024)
                val body = ByteArray(size)
                if (!readPacket(input, body)) break
                when (header[4].toInt() and 0xff) {
                    0 -> {
                        val plain = cipher.update(body)
                        if (plain != null && plain.isNotEmpty()) sink.onVideoFrame(110,
                            ScreenCodec.lengthPrefixedToAnnexB(plain), ScreenCodec.senderNanos(header), System.nanoTime())
                    }
                    1 -> {
                        val width = data.getFloat(56).toInt()
                        val height = data.getFloat(60).toInt()
                        require(width in 16..8192 && height in 16..8192)
                        sink.updateCanvas(width, height)
                        sink.onScreenStreamActive(110, true)
                        val config = ScreenCodec.describeConfig(body)
                        require(config.codec == VideoCodec.H264) // no multi-codec capability advertised
                        sink.onVideoCodec(110, config.codec)
                        sink.onVideoConfig(110, config.record)
                    }
                }
            }
        } catch (_: Exception) {
            // Owner reports a generic end, without logging payloads or transport keys.
        } finally {
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
