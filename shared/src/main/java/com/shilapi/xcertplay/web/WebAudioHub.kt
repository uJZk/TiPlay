package com.shilapi.xcertplay.web

import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** PCM handoff only: the browser owns playback. Live producers never wait; music feeders apply backpressure. */
class WebAudioHub {
    /** A decoder's publication lease; retiring it cannot wait for buffered music capacity. */
    class Publication internal constructor(private val hub: WebAudioHub, internal val owner: Any) : Closeable {
        @Volatile internal var active = true
            private set
        override fun close() {
            synchronized(hub) {
                active = false
                hub.subscription?.discard(this)
            }
        }
    }

    internal fun publication(owner: Any) = Publication(this, owner)

    private var owner: Any? = null
    private var mirrorOwner: Any? = null
    private var sequence = 0
    private var voiceOwner: Any? = null
    private var voiceRevision = 0
    private var voiceState = "idle"
    private var voiceError: String? = null
    private val epochs = IntArray(AIRPLAY_MIRROR_STREAM + 1)
    private var subscription: Subscription? = null
    @Volatile var enabled = true
        set(value) = synchronized(this) {
            field = value
            if (!value) { subscription?.close(); subscription = null }
        }
    @Volatile var carPlayEnabled = true
        set(value) = synchronized(this) {
            if (field != value) {
                field = value
                owner?.let { current -> for (id in 0..4) flush(current, id) }
            }
        }

    @Synchronized fun begin(owner: Any) {
        this.owner = owner
        for (id in 0..4) flush(owner, id)
        if (voiceRevision != 0) subscription?.let(::routeRecord)
    }

    @Synchronized fun end(owner: Any) {
        if (this.owner !== owner) return
        for (id in 0..4) flush(owner, id)
        this.owner = null
        if (voiceRevision != 0) subscription?.let(::routeRecord)
    }

    /** Mirror sound mixes with CarPlay; it never replaces its audio owner or decoder leases. */
    @Synchronized fun beginMirror(owner: Any) {
        mirrorOwner = owner
        flush(owner, AIRPLAY_MIRROR_STREAM)
    }

    @Synchronized fun endMirror(owner: Any) {
        if (mirrorOwner !== owner) return
        flush(owner, AIRPLAY_MIRROR_STREAM)
        mirrorOwner = null
    }

    private fun owns(owner: Any, id: Int) = when (id) {
        in 0..4 -> this.owner === owner
        AIRPLAY_MIRROR_STREAM -> mirrorOwner === owner
        else -> false
    }

    fun publish(owner: Any, id: Int, sampleRate: Int, channels: Int, pcm: ByteArray,
                              buffered: Boolean = false, reset: Boolean = false,
                              presentationNanos: Long? = null,
                              mode: BrowserPlaybackMode = BrowserPlaybackMode.CARPLAY,
                              publication: Publication? = null) {
        if ((id !in 0..4 && id != AIRPLAY_MIRROR_STREAM) || channels !in 1..2 || sampleRate !in 8000..96000 ||
            (id == AIRPLAY_MIRROR_STREAM && mode != BrowserPlaybackMode.AIRPLAY_MIRROR) ||
            (pcm.isEmpty() && !reset) || pcm.size > MAX_PCM || pcm.size % (channels * 2) != 0) return
        val delivery = synchronized(this) {
            if (!enabled || !owns(owner, id)) return
            if (id in 0..4 && !carPlayEnabled && pcm.isNotEmpty()) return
            if (publication != null && (!publication.active || publication.owner !== owner)) return
            val target = subscription ?: return
            if (reset) epochs[id]++
            Delivery(target, sequence++, target.generation, target.streamGeneration(id), epochs[id])
        }
        val record = ByteBuffer.allocate(28 + pcm.size).order(ByteOrder.BIG_ENDIAN)
            .putInt(24 + pcm.size).put(2).put(id.toByte()).put(channels.toByte())
            .put(((if (buffered) 1 else 0) or (if (reset) 2 else 0) or mode.audioFlags).toByte())
            .putInt(sampleRate).putInt(delivery.sequence).putInt(delivery.epoch)
            .putDouble(presentationNanos?.div(1e6) ?: Double.NaN).put(pcm).array()
        delivery.target.offer(record, buffered, delivery.generation, delivery.streamGeneration, publication)
    }

    @Synchronized fun subscribe(): Subscription {
        subscription?.close()
        return Subscription().also { subscription = it; if (voiceRevision != 0) routeRecord(it) }
    }

    /** A separate route owner survives display/audio ownership changes until SCO is really released. */
    @Synchronized fun voiceRoute(owner: Any, state: String, held: Boolean, error: String? = null): Boolean {
        if (voiceOwner != null && voiceOwner !== owner) return false
        voiceOwner = owner.takeIf { held }
        voiceState = state; voiceError = error; voiceRevision++
        subscription?.let(::routeRecord)
        return true
    }

    @Synchronized fun voiceStatus(): Map<String, Any?> = mapOf(
        "source" to "bluetooth", "state" to voiceState, "muted" to false,
        "revision" to voiceRevision, "error" to voiceError)

    private fun routeRecord(target: Subscription) {
        val bytes = ByteBuffer.allocate(28).order(ByteOrder.BIG_ENDIAN)
            .putInt(24).put(2).put(5).put(1).put(0)
            .putInt(48000).putInt(sequence++).putInt(voiceRevision).putDouble(Double.NaN).array()
        target.offer(bytes, false, target.generation)
    }

    fun flush(owner: Any, id: Int) {
        synchronized(this) {
            if (!owns(owner, id)) return
            subscription?.clearStream(id)
            publish(owner, id, 48000, 2, ByteArray(0), reset = true,
                mode = if (id == AIRPLAY_MIRROR_STREAM) BrowserPlaybackMode.AIRPLAY_MIRROR else BrowserPlaybackMode.CARPLAY)
        }
    }

