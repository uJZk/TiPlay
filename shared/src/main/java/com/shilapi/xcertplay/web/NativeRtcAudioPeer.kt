package com.shilapi.xcertplay.web

import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToLong

/** Independently negotiated receive-only browser media section. MID is never assumed numeric. */
internal data class BrowserRtcAudioSlot(val mid: String, val payloadType: Int)

internal interface BrowserRtcAudioBackend : Closeable {
    val slots: List<BrowserRtcAudioSlot>
    fun answer(offer: String): String
    /** Bounded asynchronous original-payload admission. Never blocks the fallback audio pump. */
    fun send(slot: String, payload: ByteArray, timestampUs: Double)
    fun ready(): Boolean
    fun snapshot(): Map<String, Any?>
}

/** A C-API-only media peer: no AudioRecord, MediaCodec, PCM bus or audio encoder. */
internal class NativeRtcAudioPeer(
    override val slots: List<BrowserRtcAudioSlot>,
    private val onFailure: (String) -> Unit,
    private val diagnostic: (String) -> Unit = {},
    private val nanoTime: () -> Long = System::nanoTime,
) : BrowserRtcAudioBackend {
    private val diagnosticId = nextDiagnosticId.incrementAndGet()
    private data class Packet(val slot: Int, val payload: ByteArray, val timestamp: Long, val admittedAt: Long)
    private val answering = AtomicBoolean()
    private val closed = AtomicBoolean()
    private val failed = AtomicBoolean()
    private val bytes = AtomicInteger()
    private val packets = ArrayBlockingQueue<Packet>(MAX_PACKETS)
    private val pointerLock = Any()
    private var handle = 0L
    @Volatile private var answered = false
    @Volatile private var lastDiagnostics = nativeAudioDiagnostics(IntArray(0))
    private val sender = Thread(::pump, "tiplay-native-audio").apply { isDaemon = true; start() }

    override fun answer(offer: String): String {
        check(AVAILABLE) { "audio-native-library-unavailable" }
        check(!closed.get()) { "audio-peer-closed" }
        val ptr = synchronized(pointerLock) {
            check(!closed.get() && handle == 0L) { "audio-peer-already-started" }
            answering.set(true)
            nativeCreate(slots.map { it.mid }.toTypedArray(), slots.map { it.payloadType }.toIntArray()).also {
                check(it != 0L) { "audio-native-peer-create" }; handle = it
            }
        }
        // Do not hold pointerLock while gathering: close() must cancel the native waiter.
        try {
            val answer = nativeAnswer(ptr, offer)
            check(!closed.get()) { "audio-peer-closed" }
            runCatching { diagnostic("stage=ice-candidates peer=$diagnosticId ${BrowserRtcAudioCandidates.describe(offer, answer)}") }
            answered = true
            return answer
        } catch (cause: Throwable) {
            val details = refreshDiagnostics()
            runCatching { diagnostic("stage=negotiation-failure peer=$diagnosticId exception=${cause.javaClass.simpleName} ${diagnosticFields(details)}") }
            throw cause
        } finally { refreshDiagnostics(); answering.set(false); deleteClosed() }
    }

    override fun send(slot: String, payload: ByteArray, timestampUs: Double) {
        check(!closed.get() && !failed.get()) { "audio-peer-unavailable" }
        val index = slots.indexOfFirst { it.mid == slot }
        require(index >= 0 && payload.isNotEmpty() && payload.size <= MAX_PACKET_BYTES && timestampUs.isFinite()
            && kotlin.math.abs(timestampUs) <= 9e15) { "invalid-audio-packet" }
        val held = bytes.addAndGet(payload.size)
        if (held > MAX_BYTES) { bytes.addAndGet(-payload.size); fail("audio-native-input-overflow"); error("audio-native-input-overflow") }
        val packet = Packet(index, payload, (timestampUs * .048).roundToLong() and 0xffff_ffffL, nanoTime())
        if (!packets.offer(packet)) {
            bytes.addAndGet(-payload.size); fail("audio-native-input-overflow"); error("audio-native-input-overflow")
        }
    }

    private fun pump() {
        var stage = "idle"
        var packetSlot = -1
        var admittedAt = 0L
        try {
            while (!closed.get() && !failed.get()) {
                val packet = packets.poll(100, TimeUnit.MILLISECONDS)
                if (packet == null) {
                    val lost = synchronized(pointerLock) { answered && handle != 0L && nativeFailed(handle) }
                    if (lost && !closed.get()) error("audio-native-peer-failed")
                    continue
                }
                try {
                    stage = "wait-track"; packetSlot = packet.slot; admittedAt = packet.admittedAt
                    while (!closed.get() && !failed.get()) {
                        val open = synchronized(pointerLock) {
                            handle != 0L && answered && !nativeFailed(handle) && nativeReady(handle, packet.slot)
                        }
                        if (open) break
                        if (nanoTime() - packet.admittedAt >= START_TIMEOUT_NANOS) error("audio-native-open-timeout")
                        Thread.sleep(5)
                    }
                    stage = "send"
                    if (!closed.get() && !failed.get()) synchronized(pointerLock) {
                        if (handle != 0L && !closed.get()) nativeSend(handle, packet.slot, packet.timestamp, packet.payload)
                    }
                    stage = "idle"; packetSlot = -1; admittedAt = 0L
                } finally { bytes.addAndGet(-packet.payload.size) }
            }
        } catch (_: InterruptedException) {
            if (!closed.get()) fail("audio-native-interrupted")
        } catch (error: Throwable) {
            if (!closed.get()) {
                val nativeState = runCatching { synchronized(pointerLock) {
                    if (handle == 0L) "unavailable" else if (nativeFailed(handle)) "failed" else "not-failed"
                } }.getOrDefault("unknown")
                val transportState = runCatching { synchronized(pointerLock) {
                    if (handle == 0L) "connection=unavailable ice=unavailable" else formatNativeAudioStates(nativeStates(handle))
                } }.getOrDefault("connection=unknown ice=unknown")
                val ageMs = if (admittedAt == 0L) -1L else (nanoTime() - admittedAt).coerceAtLeast(0) / 1_000_000
                val details = refreshDiagnostics()
                runCatching { diagnostic("stage=sender-failure peer=$diagnosticId operation=$stage exception=${error.javaClass.simpleName} nativeState=$nativeState $transportState answered=$answered slot=$packetSlot queuedPackets=${packets.size} queuedBytes=${bytes.get().coerceAtLeast(0)} packetAgeMs=$ageMs ${diagnosticFields(details)}") }
                fail(when (error.message) {
                "audio-native-open-timeout" -> "audio-native-open-timeout"
                "audio-native-peer-failed" -> "audio-native-peer-failed"
                else -> "audio-native-send-failed"
                })
            }
        }
        finally {
            packets.clear(); bytes.set(0)
            // Native deletion runs off its callback stack and after the gathering waiter exits.
            deleteClosed()
        }
    }

    private fun fail(reason: String) {
        if (failed.compareAndSet(false, true)) {
            refreshDiagnostics()
            try { onFailure(reason) } finally { close() }
        }
    }
    override fun ready(): Boolean = synchronized(pointerLock) {
        !closed.get() && !failed.get() && answered && handle != 0L && !nativeFailed(handle)
            && nativeAudioTransportConnected(nativeStates(handle))
    }
    override fun snapshot(): Map<String, Any?> = mapOf("backend" to "libdatachannel", "peer" to diagnosticId, "ready" to ready(),
        "queuedPackets" to packets.size, "queuedBytes" to bytes.get().coerceAtLeast(0), "tracks" to slots.size,
        "failed" to failed.get(), "transportDiagnostics" to refreshDiagnostics())

    private fun refreshDiagnostics(): Map<String, Any?> = synchronized(pointerLock) {
        if (!closed.get() && handle != 0L) runCatching { nativeAudioDiagnostics(nativeDiagnostics(handle)) }
            .getOrNull()?.let { lastDiagnostics = it }
        lastDiagnostics
    }

    private fun diagnosticFields(details: Map<String, Any?>): String =
        details.entries.joinToString(" ") { (key, value) -> "$key=$value" }

    override fun close() {
        synchronized(pointerLock) {
            if (closed.get()) return
            refreshDiagnostics()
            closed.set(true)
            if (handle != 0L) nativeCancel(handle)
        }
        sender.interrupt()
    }

    private fun deleteClosed() = synchronized(pointerLock) {
        if (closed.get() && !answering.get() && handle != 0L) {
            val ptr = handle; handle = 0; nativeDelete(ptr)
        }
    }

    companion object {
        private val nextDiagnosticId = java.util.concurrent.atomic.AtomicLong()
        private const val MAX_PACKETS = 1024
        private const val MAX_BYTES = 1024 * 1024
        private const val MAX_PACKET_BYTES = 65479
        private const val START_TIMEOUT_NANOS = 5_000_000_000L
        private val AVAILABLE = runCatching { System.loadLibrary("datachannel"); System.loadLibrary("tiplay_rtc_audio"); true }.getOrDefault(false)
        @JvmStatic private external fun nativeCreate(mids: Array<String>, payloadTypes: IntArray): Long
        @JvmStatic private external fun nativeAnswer(handle: Long, offer: String): String
        @JvmStatic private external fun nativeCancel(handle: Long)
        @JvmStatic private external fun nativeDelete(handle: Long)
        @JvmStatic private external fun nativeReady(handle: Long, slot: Int): Boolean
        @JvmStatic private external fun nativeFailed(handle: Long): Boolean
        @JvmStatic private external fun nativeStates(handle: Long): Long
        @JvmStatic private external fun nativeDiagnostics(handle: Long): IntArray
        @JvmStatic private external fun nativeSend(handle: Long, slot: Int, timestamp: Long, payload: ByteArray)
    }
}

