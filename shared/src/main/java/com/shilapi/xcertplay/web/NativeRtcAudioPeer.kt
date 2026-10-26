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
    private val nanoTime: () -> Long = System::nanoTime,
) : BrowserRtcAudioBackend {
    private data class Packet(val slot: Int, val payload: ByteArray, val timestamp: Long, val admittedAt: Long)
    private val answering = AtomicBoolean()
    private val closed = AtomicBoolean()
    private val failed = AtomicBoolean()
    private val bytes = AtomicInteger()
    private val packets = ArrayBlockingQueue<Packet>(MAX_PACKETS)
    private val pointerLock = Any()
    private var handle = 0L
    @Volatile private var answered = false
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
            answered = true
            return answer
        } finally { answering.set(false); deleteClosed() }
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
        try {
            while (!closed.get() && !failed.get()) {
                val packet = packets.poll(100, TimeUnit.MILLISECONDS)
                if (packet == null) {
                    val lost = synchronized(pointerLock) { answered && handle != 0L && nativeFailed(handle) }
                    if (lost && !closed.get()) error("audio-native-peer-failed")
                    continue
                }
                try {
                    while (!closed.get() && !failed.get()) {
                        val open = synchronized(pointerLock) {
                            handle != 0L && answered && !nativeFailed(handle) && nativeReady(handle, packet.slot)
                        }
                        if (open) break
                        if (nanoTime() - packet.admittedAt >= START_TIMEOUT_NANOS) error("audio-native-open-timeout")
                        Thread.sleep(5)
                    }
                    if (!closed.get() && !failed.get()) synchronized(pointerLock) {
                        if (handle != 0L && !closed.get()) nativeSend(handle, packet.slot, packet.timestamp, packet.payload)
                    }
                } finally { bytes.addAndGet(-packet.payload.size) }
            }
        } catch (_: InterruptedException) {
            if (!closed.get()) fail("audio-native-interrupted")
        } catch (_: Throwable) { if (!closed.get()) fail("audio-native-send-failed") }
        finally {
            packets.clear(); bytes.set(0)
            // Native deletion runs off its callback stack and after the gathering waiter exits.
            deleteClosed()
        }
    }

    private fun fail(reason: String) { if (failed.compareAndSet(false, true)) { try { onFailure(reason) } finally { close() } } }
    override fun ready(): Boolean = synchronized(pointerLock) {
        !closed.get() && !failed.get() && answered && handle != 0L && !nativeFailed(handle)
    }
    override fun snapshot(): Map<String, Any?> = mapOf("backend" to "libdatachannel", "ready" to ready(),
        "queuedPackets" to packets.size, "queuedBytes" to bytes.get().coerceAtLeast(0), "tracks" to slots.size,
        "failed" to failed.get())

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        synchronized(pointerLock) { if (handle != 0L) nativeCancel(handle) }
        sender.interrupt()
    }

    private fun deleteClosed() = synchronized(pointerLock) {
        if (closed.get() && !answering.get() && handle != 0L) {
            val ptr = handle; handle = 0; nativeDelete(ptr)
        }
    }

    companion object {
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
        @JvmStatic private external fun nativeSend(handle: Long, slot: Int, timestamp: Long, payload: ByteArray)
    }
}
