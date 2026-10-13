package com.shilapi.xcertplay.web

import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** PCM handoff only: the browser owns playback. Live producers never wait; music feeders apply backpressure. */
class WebAudioHub {
    private var owner: Any? = null
    private var sequence = 0
    private var voiceOwner: Any? = null
    private var voiceRevision = 0
    private var voiceMuted = false
    private var voiceState = "idle"
    private var voiceError: String? = null
    private val epochs = IntArray(5)
    private var subscription: Subscription? = null
    @Volatile var enabled = true
        set(value) = synchronized(this) {
            field = value
            if (!value) { subscription?.close(); subscription = null }
        }

    @Synchronized fun begin(owner: Any) {
        this.owner = owner
        subscription?.clear()
        for (id in 0..4) flush(owner, id)
        if (voiceRevision != 0) subscription?.let(::routeRecord)
    }

    @Synchronized fun end(owner: Any) {
        if (this.owner !== owner) return
        subscription?.clear()
        for (id in 0..4) flush(owner, id)
        this.owner = null
        if (voiceRevision != 0) subscription?.let(::routeRecord)
    }

    fun publish(owner: Any, id: Int, sampleRate: Int, channels: Int, pcm: ByteArray,
                              buffered: Boolean = false, reset: Boolean = false,
                              presentationNanos: Long? = null,
                              mode: BrowserPlaybackMode = BrowserPlaybackMode.CARPLAY) {
        if (id !in 0..4 || channels !in 1..2 || sampleRate !in 8000..96000 ||
            (pcm.isEmpty() && !reset) || pcm.size > MAX_PCM || pcm.size % (channels * 2) != 0) return
        val delivery = synchronized(this) {
            if (!enabled || this.owner !== owner || (voiceMuted && pcm.isNotEmpty())) return
            val target = subscription ?: return
            if (reset) epochs[id]++
            Delivery(target, sequence++, target.generation, epochs[id])
        }
        val record = ByteBuffer.allocate(28 + pcm.size).order(ByteOrder.BIG_ENDIAN)
            .putInt(24 + pcm.size).put(2).put(id.toByte()).put(channels.toByte())
            .put(((if (buffered) 1 else 0) or (if (reset) 2 else 0) or mode.audioFlags).toByte())
            .putInt(sampleRate).putInt(delivery.sequence).putInt(delivery.epoch)
            .putDouble(presentationNanos?.div(1e6) ?: Double.NaN).put(pcm).array()
        delivery.target.offer(record, buffered, delivery.generation)
    }

    @Synchronized fun subscribe(): Subscription {
        subscription?.close()
        return Subscription().also { subscription = it; if (voiceRevision != 0) routeRecord(it) }
    }

    /** A separate route owner survives display/audio ownership changes until SCO is really released. */
    @Synchronized fun voiceRoute(owner: Any, state: String, muted: Boolean, error: String? = null): Boolean {
        if (voiceOwner != null && voiceOwner !== owner) return false
        voiceOwner = owner.takeIf { muted }
        voiceState = state; voiceError = error; voiceMuted = muted; voiceRevision++
        subscription?.clear()
        for (id in epochs.indices) epochs[id]++
        subscription?.let(::routeRecord)
        return true
    }

    @Synchronized fun voiceStatus(): Map<String, Any?> = mapOf(
        "source" to "bluetooth", "state" to voiceState, "muted" to voiceMuted,
        "revision" to voiceRevision, "error" to voiceError)

    private fun routeRecord(target: Subscription) {
        val bytes = ByteBuffer.allocate(28).order(ByteOrder.BIG_ENDIAN)
            .putInt(24).put(2).put(5).put(1).put((if (voiceMuted) 16 else 0).toByte())
            .putInt(48000).putInt(sequence++).putInt(voiceRevision).putDouble(Double.NaN).array()
        target.offer(bytes, false, target.generation)
    }

    fun flush(owner: Any, id: Int) {
        synchronized(this) {
            if (this.owner !== owner) return
            subscription?.clearStream(id)
            publish(owner, id, 48000, 2, ByteArray(0), reset = true)
        }
    }

    class Subscription internal constructor() : Closeable {
        private data class Packet(val generation: Long, val bytes: ByteArray)
        private val live = ArrayBlockingQueue<Packet>(16)
        private val music = ArrayBlockingQueue<Packet>(16)
        @Volatile internal var generation = 0L
            private set
        @Volatile var closed = false
            private set
        internal fun offer(record: ByteArray, buffered: Boolean, generation: Long) {
            if (closed || generation != this.generation) return
            val packet = Packet(generation, record)
            if (buffered) {
                // Preserve ordered music. Waiting happens on the decoder feeder, outside the hub monitor.
                // A stalled HTTP writer is retired instead of corrupting the stream by dropping music.
                if (!music.offer(packet, 1000, TimeUnit.MILLISECONDS) && generation == this.generation) close()
                return
            }
            if (!live.offer(packet)) {
                live.clear()
                // A stalled reader gets fresh audio and resets its browser queue, never a stale backlog.
                record[7] = (record[7].toInt() or 2).toByte()
                live.offer(packet)
            }
        }
        fun take(timeoutMillis: Long): ByteArray? {
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
            while (!closed) {
                // Prompt/call packets take priority without ever dropping buffered music.
                val remaining = maxOf(0L, deadline - System.nanoTime())
                val packet = live.poll() ?: music.poll(minOf(remaining, 10_000_000L), TimeUnit.NANOSECONDS)
                if (packet == null) { if (System.nanoTime() >= deadline) return null else continue }
                if (packet.generation == generation) return packet.bytes
            }
            return null
        }
        internal fun clearStream(id: Int) {
            live.removeIf { it.bytes[5].toInt() == id }
            music.removeIf { it.bytes[5].toInt() == id }
        }
        internal fun clear() { generation++; live.clear(); music.clear() }
        override fun close() { closed = true; clear() }
    }

    private data class Delivery(val target: Subscription, val sequence: Int, val generation: Long, val epoch: Int)

    companion object { const val MAX_PCM = 64 * 1024 }
}