/** Fixed JNI classifications only; no candidate address, port, credential or SDP can enter this map. */
internal fun nativeAudioDiagnostics(values: IntArray): Map<String, Any?> {
    if (values.size != 21) return mapOf("available" to false)
    fun state(index: Int, names: List<String>) = names.getOrNull(values[index]) ?: "unavailable"
    fun count(index: Int) = values[index].coerceIn(0, 65535)
    fun result(index: Int): Int? = values[index].takeUnless { it == Int.MIN_VALUE }
    val descriptions = listOf("unavailable", "offer", "answer", "pranswer", "rollback", "unknown")
    val candidateTypes = listOf("unknown", "host", "srflx", "prflx", "relay")
    val protocols = listOf("unknown", "udp", "tcp")
    val families = listOf("unknown", "ipv4", "ipv6", "mdns")
    val pairResult = values[12]
    return linkedMapOf(
        "available" to true,
        "connection" to state(0, listOf("new", "connecting", "connected", "disconnected", "failed", "closed")),
        "ice" to state(1, listOf("new", "checking", "connected", "completed", "failed", "disconnected", "closed")),
        "connectionChanges" to count(2), "iceChanges" to count(3),
        "gathering" to state(4, listOf("new", "gathering", "complete")),
        "signaling" to state(5, listOf("stable", "have-local-offer", "have-remote-offer", "have-local-pranswer", "have-remote-pranswer")),
        "gatheringChanges" to count(6), "signalingChanges" to count(7),
        "remoteDescriptionSetResult" to result(8), "localDescriptionSetResult" to result(9),
        "localDescriptionType" to state(10, descriptions), "remoteDescriptionType" to state(11, descriptions),
        "selectedPair" to when (pairResult) { 0 -> "selected"; -3 -> "not-selected"; else -> "error" },
        "selectedPairResult" to pairResult,
        "localCandidateType" to (candidateTypes.getOrNull(values[13]) ?: "unknown"),
        "localCandidateProtocol" to (protocols.getOrNull(values[14]) ?: "unknown"),
        "localCandidateFamily" to (families.getOrNull(values[15]) ?: "unknown"),
        "localCandidatePresent" to (values[16] == 1),
        "remoteCandidateType" to (candidateTypes.getOrNull(values[17]) ?: "unknown"),
        "remoteCandidateProtocol" to (protocols.getOrNull(values[18]) ?: "unknown"),
        "remoteCandidateFamily" to (families.getOrNull(values[19]) ?: "unknown"),
        "remoteCandidatePresent" to (values[20] == 1),
    )
}

internal fun nativeAudioTransportConnected(value: Long): Boolean = (value and 15L) == 3L &&
    ((value ushr 4) and 15L) in 3L..4L

internal fun formatNativeAudioStates(value: Long): String {
    val connections = listOf("new", "connecting", "connected", "disconnected", "failed", "closed")
    val iceStates = listOf("new", "checking", "connected", "completed", "failed", "disconnected", "closed")
    val connection = connections.getOrNull((value and 15).toInt() - 1) ?: "unavailable"
    val ice = iceStates.getOrNull(((value ushr 4) and 15).toInt() - 1) ?: "unavailable"
    return "connection=$connection ice=$ice connectionChanges=${(value ushr 8) and 65535} iceChanges=${(value ushr 24) and 65535}"
}
