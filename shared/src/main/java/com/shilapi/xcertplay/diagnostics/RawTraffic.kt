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

    private var configuration = ""
    private var needsBoundaryCheck = true

    fun configure(destination: File, active: Boolean, configuration: String = "") = synchronized(lock) {
        val starting = active && !enabled
        if (!active && enabled) record("capture/stop", "disabled".toByteArray())
        if (file != destination || starting) needsBoundaryCheck = true
        file = destination
        enabled = active
        if (starting) {
            this.configuration = configuration
            startSession()
        }
    }

    private fun startSession() {
        val session = java.util.UUID.randomUUID().toString()
        record("capture/start", ("process=$process session=$session startEpochMillis=${System.currentTimeMillis()}\n" + configuration).toByteArray())
    }

    /** Explicit user action; saved artifacts are independent. An active capture starts a fresh session. */
    fun clear() = synchronized(lock) {
        val target = file
        check(target == null || !target.exists() || target.delete()) { "Could not clear raw capture" }
        failures = 0; lastFailure = "none"
        if (enabled) startSession()
    }

    fun record(channel: String, bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset) {
        if (!enabled || length <= 0) return
        synchronized(lock) {
            if (!enabled) return
            try {
                val target = file ?: return
                target.parentFile?.let { if (!it.isDirectory) check(it.mkdirs()) }
                // An interrupted append must not merge its partial line with the next session/record.
                if (needsBoundaryCheck) {
                    java.io.RandomAccessFile(target, "rw").use { tail ->
                        if (tail.length() > 0) {
                            tail.seek(tail.length() - 1)
                            if (tail.read() != 10) { tail.seek(tail.length()); tail.write(10) }
                        }
                    }
                    needsBoundaryCheck = false
                }
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
                needsBoundaryCheck = true
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

    internal class Snapshot(private val input: InputStream, val length: Long, val status: String) : java.io.Closeable {
        override fun close() = input.close()
        fun open(): InputStream {
            return object : InputStream() {
                private var remaining = length
                override fun read(): Int {
                    if (remaining == 0L) return -1
                    val value = input.read()
                    check(value >= 0) { "Raw capture snapshot ended early" }
                    remaining--; return value
                }
                override fun read(bytes: ByteArray, offset: Int, count: Int): Int {
                    if (count == 0) return 0
                    if (remaining == 0L) return -1
                    val read = input.read(bytes, offset, minOf(count.toLong(), remaining).toInt())
                    check(read > 0) { "Raw capture snapshot ended early" }
                    remaining -= read; return read
                }
                override fun close() = input.close()
            }
        }
    }

    private fun snapshot(): Snapshot = synchronized(lock) {
        val length = file?.length() ?: 0L
        Snapshot(if (length == 0L) java.io.ByteArrayInputStream(byteArrayOf()) else file!!.inputStream(), length, "RAW_CAPTURE failures=$failures lastFailure=$lastFailure enabled=$enabled format=tsv-base64 bytes=$length snapshotEpochMillis=${System.currentTimeMillis()}\n")
    }

    fun writeArchive(output: OutputStream, logName: String, report: String, temporaryRoot: File) =
        snapshot().use { RawTrafficArchive.write(output, logName, report, it, temporaryRoot) }
}
