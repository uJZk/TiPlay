package com.shilapi.xcertplay.web

import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** Browser-owned audio output. Encoded AirPlay/CarPlay and PCM compatibility streams keep independent browser epochs. */
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
    private class EncodedStream(val id: Int, val format: EncodedFormat, val mode: BrowserPlaybackMode,
                                val buffered: Boolean, val publication: Publication?)
    private val encodedStreams = arrayOfNulls<EncodedStream>(AIRPLAY_MIRROR_STREAM + 1)

    data class EncodedFormat(val codec: String, val sampleRate: Int, val channels: Int,
                             val bitDepth: Int, val samplesPerFrame: Int,
                             val asc: ByteArray = ByteArray(0), val cookie: ByteArray = ByteArray(0),
                             val littleEndian: Boolean = false) {
        init {
            require(codec in listOf("pcm", "aac-lc", "aac-eld", "alac", "opus"))
            require(sampleRate in 8000..96000 && channels in 1..2 && bitDepth in listOf(16, 24))
            require(samplesPerFrame in 1..4096 && asc.size <= 256 && cookie.size <= 256)
        }
        internal fun json(): ByteArray {
            fun bytes(value: ByteArray) = value.joinToString(",", "[", "]") { (it.toInt() and 255).toString() }
            return ("{\"codec\":\"$codec\",\"sampleRate\":$sampleRate,\"channels\":$channels," +
                "\"bitDepth\":$bitDepth,\"samplesPerFrame\":$samplesPerFrame," +
                "\"asc\":${bytes(asc)},\"cookie\":${bytes(cookie)},\"littleEndian\":$littleEndian}").toByteArray(Charsets.UTF_8)
        }
    }
    @Volatile var enabled = true
        set(value) = synchronized(this) {
            field = value
            if (!value) { subscription?.close(); subscription = null }
        }

    @Volatile var carPlayEnabled = true
        set(value) = synchronized(this) {
            if (field != value) {
                field = value
                owner?.let { current ->
                    for (id in 0..4) {
                        subscription?.clearStream(id)
                        val stream = encodedStreams[id]
                        if (stream == null) publish(current, id, 48000, 2, ByteArray(0), reset = true)
                        else {
                            epochs[id]++
                            subscription?.let { target ->
                                target.offer(encodedRecord(6, stream, epochs[id], endedJson(stream), true), false, target.generation)
                            }
                        }
                    }
                }
            }
        }

    @Synchronized fun begin(owner: Any) {
        this.owner = owner
        for (id in 0..4) { encodedStreams[id] = null; flush(owner, id) }
        if (voiceRevision != 0) subscription?.let(::routeRecord)
    }

    @Synchronized fun end(owner: Any) {
        if (this.owner !== owner) return
        for (id in 0..4) {
            if (encodedStreams[id] != null) retireEncoded(requireNotNull(encodedStreams[id]))
            else flush(owner, id)
        }
        this.owner = null
        if (voiceRevision != 0) subscription?.let(::routeRecord)
    }

    /** Ordinary AirPlay has its own audio producer, independent of CarPlay media and guidance. */
    @Synchronized fun beginMirror(owner: Any) {
        mirrorOwner = owner
        encodedStreams[AIRPLAY_MIRROR_STREAM] = null
        flush(owner, AIRPLAY_MIRROR_STREAM)
    }

    @Synchronized fun endMirror(owner: Any) {
        if (mirrorOwner !== owner) return
        if (encodedStreams[AIRPLAY_MIRROR_STREAM] != null) retireEncoded(requireNotNull(encodedStreams[AIRPLAY_MIRROR_STREAM]))
        else flush(owner, AIRPLAY_MIRROR_STREAM)
        mirrorOwner = null
    }

    private fun owns(owner: Any, id: Int) = when (id) {
        in 0..4 -> this.owner === owner
        AIRPLAY_MIRROR_STREAM -> mirrorOwner === owner
        else -> false
    }

    private fun audioStream(id: Int) = id in 0..4 || id == AIRPLAY_MIRROR_STREAM

    fun publish(owner: Any, id: Int, sampleRate: Int, channels: Int, pcm: ByteArray,
                              buffered: Boolean = false, reset: Boolean = false,
                              presentationNanos: Long? = null,
                              mode: BrowserPlaybackMode = BrowserPlaybackMode.CARPLAY,
                              publication: Publication? = null) {
        if (!audioStream(id) || (id == AIRPLAY_MIRROR_STREAM && mode != BrowserPlaybackMode.AIRPLAY_MIRROR) || channels !in 1..2 || sampleRate !in 8000..96000 ||
            (pcm.isEmpty() && !reset) || pcm.size > MAX_PCM || pcm.size % (channels * 2) != 0) return
        val delivery = synchronized(this) {
            if (!enabled || !owns(owner, id)) return
            if (id in 0..4 && !carPlayEnabled && pcm.isNotEmpty()) return
            if (publication != null && (!publication.active || publication.owner !== owner)) return
            val target = subscription ?: return
            if (reset) epochs[id]++
            Delivery(target, sequence++, target.generation, epochs[id], target.streamVersion(id))
        }
        val record = ByteBuffer.allocate(28 + pcm.size).order(ByteOrder.BIG_ENDIAN)
            .putInt(24 + pcm.size).put(2).put(id.toByte()).put(channels.toByte())
            .put(((if (buffered) 1 else 0) or (if (reset) 2 else 0) or mode.audioFlags).toByte())
            .putInt(sampleRate).putInt(delivery.sequence).putInt(delivery.epoch)
            .putDouble(presentationNanos?.div(1e6) ?: Double.NaN).put(pcm).array()
        delivery.target.offer(record, buffered, delivery.generation, publication, delivery.streamVersion)
    }

    fun subscribe(): Subscription {
        val target: Subscription
        val streams: List<EncodedStream>
        synchronized(this) {
            subscription?.close()
            target = Subscription()
            subscription = target
            if (voiceRevision != 0) routeRecord(target)
            streams = encodedStreams.filterNotNull()
        }
        for (stream in streams) emitEncoded(stream, null, null, null, target)
        return target
    }

    /** Register the dedicated ordinary AirPlay stream without replacing CarPlay audio. */
    fun beginEncoded(owner: Any, format: EncodedFormat) {
        synchronized(this) { beginMirror(owner) }
        beginEncodedStream(owner, AIRPLAY_MIRROR_STREAM, format, BrowserPlaybackMode.AIRPLAY_MIRROR)
    }

    fun beginEncodedStream(owner: Any, id: Int, format: EncodedFormat,
                           mode: BrowserPlaybackMode = BrowserPlaybackMode.CARPLAY,
                           publication: Publication? = null, buffered: Boolean = false) {
        if (!audioStream(id) || (id == AIRPLAY_MIRROR_STREAM && mode != BrowserPlaybackMode.AIRPLAY_MIRROR)) return
        val stream: EncodedStream
        synchronized(this) {
            if (!owns(owner, id) || !validPublication(owner, publication)) return
            subscription?.clearStream(id)
            epochs[id]++
            stream = EncodedStream(id, format.copy(asc = format.asc.copyOf(), cookie = format.cookie.copyOf()),
                mode, buffered, publication)
            encodedStreams[id] = stream
        }
        emitEncoded(stream, null, null, null)
    }

    fun publishEncoded(owner: Any, payload: ByteArray, decodeTimestampUs: Double,
                       presentationNanos: Long? = null, id: Int = 0, buffered: Boolean = false,
                       publication: Publication? = null) {
        if (!audioStream(id) || payload.isEmpty() || payload.size > MAX_PCM || !decodeTimestampUs.isFinite()) return
        val stream = synchronized(this) {
            if (!owns(owner, id) || !validPublication(owner, publication)) return
            encodedStreams[id]?.takeIf { it.publication === publication } ?: return
        }
        // Registration defines the transport policy: callers cannot accidentally prioritize music.
        if (buffered != stream.buffered) return
        emitEncoded(stream, payload, decodeTimestampUs, presentationNanos)
    }

    fun flushEncoded(owner: Any, id: Int = 0, publication: Publication? = null) {
        if (!audioStream(id)) return
        val stream = synchronized(this) {
            if (!owns(owner, id) || !validPublication(owner, publication)) return
            val current = encodedStreams[id]?.takeIf { it.publication === publication } ?: return
            epochs[id]++
            subscription?.clearStream(id)
            current
        }
        emitEncoded(stream, null, null, null)
    }

    @Synchronized fun endEncodedStream(owner: Any, id: Int, publication: Publication? = null) {
        if (!audioStream(id) || !owns(owner, id) || !validPublication(owner, publication)) return
        val stream = encodedStreams[id]?.takeIf { it.publication === publication } ?: return
        retireEncoded(stream)
    }

    private fun retireEncoded(stream: EncodedStream) {
        val id = stream.id
        encodedStreams[id] = null
        epochs[id]++
        subscription?.let { target ->
            target.clearStream(id)
            target.offer(encodedRecord(6, stream, epochs[id], endedJson(stream), true), false, target.generation)
        }
    }

    private fun validPublication(owner: Any, publication: Publication?) =
        publication == null || (publication.active && publication.owner === owner)

    private fun endedJson(stream: EncodedStream): ByteArray =
        (String(stream.format.json(), Charsets.UTF_8).dropLast(1) + ",\"ended\":true}").toByteArray(Charsets.UTF_8)

    /** Serializes a stream, while music capacity waits never hold the hub/route monitor. */
    private fun emitEncoded(stream: EncodedStream, payload: ByteArray?, timestamp: Double?,
                            presentationNanos: Long?, expectedTarget: Subscription? = null) {
        synchronized(stream) {
            val delivery: Delivery
            val records: List<ByteArray>
            synchronized(this) {
                if (!enabled || (stream.id in 0..4 && !carPlayEnabled) || encodedStreams[stream.id] !== stream ||
                    stream.publication?.active == false) return
                val target = subscription ?: return
                if (expectedTarget != null && target !== expectedTarget) return
                val state = target.prepareEncoded(stream.id, epochs[stream.id], stream.buffered,
                    if (payload == null) 0 else 1)
                if (state.reset) epochs[stream.id]++
                val epoch = epochs[stream.id]
                records = buildList {
                    if (state.configuration || state.reset) {
                        add(encodedRecord(6, stream, epoch, stream.format.json(), true))
                    }
                    if (payload != null) {
                        val packet = ByteBuffer.allocate(8 + payload.size).order(ByteOrder.BIG_ENDIAN)
                            .putDouble(requireNotNull(timestamp)).put(payload).array()
                        add(encodedRecord(7, stream, epoch, packet, state.reset, presentationNanos))
                    }
                }
                delivery = Delivery(target, 0, target.generation, epoch, target.streamVersion(stream.id))
                target.encodedConfiguration(stream.id, epoch)
                if (!stream.buffered) {
                    target.offerLiveBatch(records, delivery.generation, delivery.streamVersion, stream.publication)
                    return
                }
            }
            for (record in records) delivery.target.offer(record, true, delivery.generation,
                stream.publication, delivery.streamVersion)
        }
    }

    private fun encodedRecord(type: Int, stream: EncodedStream, epoch: Int, payload: ByteArray,
                              reset: Boolean, presentationNanos: Long? = null): ByteArray =
        ByteBuffer.allocate(28 + payload.size).order(ByteOrder.BIG_ENDIAN)
            .putInt(24 + payload.size).put(type.toByte()).put(stream.id.toByte()).put(stream.format.channels.toByte())
            .put((stream.mode.audioFlags or (if (stream.buffered) 1 else 0) or (if (reset) 2 else 0)).toByte())
            .putInt(stream.format.sampleRate).putInt(sequence++).putInt(epoch)
            .putDouble(presentationNanos?.div(1e6) ?: Double.NaN).put(payload).array()

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
            if (encodedStreams[id] != null) {
                // Encoded callers use flushEncoded so configuration remains their decoder contract.
                return
            }
            subscription?.clearStream(id)
            publish(owner, id, 48000, 2, ByteArray(0), reset = true,
                mode = if (id == AIRPLAY_MIRROR_STREAM) BrowserPlaybackMode.AIRPLAY_MIRROR else BrowserPlaybackMode.CARPLAY)
        }
    }

    class Subscription internal constructor() : Closeable {
        private data class Packet(val generation: Long, val version: Long, val bytes: ByteArray,
                                  val publication: Publication?)
        private val routes = ArrayBlockingQueue<Packet>(1)
        // Route, reset and codec controls cannot evict another stream's queued audio.
        private val resets = linkedMapOf<Int, Packet>()
        private val deferred = ArrayBlockingQueue<Packet>(1)
        private val live = ArrayBlockingQueue<Packet>(16)
        private val mirror = ArrayBlockingQueue<Packet>(16)
        private val music = ArrayBlockingQueue<Packet>(16)
        @Volatile internal var generation = 0L
            private set
        @Volatile var closed = false
            private set
        private val versions = LongArray(AIRPLAY_MIRROR_STREAM + 1)
        private val encodedEpochs = arrayOfNulls<Int>(AIRPLAY_MIRROR_STREAM + 1)
        private val pendingReset = BooleanArray(AIRPLAY_MIRROR_STREAM + 1)
        internal data class EncodedState(val configuration: Boolean, val reset: Boolean)
        @Synchronized internal fun streamVersion(id: Int): Long = versions[id]
        @Synchronized internal fun encodedConfiguration(id: Int, epoch: Int) {
            if (!closed) { encodedEpochs[id] = epoch; pendingReset[id] = false }
        }
        @Synchronized internal fun prepareEncoded(id: Int, epoch: Int, buffered: Boolean,
                                                   packets: Int): EncodedState {
            var configuration = encodedEpochs[id] != epoch
            var reset = pendingReset[id]
            if (!buffered && realtime(id).remainingCapacity() < packets) {
                discardLive(realtime(id))
                configuration = true
                reset = true
            }
            return EncodedState(configuration, reset)
        }
        // Live overrun cannot touch ordered music. Every affected encoded stream restores its codec.
        private fun realtime(id: Int) = if (id == AIRPLAY_MIRROR_STREAM) mirror else live
        private fun discardLive(queue: ArrayBlockingQueue<Packet>) {
            for (packet in queue) {
                val id = packet.bytes[5].toInt()
                if ((id in 0..4 || id == AIRPLAY_MIRROR_STREAM) && (packet.bytes[4].toInt() == 6 || packet.bytes[4].toInt() == 7)) {
                    encodedEpochs[id] = null
                    pendingReset[id] = true
                }
            }
            queue.clear()
        }
        @Synchronized internal fun offerLiveBatch(records: List<ByteArray>, generation: Long,
                                                  version: Long, publication: Publication?) {
            for (bytes in records) {
                if (!valid(generation, version, bytes[5].toInt(), publication)) return
                val packet = Packet(generation, version, bytes, publication)
                if (bytes[4].toInt() == 6) resets[bytes[5].toInt()] = packet
                else check(realtime(bytes[5].toInt()).offer(packet))
            }
        }
        @Synchronized private fun valid(generation: Long, version: Long, id: Int,
                                         publication: Publication?) = !closed && generation == this.generation &&
            version == versions[id] && publication?.active != false

        internal fun offer(record: ByteArray, buffered: Boolean, generation: Long,
                           publication: Publication? = null, version: Long = streamVersion(record[5].toInt())) {
            val id = record[5].toInt()
            if (!valid(generation, version, id, publication)) return
            val packet = Packet(generation, version, record, publication)
            if (id == 5) {
                synchronized(this) {
                    if (valid(generation, version, id, publication)) { routes.poll(); routes.offer(packet) }
                }
                return
            }
            if (record[4].toInt() == 6 || (record.size == 28 && record[7].toInt() and 2 != 0)) {
                synchronized(this) {
                    if (valid(generation, version, id, publication)) resets[id] = packet
                }
                return
            }
            if (buffered) {
                // Waiting stays outside the hub monitor; retirement releases every producer promptly.
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
                while (valid(generation, version, id, publication)) {
                    val remaining = deadline - System.nanoTime()
                    if (remaining <= 0L) {
                        synchronized(this) { if (valid(generation, version, id, publication)) close() }
                        return
                    }
                    if (music.offer(packet, minOf(remaining, 10_000_000L), TimeUnit.NANOSECONDS)) {
                        if (!valid(generation, version, id, publication)) music.remove(packet)
                        return
                    }
                }
                return
            }
            synchronized(this) {
                if (!valid(generation, version, id, publication)) return
                val queue = realtime(id)
                if (!queue.offer(packet)) {
                    discardLive(queue)
                    record[7] = (record[7].toInt() or 2).toByte()
                    queue.offer(packet)
                }
            }
            if (!valid(generation, version, id, publication)) realtime(id).remove(packet)
        }
        fun take(timeoutMillis: Long): ByteArray? {
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
            while (!closed) {
                val remaining = maxOf(0L, deadline - System.nanoTime())
                val packet = routes.poll() ?: takeReset() ?: deferred.poll() ?: live.poll() ?: mirror.poll() ?: music.poll(minOf(remaining, 10_000_000L), TimeUnit.NANOSECONDS)
                if (packet == null) { if (System.nanoTime() >= deadline) return null else continue }
                prepareDelivery(packet)?.let { return it }
            }
            return null
        }
        @Synchronized private fun prepareDelivery(packet: Packet): ByteArray? {
            if (!valid(packet.generation, packet.version, packet.bytes[5].toInt(), packet.publication)) return null
            val id = packet.bytes[5].toInt()
            val reset = resets[id]
            if (packet.bytes.size > 28 && reset != null && reset.version == packet.version &&
                ByteBuffer.wrap(packet.bytes).getInt(16) - ByteBuffer.wrap(reset.bytes).getInt(16) >= 0) {
                resets.remove(id)
                if (reset.bytes[4].toInt() == 6) {
                    // A buffered packet can wake music.poll after its codec control was queued.
                    // Deliver the configuration first, retaining this packet for the next take.
                    check(deferred.offer(packet))
                    return reset.bytes
                }
                // A new PCM packet can likewise overtake an empty reset; merge its reset flag
                // so a delayed control cannot erase the fresh browser audio afterward.
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
            versions[id]++
            routes.removeIf { it.bytes[5].toInt() == id }
            resets.remove(id)
            deferred.removeIf { it.bytes[5].toInt() == id }
            if (id in 0..4 || id == AIRPLAY_MIRROR_STREAM) { encodedEpochs[id] = null; pendingReset[id] = false }
            live.removeIf { it.bytes[5].toInt() == id }
            mirror.removeIf { it.bytes[5].toInt() == id }
            music.removeIf { it.bytes[5].toInt() == id }
        }
        @Synchronized internal fun discard(publication: Publication) {
            resets.entries.removeIf { it.value.publication === publication }
            deferred.removeIf { it.publication === publication }
            live.removeIf { it.publication === publication }
            mirror.removeIf { it.publication === publication }
            music.removeIf { it.publication === publication }
        }
        @Synchronized internal fun clear() {
            generation++; routes.clear(); resets.clear(); deferred.clear(); live.clear(); mirror.clear(); music.clear(); encodedEpochs.fill(null); pendingReset.fill(false)
            for (id in versions.indices) versions[id]++
        }
        @Synchronized override fun close() { closed = true; clear() }
    }

    private data class Delivery(val target: Subscription, val sequence: Int, val generation: Long, val epoch: Int, val streamVersion: Long)

    companion object {
        const val MAX_PCM = 64 * 1024
        const val AIRPLAY_MIRROR_STREAM = 6
    }
}
