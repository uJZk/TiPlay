package com.shilapi.xcertplay.diagnostics

import com.github.luben.zstd.ZstdOutputStreamNoFinalizer
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
    internal const val COMPRESSION_LEVEL = 3
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
    private var writer: OutputStream? = null
    private val base64 = Base64.getEncoder()
    @Volatile private var timing = RawCaptureTiming()
    private val channelOffsets = mutableMapOf<String, Long>()
    @Volatile private var referenceIntegrity = true
    @Volatile private var metadataSession: MetadataCaptureSession? = null
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
        if (!enabled || reference == null || metadataSession?.referenceIntegrity?.get() == false) return
        synchronized(videoReferenceLock) { if (enabled && reference.session == sessionId) videoReferences[payload] = reference }
    }

    fun videoReference(payload: ByteArray): Reference? {
        if (!enabled || !referenceIntegrity || metadataSession?.referenceIntegrity?.get() == false) return null
        return synchronized(videoReferenceLock) { videoReferences[payload]?.takeIf { it.session == sessionId } }
    }

    /** Status reads never wait for capture disk I/O or hold a media/control lock behind it. */
    fun integrity(): Map<String, Any?> {
        val metadata = metadataSession
        val count = failures + (metadata?.failureCount() ?: 0)
        val metadataState = metadata?.snapshot()
        val complete = count == 0L && (metadataState?.get("pending") as? Int ?: 0) == 0
        return mapOf("enabled" to enabled, "failures" to count,
            "lastFailure" to if (failures == 0L && count > 0) "AsyncMetadataLoss" else lastFailure,
            "complete" to complete, "referenceIntegrity" to (referenceIntegrity && metadata?.referenceIntegrity?.get() != false),
            "coverage" to if (complete) "no-observed-write-failure" else "partial",
            "asyncMetadata" to metadataState, "durability" to "application-flush-no-fsync", "timing" to timing.snapshot())
    }

    @Volatile var startedAtMillis = 0L
        private set
    @Volatile var compressedBytes = 0L
        private set
    private var compressed = false
    private var configuration = ""
    @Volatile private var ingressOnly = false
    @Volatile private var sessionId: String? = null
    private var pendingSessionHeader: ByteArray? = null
    private var needsBoundaryCheck = true

    fun configure(destination: File, active: Boolean, configuration: String = "", ingressOnly: Boolean = false, compressed: Boolean = false) = synchronized(lock) {
        this.ingressOnly = ingressOnly
        val changed = file != destination || this.compressed != compressed
        val starting = active && (!enabled || changed)
        if ((changed || !active) && enabled) {
            metadataSession?.retire()
            record("capture/stop", "${if (active) "reconfigured" else "disabled"} ${metadataSession?.summary().orEmpty()}".toByteArray())
        }
        if (changed || !active) closeWriter()
        if (changed || starting) needsBoundaryCheck = true
        file = destination
        this.compressed = compressed
        compressedBytes = destination.length()
        enabled = active
        if (starting) {
            this.configuration = configuration
            startSession()
        }
    }

    private fun startSession() {
        timing = RawCaptureTiming()
        startedAtMillis = System.currentTimeMillis()
        val session = java.util.UUID.randomUUID().toString()
        sessionId = session
        metadataSession = MetadataCaptureSession(session)
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
        metadataSession?.retire()
        closeWriter()
        val target = file
        check(target == null || !target.exists() || target.delete()) { "Could not clear raw capture" }
        if (compressed) target?.parentFile?.listFiles()?.filter {
            it.isFile && ((it.name.startsWith("raw-traffic-") && it.name.endsWith(".tsv.zst")) || it.name == "raw-traffic.tsv")
        }?.forEach { check(it.delete()) { "Could not clear retained capture" } }
        compressedBytes = 0
        failures = 0; lastFailure = "none"
        lastFailureText = ""; firstFailureEpochMillis = 0; lastFailureEpochMillis = 0
        failedByteAttempts = 0; lastFailureChannel = "none"; needsBoundaryCheck = true
        timing = RawCaptureTiming()
        metadataSession = null
        if (enabled) startSession()
    }

    fun record(channel: String, bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset) {
        recordReferenced(channel, bytes, offset, length)
    }

    /** Nonblocking admission for metadata-only platform callbacks. Rejection is explicit integrity loss. */
    fun recordMetadataAsync(channel: String, bytes: ByteArray, observedAtMillis: Long = System.currentTimeMillis()): Boolean {
        val session = activeSessionId() ?: return false
        return recordMetadataForSessionAsync(session, channel, bytes, observedAtMillis)
    }

    fun recordMetadataForSessionAsync(expectedSession: String, channel: String, bytes: ByteArray,
                                      observedAtMillis: Long = System.currentTimeMillis()): Boolean {
        if (!enabled || bytes.isEmpty()) return false
        val state = metadataSession?.takeIf { it.id == expectedSession } ?: return false
        return state.enqueue(channel, bytes, observedAtMillis)
    }

    /** Background export may spend a small budget draining; never call while holding a journal lock. */
    fun awaitMetadataIdle(timeoutMillis: Long): Boolean = metadataSession?.awaitIdle(timeoutMillis) ?: true

    internal fun writeMetadata(entry: MetadataCaptureSession.Entry) = synchronized(lock) {
        if (!entry.isPending) return@synchronized
        if (!enabled || metadataSession !== entry.session || sessionId != entry.session.id) {
            entry.finish(false)
            return@synchronized
        }
        val before = failures
        val previousSequence = sequence
        recordReferenced(entry.channel, entry.bytes, 0, entry.bytes.size, observedAtMillis = entry.observedAtMillis)
        entry.finish(sequence != previousSequence && failures == before)
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
                                 requestedAtNanos: Long = 0L, observedAtMillis: Long? = null): Reference? {
        if (!enabled || length <= 0) return null
        // Keep canonical ingress plus lifecycle/diagnostic metadata. Outgoing media and
        // Android playback PCM duplicate input and are not part of the requested capture.
        if (ingressOnly && (channel.startsWith("android-audio/") ||
                channel.endsWith("/out") || channel.endsWith("/out/written") || channel.endsWith("/out/attempt"))) return null
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
                if (needsBoundaryCheck && !compressed) {
                    java.io.RandomAccessFile(target, "rw").use { tail ->
                        if (tail.length() > 0) {
                            tail.seek(tail.length() - 1)
                            if (tail.read() != 10) { tail.seek(tail.length()); tail.write(10) }
                        }
                    }
                    needsBoundaryCheck = false
                }
                val output = writer ?: run {
                    val disk = java.io.FileOutputStream(target, true).buffered(64 * 1024)
                    try {
                        if (compressed) ZstdOutputStreamNoFinalizer(disk, COMPRESSION_LEVEL).setCloseFrameOnFlush(true)
                        else disk
                    } catch (error: Throwable) { disk.close(); throw error }
                }.also { writer = it }
                var position = offset
                val end = offset + length
                while (position < end) {
                    val count = minOf(48 * 1024, end - position)
                    output.write("${observedAtMillis ?: System.currentTimeMillis()}\t${++sequence}\t$channel\t$count\t".toByteArray(Charsets.UTF_8))
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
                compressedBytes = target.length()
                if (channel == "capture/start") pendingSessionHeader = null
                channelOffsets[channel] = channelOffset + length
                return if (referenceIntegrity && metadataSession?.referenceIntegrity?.get() != false) Reference(requireNotNull(sessionId), channel, firstSequence, sequence, channelOffset, length) else null
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

    internal class Snapshot(private val input: InputStream, val length: Long, val status: String, val compressed: Boolean = false, val name: String = "raw-traffic.tsv.zst") : java.io.Closeable {
        private var opened = false
        override fun close() = input.close()
        /** Rewind the owned descriptor, including an unlinked journal; never reopen its pathname. */
        @Synchronized fun open(): InputStream {
            when (input) {
                is java.io.FileInputStream -> input.channel.position(0)
                is java.io.ByteArrayInputStream -> input.reset()
                else -> check(!opened) { "Snapshot stream cannot be replayed" }
            }
            opened = true
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
                // Snapshot owns the descriptor across CRC and ZIP passes.
                override fun close() = Unit
            }
        }
    }

    private fun snapshot(target: File? = file): Snapshot = synchronized(lock) {
        val length = target?.length() ?: 0L
        val async = metadataSession
        val totalFailures = failures + (async?.failureCount() ?: 0)
        Snapshot(if (length == 0L) java.io.ByteArrayInputStream(byteArrayOf()) else target!!.inputStream(), length,
            "RAW_CAPTURE failures=$totalFailures lastFailure=$lastFailure enabled=$enabled format=${if (compressed) "zstd-tsv-base64-v1" else "tsv-base64"} bytes=$length snapshotEpochMillis=${System.currentTimeMillis()}\n" +
                "RAW_CAPTURE_INTEGRITY coverage=${if (integrity()["complete"] == true) "no-observed-write-failure" else "partial"} " +
                "firstFailureEpochMillis=$firstFailureEpochMillis lastFailureEpochMillis=$lastFailureEpochMillis " +
                "failedByteAttempts=$failedByteAttempts lastFailureSource=$lastFailureChannel " +
                "lastFailureText=$lastFailureText referenceIntegrity=${referenceIntegrity && async?.referenceIntegrity?.get() != false} durability=application-flush\n" +
                "RAW_ASYNC_METADATA ${async?.summary().orEmpty()}\n" +
                "RAW_CAPTURE_TIMING " + timing.snapshot().entries.joinToString(" ") { "${it.key}=${it.value}" } + "\n", compressed, target?.name ?: "raw-traffic.tsv.zst")
    }

    class ArchiveSnapshot internal constructor(private val compressedExport: Boolean, private val snapshots: List<Snapshot>) : java.io.Closeable {
        val payloadBytes: Long get() = snapshots.sumOf { it.length }
        fun write(output: OutputStream, logName: String, report: String, temporaryRoot: File,
                  attachments: Map<String, File> = emptyMap()) {
            if (compressedExport) CompressedTrafficArchive.write(output, logName, report, snapshots, temporaryRoot, attachments)
            else snapshots.firstOrNull()?.let { RawTrafficArchive.write(output, logName, report, it, temporaryRoot, attachments) }
        }
        override fun close() { snapshots.forEach { runCatching { it.close() } } }
    }

    fun archiveSnapshot(): ArchiveSnapshot {
        val (compressedExport, snapshots) = synchronized(lock) {
            val selected = if (!compressed) listOf(snapshot()) else {
                val retained = file?.parentFile?.listFiles()?.filter {
                    it.isFile && it.name.startsWith("raw-traffic-") && it.name.endsWith(".tsv.zst")
                }?.sortedBy { it.name }.orEmpty()
                val opened = mutableListOf<Snapshot>()
                try {
                    (retained + listOfNotNull(file?.takeIf { it.isFile })).distinct().forEach { opened.add(snapshot(it)) }
                    opened
                } catch (error: Throwable) { opened.forEach { it.close() }; throw error }
            }
            compressed to selected
        }
        return ArchiveSnapshot(compressedExport, snapshots)
    }

    fun writeArchive(output: OutputStream, logName: String, report: String, temporaryRoot: File,
                     attachments: Map<String, File> = emptyMap()) {
        archiveSnapshot().use { it.write(output, logName, report, temporaryRoot, attachments) }
    }
}
