package com.shilapi.xcertplay.diagnostics

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.Base64
import java.net.DatagramPacket
import java.net.DatagramSocket

/** Opt-in, lossless application I/O capture. No sampling, redaction, queue or rotation.
 * Writes apply disk backpressure. Android/kernel Bluetooth and USB bus packets are outside this API.
 * Each tab-separated record is timestamp, sequence, channel, byte count, Base64 bytes.
 */
object RawTraffic {
    @Volatile var enabled = false
        private set
    private val lock = Any()
    private var file: File? = null
    private val process = java.util.UUID.randomUUID().toString()
    private var sequence = 0L
    private var failures = 0L
    private var lastFailure = "none"

    fun configure(destination: File, active: Boolean) = synchronized(lock) {
        val starting = active && !enabled
        if (!active && enabled) record("capture/stop", "disabled".toByteArray())
        file = destination
        enabled = active
        if (starting) record("capture/start", "process=$process enabled".toByteArray())
    }

    fun record(channel: String, bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset) {
        if (!enabled || length <= 0) return
        synchronized(lock) {
            if (!enabled) return
            try {
                val target = file ?: return
                target.parentFile?.let { if (!it.isDirectory) check(it.mkdirs()) }
                java.io.FileOutputStream(target, true).bufferedWriter().use { writer ->
                    var position = offset
                    val end = offset + length
                    while (position < end) {
                        val count = minOf(48 * 1024, end - position)
                        val encoded = Base64.getEncoder().encodeToString(bytes.copyOfRange(position, position + count))
                        writer.append("${System.currentTimeMillis()}\t${++sequence}\t$channel\t$count\t$encoded\n")
                        position += count
                    }
                }
            } catch (error: Exception) {
                failures++; lastFailure = error.javaClass.simpleName
            }
        }
    }

    fun input(channel: String, source: InputStream): InputStream = object : InputStream() {
        override fun read(): Int = source.read().also { if (it >= 0) record(channel, byteArrayOf(it.toByte())) }
        override fun read(bytes: ByteArray, offset: Int, length: Int): Int =
            source.read(bytes, offset, length).also { if (it > 0) record(channel, bytes, offset, it) }
        override fun close() = source.close()
        override fun available(): Int = source.available()
    }
    fun output(channel: String, destination: OutputStream): OutputStream = object : OutputStream() {
        override fun write(value: Int) { destination.write(value); record(channel, byteArrayOf(value.toByte())) }
        override fun write(bytes: ByteArray, offset: Int, length: Int) {
            record("$channel/attempt", bytes, offset, length)
            destination.write(bytes, offset, length)
            record("$channel/written", bytes, offset, length)
        }
        override fun flush() = destination.flush()
        override fun close() = destination.close()
    }
    fun receive(socket: DatagramSocket, packet: DatagramPacket) {
        socket.receive(packet)
        if (enabled) record("iphone/udp/${socket.localPort}/${packet.socketAddress}/in", packet.data, packet.offset, packet.length)
    }

    /** Append an immutable-length snapshot without loading media into the report String. */
    fun appendTo(output: OutputStream) {
        val snapshot = synchronized(lock) { Triple(file, file?.length() ?: 0L,
            "RAW_CAPTURE failures=$failures lastFailure=$lastFailure enabled=$enabled format=tsv-base64 bytes=${file?.length() ?: 0L}\n") }
        val target = snapshot.first ?: return
        if (snapshot.second == 0L && !enabled && failures == 0L) return
        output.write("\n--- Raw traffic ---\n".toByteArray())
        output.write(snapshot.third.toByteArray())
        if (snapshot.second == 0L) return
        target.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            var remaining = snapshot.second
            while (remaining > 0) {
                val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                check(count > 0) { "Raw capture snapshot ended early" }
                output.write(buffer, 0, count); remaining -= count
            }
        }
    }
}
