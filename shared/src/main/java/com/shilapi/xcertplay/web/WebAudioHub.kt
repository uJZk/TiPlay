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
    private var subscription: Subscription? = null
    private var microphoneHandler: ((ByteArray) -> Unit)? = null
    private var microphoneRate = 0
    @Volatile var enabled = true
        set(value) = synchronized(this) {
            field = value
            if (!value) { subscription?.close(); subscription = null; microphoneHandler = null; microphoneRate = 0 }
        }

    @Synchronized fun begin(owner: Any) {
        this.owner = owner
        subscription?.clear()
        for (id in 0..4) flush(owner, id)
        microphoneHandler = null
        microphoneRate = 0
    }

    @Synchronized fun end(owner: Any) {
        if (this.owner !== owner) return
        subscription?.clear()
        for (id in 0..4) flush(owner, id)
        this.owner = null
        microphoneHandler = null
        microphoneRate = 0
    }

    fun publish(owner: Any, id: Int, sampleRate: Int, channels: Int, pcm: ByteArray,
                              buffered: Boolean = false, reset: Boolean = false) {
        if (id !in 0..4 || channels !in 1..2 || sampleRate !in 8000..96000 ||
            (pcm.isEmpty() && !reset) || pcm.size > MAX_PCM || pcm.size % (channels * 2) != 0) return
        val (target, nextSequence, generation) = synchronized(this) {
            if (!enabled || this.owner !== owner) return
            val target = subscription ?: return
            Triple(target, sequence++, target.generation)
        }
        val record = ByteBuffer.allocate(20 + pcm.size).order(ByteOrder.BIG_ENDIAN)
            .putInt(16 + pcm.size).put(1).put(id.toByte()).put(channels.toByte())
            .put(((if (buffered) 1 else 0) or (if (reset) 2 else 0)).toByte())
            .putInt(sampleRate).putInt(nextSequence).putInt(0).put(pcm).array()
        target.offer(record, buffered, generation)
    }

    @Synchronized fun subscribe(): Subscription {
        subscription?.close()
        return Subscription().also { subscription = it }
    }

    @Synchronized fun microphone(owner: Any, sampleRate: Int, handler: ((ByteArray) -> Unit)?) {
        if (this.owner !== owner) return
        microphoneHandler = handler.takeIf { enabled && sampleRate in 8000..48000 }
        microphoneRate = if (microphoneHandler == null) 0 else sampleRate
    }

    @Synchronized fun microphoneStatus(): Map<String, Any?> =
        mapOf("active" to (enabled && microphoneHandler != null), "sampleRate" to microphoneRate)

    fun flush(owner: Any, id: Int) {
        synchronized(this) {
            if (this.owner !== owner) return
            subscription?.clearStream(id)
            publish(owner, id, 48000, 2, ByteArray(0), reset = true)
        }
    }

    /** A bounded batch of mono PCM uploads. No Android capture or playback device is accessed. */
    fun acceptMicrophone(pcm: ByteArray): Boolean {
        val handler = synchronized(this) {
            val handler = microphoneHandler?.takeIf { enabled } ?: return false
            if (pcm.isEmpty() || pcm.size % 2 != 0 || pcm.size > microphoneRate * 2 / 10) return false
            handler
        }
        handler(pcm)
        return true
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

    companion object { const val MAX_PCM = 64 * 1024 }
}