    class Subscription internal constructor() : Closeable {
        private data class Packet(val generation: Long, val streamGeneration: Long, val bytes: ByteArray, val publication: Publication?)
        private val routes = ArrayBlockingQueue<Packet>(1)
        // Empty reset controls have at most one entry per stream and cannot evict PCM.
        private val resets = linkedMapOf<Int, Packet>()
        private val live = ArrayBlockingQueue<Packet>(16)
        private val mirror = ArrayBlockingQueue<Packet>(16)
        private val music = ArrayBlockingQueue<Packet>(16)
        private val streamGenerations = LongArray(AIRPLAY_MIRROR_STREAM + 1)
        @Volatile internal var generation = 0L
            private set
        @Volatile var closed = false
            private set
        @Synchronized internal fun streamGeneration(id: Int) = streamGenerations[id]
        private fun current(packet: Packet) = !closed && packet.generation == generation &&
            packet.streamGeneration == streamGeneration(packet.bytes[5].toInt()) && packet.publication?.active != false
        internal fun offer(record: ByteArray, buffered: Boolean, generation: Long,
                           streamGeneration: Long = streamGeneration(record[5].toInt()), publication: Publication? = null) {
            val packet = Packet(generation, streamGeneration, record, publication)
            if (!current(packet)) return
            if (record[5].toInt() == 5) {
                synchronized(this) {
                    if (current(packet)) { routes.poll(); routes.offer(packet) }
                }
                return
            }
            if (record.size == 28 && record[7].toInt() and 2 != 0) {
                synchronized(this) {
                    if (current(packet)) resets[record[5].toInt()] = packet
                }
                return
            }
            if (buffered) {
                // Preserve ordered music. Waiting happens on the decoder feeder, outside the hub monitor.
                // A stalled HTTP writer is retired instead of corrupting the stream by dropping music.
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
                while (current(packet)) {
                    val remaining = deadline - System.nanoTime()
                    if (remaining <= 0L) {
                        synchronized(this) {
                            if (current(packet)) close()
                        }
                        return
                    }
                    // Queue bulk removals need not wake an offer, and other producers may still fill it.
                    // Recheck cancellation without interrupting caller-owned threads or extending the deadline.
                    if (music.offer(packet, minOf(remaining, 10_000_000L), TimeUnit.NANOSECONDS)) {
                        if (!current(packet)) music.remove(packet)
                        return
                    }
                }
                return
            }
            synchronized(this) {
                if (!current(packet)) return
                val realtime = if (record[5].toInt() == AIRPLAY_MIRROR_STREAM) mirror else live
                if (!realtime.offer(packet)) {
                    realtime.clear()
                    // A stalled reader gets fresh audio and resets its browser queue, never a stale backlog.
                    record[7] = (record[7].toInt() or 2).toByte()
                    realtime.offer(packet)
                }
            }
            if (!current(packet)) { live.remove(packet); mirror.remove(packet) }
        }
        fun take(timeoutMillis: Long): ByteArray? {
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
            while (!closed) {
                // Prompt/call packets take priority without ever dropping buffered music.
                val remaining = maxOf(0L, deadline - System.nanoTime())
                val packet = routes.poll() ?: takeReset() ?: live.poll() ?: mirror.poll() ?: music.poll(minOf(remaining, 10_000_000L), TimeUnit.NANOSECONDS)
                if (packet == null) { if (System.nanoTime() >= deadline) return null else continue }
                prepareDelivery(packet)?.let { return it }
            }
            return null
        }
        @Synchronized private fun prepareDelivery(packet: Packet): ByteArray? {
            if (!current(packet)) return null
            val id = packet.bytes[5].toInt()
            val reset = resets[id]
            if (packet.bytes.size > 28 && reset != null && reset.streamGeneration == packet.streamGeneration &&
                ByteBuffer.wrap(packet.bytes).getInt(16) - ByteBuffer.wrap(reset.bytes).getInt(16) >= 0) {
                // A new PCM packet can wake music.poll after its reset was queued. Deliver both
                // together so the pending empty reset cannot later erase that fresh browser audio.
                resets.remove(id)
                packet.bytes[7] = (packet.bytes[7].toInt() or 2).toByte()
            }
            return packet.bytes
        }
        @Synchronized private fun takeReset(): Packet? {
            val (id, packet) = resets.entries.firstOrNull() ?: return null
            resets.remove(id)
            return packet
        }
        @Synchronized internal fun clearStream(id: Int) {
            streamGenerations[id]++
            routes.removeIf { it.bytes[5].toInt() == id }
            resets.remove(id)
            live.removeIf { it.bytes[5].toInt() == id }
            mirror.removeIf { it.bytes[5].toInt() == id }
            music.removeIf { it.bytes[5].toInt() == id }
        }
        @Synchronized internal fun discard(publication: Publication) {
            resets.entries.removeIf { it.value.publication === publication }
            live.removeIf { it.publication === publication }
            mirror.removeIf { it.publication === publication }
            music.removeIf { it.publication === publication }
        }
        @Synchronized internal fun clear() { generation++; routes.clear(); resets.clear(); live.clear(); mirror.clear(); music.clear() }
        @Synchronized override fun close() { closed = true; clear() }
    }

    private data class Delivery(val target: Subscription, val sequence: Int, val generation: Long,
                                val streamGeneration: Long, val epoch: Int)

    companion object {
        const val MAX_PCM = 64 * 1024
        const val AIRPLAY_MIRROR_STREAM = 6
    }
}
