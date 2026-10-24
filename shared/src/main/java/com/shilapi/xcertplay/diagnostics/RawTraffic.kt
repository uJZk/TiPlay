package com.shilapi.xcertplay.diagnostics

import java.io.BufferedOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.Base64
import java.nio.ByteBuffer
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
    @Volatile private var failures = 0L
    @Volatile private var lastFailure = "none"
    private var lastFailureText = ""
    private var firstFailureEpochMillis = 0L
    private var lastFailureEpochMillis = 0L
    private var failedByteAttempts = 0L
    private var lastFailureChannel = "none"
    private var writer: BufferedOutputStream? = null
    private val base64 = Base64.getEncoder()
    @Volatile private var timing = RawCaptureTiming()
    private val channelOffsets = mutableMapOf<String, Long>()
    @Volatile private var referenceIntegrity = true
    private val videoReferenceLock = Any()
    private val videoReferences = java.util.WeakHashMap<ByteArray, Reference>()

    /** IDs address the single canonical input journal; payloads are not stored in downstream events. */
    data class Reference(val session: String, val channel: String, val firstSequence: Long,
                         val lastSequence: Long, val offset: Long, val length: Int) {
        fun fields(): Map<String, Any?> = mapOf("captureSession" to session, "captureChannel" to channel,
            "captureFirstRecord" to firstSequence, "captureLastRecord" to lastSequence,
            "captureOffset" to offset, "captureLength" to length,
            "captureBoundary" to "source-tcp-header-and-body",
            "captureTransform" to "decrypt-then-length-prefix-to-annexb")
    }

    fun bindVideoReference(payload: ByteArray, reference: Reference?) {
        if (!enabled || reference == null) return
        synchronized(videoReferenceLock) { if (enabled && reference.session == sessionId) videoReferences[payload] = reference }
    }

    fun videoReference(payload: ByteArray): Reference? {
        if (!enabled) return null
        return synchronized(videoReferenceLock) { videoReferences[payload]?.takeIf { it.session == sessionId } }
    }

    /** Status reads never wait for capture disk I/O or hold a media/control lock behind it. */
    fun integrity(): Map<String, Any?> {
        val count = failures
        return mapOf("enabled" to enabled, "failures" to count, "lastFailure" to lastFailure,
            "complete" to (count == 0L), "referenceIntegrity" to referenceIntegrity,
            "coverage" to if (count == 0L) "no-observed-write-failure" else "partial",
            "durability" to "application-flush-no-fsync", "timing" to timing.snapshot())
    }

    private var configuration = ""
    @Volatile private var sessionId: String? = null
    private var pendingSessionHeader: ByteArray? = null
    private var needsBoundaryCheck = true

    fun configure(destination: File, active: Boolean, configuration: String = "") = synchronized(lock) {
        val changed = file != destination
        val starting = active && (!enabled || changed)
        if (!active && enabled) record("capture/stop", "disabled".toByteArray())
        if (changed || !active) closeWriter()
        if (changed || starting) needsBoundaryCheck = true
        file = destination
        enabled = active
        if (starting) {
            this.configuration = configuration
            startSession()
        }
    }

    private fun startSession() {
        timing = RawCaptureTiming()
        val session = java.util.UUID.randomUUID().toString()
        sessionId = session
        channelOffsets.clear()
        referenceIntegrity = true
        synchronized(videoReferenceLock) { videoReferences.clear() }
        pendingSessionHeader = ("process=$process session=$session startEpochMillis=${System.currentTimeMillis()}\n" + configuration).toByteArray()
        record("capture/start", requireNotNull(pendingSessionHeader))
    }

    /** Binds browser reports to this enable/clear cycle, including delayed control retries. */
    fun activeSessionId(): String? = sessionId.takeIf { enabled }

    /** Explicit user action; saved artifacts are independent. An active capture starts a fresh session. */
    fun clear() = synchronized(lock) {
        closeWriter()
        val target = file
        check(target == null || !target.exists() || target.delete()) { "Could not clear raw capture" }
        failures = 0; lastFailure = "none"
        lastFailureText = ""; firstFailureEpochMillis = 0; lastFailureEpochMillis = 0
        failedByteAttempts = 0; lastFailureChannel = "none"; needsBoundaryCheck = true
        timing = RawCaptureTiming()
        if (enabled) startSession()
    }

    fun record(channel: String, bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset) {
        recordReferenced(channel, bytes, offset, length)
    }

    /** Session validation and append share the clear/enable monitor: delayed reports cannot enter a new capture. */
    fun recordForSession(expectedSession: String, channel: String, bytes: ByteArray): Boolean {
        if (!enabled || bytes.isEmpty()) return false
        val requestedAt = System.nanoTime()
        return synchronized(lock) {
            if (!enabled || sessionId != expectedSession) return@synchronized false
            val previousSequence = sequence
            val previousFailures = failures
            recordReferenced(channel, bytes, 0, bytes.size, requestedAt)
            // A previous loss may disable exact byte references while later records still append successfully.
            sequence != previousSequence && failures == previousFailures
        }
    }

    private fun recordReferenced(channel: String, bytes: ByteArray, offset: Int, length: Int,
                                 requestedAtNanos: Long = 0L): Reference? {
        if (!enabled || length <= 0) return null
        val requestedAt = if (requestedAtNanos == 0L) System.nanoTime() else requestedAtNanos
        synchronized(lock) {
            if (!enabled) return null
            val acquiredAt = System.nanoTime()
            if (channel != "capture/start") {
                pendingSessionHeader?.let { record("capture/start", it) }
                if (pendingSessionHeader != null) {
                    failure(java.io.IOException("Capture session marker unavailable"), channel, length.toLong())
                    return null
                }
            }
            // Session recovery may have appended its header; references start at this payload only.
            val firstSequence = sequence + 1
            val channelOffset = channelOffsets.getOrDefault(channel, 0L)
            val appendAt = System.nanoTime()
            try {
                val target = file ?: return null
                target.parentFile?.let {
                    if (!it.isDirectory && !it.mkdirs()) throw java.io.IOException("Could not create capture directory")
                }
                // A removed/replaced journal must not silently keep accepting bytes into an orphaned descriptor.
                if (writer != null && !target.isFile) {
                    closeWriter()
                    throw java.io.IOException("Capture journal unavailable")
                }
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
                val output = writer ?: java.io.FileOutputStream(target, true).buffered(64 * 1024).also { writer = it }
                var position = offset
                val end = offset + length
                while (position < end) {
                    val count = minOf(48 * 1024, end - position)
                    output.write("${System.currentTimeMillis()}\t${++sequence}\t$channel\t$count\t".toByteArray(Charsets.UTF_8))
                    // The JDK bulk encoder reads this exact range without a source
                    // copy and emits ASCII directly. Avoid a payload-sized String,
                    // interpolated line and UTF-16/UTF-8 encoding in the capture lock.
                    val encoded = base64.encode(ByteBuffer.wrap(bytes, position, count))
                    output.write(encoded.array(), encoded.arrayOffset() + encoded.position(), encoded.remaining())
                    output.write(10)
                    position += count
                }
                // No payload queue: every call flushes before returning, applying disk backpressure.
                // This is application I/O completion, not an fsync/power-loss durability guarantee.
                output.flush()
                if (channel == "capture/start") pendingSessionHeader = null
                channelOffsets[channel] = channelOffset + length
                return if (referenceIntegrity) Reference(requireNotNull(sessionId), channel, firstSequence, sequence, channelOffset, length) else null
            } catch (error: Exception) {
                needsBoundaryCheck = true
                closeWriter()
                failure(error, channel, length.toLong())
                return null
            } finally {
                // Includes encoding, filesystem work and flush, including failed appends.
                // The separately measured wait also covers recordForSession's outer monitor.
                timing.completed(channel, acquiredAt - requestedAt, System.nanoTime() - appendAt)
            }
        }
    }

    private fun closeWriter() {
        val current = writer ?: return
        writer = null
        try { current.close() } catch (error: Exception) { failure(error, "capture/close", 0) }
    }

    private fun failure(error: Exception, channel: String, bytes: Long) {
        val time = System.currentTimeMillis()
        if (firstFailureEpochMillis == 0L) firstFailureEpochMillis = time
        lastFailureEpochMillis = time
        failures++
        lastFailure = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64).ifEmpty { "OTHER" }
        lastFailureText = DiagnosticErrorText.sanitize(runCatching { error.message }.getOrNull())
        // Retain the source category, never a URL, peer address or arbitrary channel suffix.
        lastFailureChannel = RawCaptureTiming.sourceCategory(channel)
        failedByteAttempts += bytes
        // A partial append makes subsequent channel offsets uncertain. Keep capturing, but
        // stop claiming exact byte references until the next explicit capture session.
        referenceIntegrity = false
    }

    /** A bounded accumulator for one screen message, referencing existing source bytes only. */
    class ReferencedInput internal constructor(private val channel: String, private val source: InputStream) : InputStream() {
        private var range: Reference? = null
        private var incomplete = false
        fun beginRange() { range = null; incomplete = false }
        fun endRange(): Reference? = range.takeUnless { incomplete }
        private fun captured(bytes: ByteArray, offset: Int, length: Int) {
            val next = recordReferenced(channel, bytes, offset, length)
            if (next == null) { incomplete = true; return }
            val previous = range
            if (previous == null) range = next
            else if (previous.session == next.session && previous.offset + previous.length == next.offset) {
                range = previous.copy(lastSequence = next.lastSequence, length = previous.length + next.length)
            } else incomplete = true
        }
        override fun read(): Int = source.read().also { if (it >= 0) captured(byteArrayOf(it.toByte()), 0, 1) }
        override fun read(bytes: ByteArray, offset: Int, length: Int): Int =
            source.read(bytes, offset, length).also { if (it > 0) captured(bytes, offset, it) }
        override fun close() = source.close()
        override fun available(): Int = source.available()
    }

    fun referencedInput(channel: String, source: InputStream) = ReferencedInput(channel, source)

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
        Snapshot(if (length == 0L) java.io.ByteArrayInputStream(byteArrayOf()) else file!!.inputStream(), length,
            "RAW_CAPTURE failures=$failures lastFailure=$lastFailure enabled=$enabled format=tsv-base64 bytes=$length snapshotEpochMillis=${System.currentTimeMillis()}\n" +
                "RAW_CAPTURE_INTEGRITY coverage=${if (failures == 0L) "no-observed-write-failure" else "partial"} " +
                "firstFailureEpochMillis=$firstFailureEpochMillis lastFailureEpochMillis=$lastFailureEpochMillis " +
                "failedByteAttempts=$failedByteAttempts lastFailureSource=$lastFailureChannel " +
                "lastFailureText=$lastFailureText referenceIntegrity=$referenceIntegrity durability=application-flush\n" +
                "RAW_CAPTURE_TIMING " + timing.snapshot().entries.joinToString(" ") { "${it.key}=${it.value}" } + "\n")
    }

    fun writeArchive(output: OutputStream, logName: String, report: String, temporaryRoot: File) =
        snapshot().use { RawTrafficArchive.write(output, logName, report, it, temporaryRoot) }

}
