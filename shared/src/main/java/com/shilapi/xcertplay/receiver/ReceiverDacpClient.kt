package com.shilapi.xcertplay.receiver

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.TimeUnit

/**
 * DACP commands go only to the current RTSP peer and its separately discovered port.
 * Shairport Sync b991d913 dacp.c uses /ctrl-int/1/ and Active-Remote. Playing time
 * uses DACP's millisecond property; success acknowledges delivery, not new media state.
 */
internal class ReceiverDacpClient(
    private val peer: InetAddress,
    private val port: Int,
    private val activeRemote: String,
    private val timeoutMillis: Int = 1000,
) : Closeable {
    private val lock = Any()
    private var closed = false
    private val sockets = mutableSetOf<Socket>()

    init {
        require(port in 1..65535 && timeoutMillis in 1..2000)
        require(!peer.isAnyLocalAddress && !peer.isMulticastAddress)
        require(validActiveRemote(activeRemote))
    }

    /** Fixed actions cannot supply a URL, hostname, arbitrary path or authentication header. */
    fun command(action: String, positionMillis: Long? = null, stillCurrent: () -> Boolean = { true }): Boolean {
        val command = when (action) {
            "next" -> if (positionMillis == null) "nextitem" else return false
            "previous" -> if (positionMillis == null) "previtem" else return false
            "seek" -> positionMillis?.takeIf { it in 0..0xffff_ffffL }
                ?.let { "setproperty?dacp.playingtime=$it" } ?: return false
            else -> return false
        }
        if (!stillCurrent()) return false
        val socket = Socket()
        synchronized(lock) {
            if (closed) { socket.close(); return false }
            sockets.add(socket)
        }
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis.toLong())
        return try {
            socket.connect(InetSocketAddress(peer, port), timeoutMillis)
            if (!stillCurrent()) return false
            val address = peer.hostAddress ?: return false
            val host = if (address.contains(':')) "[$address]:$port" else "$address:$port"
            val request = "GET /ctrl-int/1/$command HTTP/1.1\r\nHost: $host\r\n" +
                "Active-Remote: $activeRemote\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
            socket.getOutputStream().write(request.toByteArray(Charsets.US_ASCII))
            socket.getOutputStream().flush()
            val input = socket.getInputStream()
            val header = ByteArrayOutputStream()
            var ending = 0
            while (ending != 0x0d0a0d0a) {
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0 || !stillCurrent()) return false
                socket.soTimeout = TimeUnit.NANOSECONDS.toMillis(remaining).coerceAtLeast(1).toInt()
                val byte = input.read()
                if (byte < 0 || header.size() >= MAX_HEADER_BYTES) return false
                header.write(byte)
                ending = (ending shl 8) or byte
            }
            val lines = header.toString(Charsets.ISO_8859_1.name()).removeSuffix("\r\n\r\n").split("\r\n")
            if (lines.any { line -> line.any { it.code < 32 && it != '\t' || it.code == 127 } }) return false
            val status = Regex("HTTP/1\\.[01] ([0-9]{3})(?: [^\\r\\n]*)?").matchEntire(lines.firstOrNull().orEmpty())
                ?.groupValues?.get(1)?.toIntOrNull() ?: return false
            if (lines.drop(1).any { line ->
                    val colon = line.indexOf(':')
                    colon <= 0 || !line.substring(0, colon).matches(Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+"))
                }) return false
            status in 200..299 && stillCurrent()
        } catch (_: Exception) {
            false
        } finally {
            runCatching { socket.close() }
            synchronized(lock) { sockets.remove(socket) }
        }
    }

    /** Closing a retired owner also unblocks a response read; no successor inherits its token. */
    override fun close() {
        val active = synchronized(lock) {
            if (closed) return
            closed = true
            sockets.toList().also { sockets.clear() }
        }
        active.forEach { runCatching { it.close() } }
    }

    companion object {
        private const val MAX_HEADER_BYTES = 8192
        fun validActiveRemote(value: String): Boolean = value.matches(Regex("[0-9]{1,10}")) &&
            value.toLongOrNull()?.let { it in 0..0xffff_ffffL } == true
    }
}
