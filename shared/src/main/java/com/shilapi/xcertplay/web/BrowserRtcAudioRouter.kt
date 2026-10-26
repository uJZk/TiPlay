package com.shilapi.xcertplay.web

import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Source-codec routing only: unsupported formats retain their original encoded records. */
internal class BrowserRtcAudioRouter(
    private val onFailure: (String) -> Unit,
    private val peerFactory: (List<BrowserRtcAudioSlot>, (String) -> Unit) -> BrowserRtcAudioBackend = { slots, failed -> NativeRtcAudioPeer(slots, failed) },
    private val captureNative: (ByteArray, () -> Unit) -> Unit = { _, submit -> submit() },
    private val nanoTime: () -> Long = System::nanoTime,
) : Closeable {
    private data class Key(val type: Int, val mode: Int, val epoch: Int)
    private class Owner(val key: Key, val config: ByteArray, val fields: Map<String, Any?>) {
        var slot: String? = null
        var generation = 0
        var receiverReady = false
        var ended: ByteArray? = null
        val packets = ArrayDeque<ByteArray>()
        var bytes = 0
        var since = 0L
    }
    private val lock = Any()
    private val owners = linkedMapOf<Key, Owner>()
    private val active = mutableMapOf<Int, Key>()
    private val latestNative = mutableMapOf<Pair<Int, Int>, Int>()
    private val metadata = ArrayDeque<ByteArray>()
    private var peer: BrowserRtcAudioBackend? = null
    private var pendingPeer: BrowserRtcAudioBackend? = null
    private val suppressedNativeTypes = mutableSetOf<Int>()
    private var generation = 0
    private var negotiating = false
    private var slots = emptyList<BrowserRtcAudioSlot>()
    private var assigned = 0
    private var stagedBytes = 0
    private var stagedPackets = 0
    private var closed = false
    private var failure: String? = null
    private val watchdog = Executors.newSingleThreadScheduledExecutor { run -> Thread(run, "tiplay-audio-route-watch").apply { isDaemon = true } }
    init { watchdog.scheduleWithFixedDelay({ checkWaiting() }, 250, 250, TimeUnit.MILLISECONDS) }

    /** No routing lock is held during SDP/network gathering; fallback records keep flowing. */
    fun answer(offer: String, nextGeneration: Int): String {
        val offered = parseOffer(offer)
        val previous: List<BrowserRtcAudioBackend>
        synchronized(lock) {
            check(!closed && nextGeneration > generation && nextGeneration > 0) { "stale-audio-generation" }
            previous = listOfNotNull(peer, pendingPeer); peer = null; pendingPeer = null
            generation = nextGeneration; negotiating = true; failure = null; slots = offered; assigned = 0
            metadata.clear()
            // Completed slots never revive on a replacement peer. Active owners retain only
            // packets admitted after the replacement starts; already-sent RTP is never replayed.
            val retained = owners.values.filter { active[it.key.type] == it.key && it.ended == null || it.packets.isNotEmpty() }
            owners.clear(); retained.forEach { owner -> owner.slot = null; owner.generation = 0; owner.receiverReady = false; owners[owner.key] = owner }
        }
        previous.forEach { it.close() }
        val next = try { peerFactory(offered) { reason -> fail(nextGeneration, reason) } }
            catch (cause: Throwable) { fail(nextGeneration, "audio-native-create-failed"); throw cause }
        try {
            synchronized(lock) {
                check(!closed && generation == nextGeneration && negotiating && failure == null) { "stale-audio-generation" }
                pendingPeer = next
            }
            val response = next.answer(offer)
            require(response.toByteArray(Charsets.UTF_8).size <= MAX_SDP_BYTES) { "audio-answer-too-large" }
            synchronized(lock) {
                check(!closed && generation == nextGeneration && negotiating && pendingPeer === next) { "stale-audio-generation" }
                peer = next; pendingPeer = null; negotiating = false
                for (owner in owners.values) bind(owner, emit = true)
            }
            return response
        } catch (cause: Throwable) {
            next.close(); synchronized(lock) { if (pendingPeer === next) pendingPeer = null }; fail(nextGeneration, "audio-native-negotiation-failed")
            throw cause
        }
    }

    /** Returns metadata/fallback record, or null when the original payload is owned by RTP. */
    fun route(record: ByteArray): ByteArray? {
        if (record.size < 28) return routeUncaptured(record)
        val kind = record[4].toInt() and 255
        val type = record[5].toInt() and 255
        require(kind != 6 || record.size <= 28 + 4096) { "audio-config-too-large" }
        val mode = record[7].toInt() and 12
        val epoch = ByteBuffer.wrap(record).getInt(16)
        val native = if (kind == 6) {
            val fields = WebJson.parse(String(record, 28, record.size - 28, Charsets.UTF_8)) as? Map<*, *>
            supportedConfig(fields, record) || fields?.get("ended") == true && synchronized(lock) {
                active[type]?.let(owners::get)?.let { it.key.mode == mode && epoch - it.key.epoch >= 0 } == true ||
                    latestNative[type to mode]?.let { epoch - it <= 0 } == true
            }
        } else kind == 7 && synchronized(lock) { latestNative[type to mode]?.let { epoch - it <= 0 } == true || type in suppressedNativeTypes }
        if (!native) return routeUncaptured(record)
        var result: ByteArray? = null
        captureNative(record) { result = routeUncaptured(record) }
        return result
    }
    private fun routeUncaptured(record: ByteArray): ByteArray? {
        if (record.size < 28) return record
        val wire = ByteBuffer.wrap(record).order(ByteOrder.BIG_ENDIAN)
        require(wire.getInt(0) == record.size - 4) { "invalid-audio-record-size" }
        val kind = record[4].toInt() and 255
        if (kind != 6 && kind != 7) return record
        val type = record[5].toInt() and 255
        val key = Key(type, record[7].toInt() and 12, wire.getInt(16))
        if (kind == 6) {
            @Suppress("UNCHECKED_CAST")
            val fields = WebJson.parse(String(record, 28, record.size - 28, Charsets.UTF_8)) as? Map<String, Any?>
                ?: error("invalid-audio-configuration")
            synchronized(lock) {
                if (closed) return record
                val existing = owners[key]
                if (fields["ended"] == true) {
                    // The hub advances the wire epoch when retiring a stream. Keep that
                    // tombstone, but identify the native slot by its original owner epoch.
                    val ending = existing ?: active[type]?.let(owners::get)?.takeIf {
                        it.key.mode == key.mode && key.epoch - it.key.epoch >= 0
                    }
                    if (ending == null) return if (supportedConfig(fields, record)) null else record
                    ending.ended = record
                    latestNative[type to key.mode] = key.epoch
                    if (active[type] == ending.key) active.remove(type)
                    return if (ending.slot != null) annotate(record, fields, ending) else null
                }
                if (!supportedConfig(fields, record)) {
                    active.remove(type)?.let(owners::get)?.let(::discardPending)
                    suppressedNativeTypes.remove(type); latestNative.remove(type to key.mode)
                    return record
                }
                val current = active[type]?.let(owners::get)
                if (current != null && current.key.mode == key.mode && ((key.epoch - current.key.epoch) < 0)) return null
                // A slot is a once-only owner binding, including an ended owner. Late
                // configuration cannot reactivate that slot in the same generation.
                if (existing != null) {
                    if (existing.ended != null) return null
                    if (listOf("codec", "sampleRate", "channels", "semanticType").any { existing.fields[it] != fields[it] }) {
                        failLocked("audio-format-changed-without-epoch"); return null
                    }
                    return if (existing.slot != null) annotate(record, fields, existing) else null
                }
                val latest = latestNative[type to key.mode]
                if (latest != null && key.epoch - latest <= 0) return null
                owners.values.filter { it.ended != null && it.packets.isEmpty() }.map { it.key }.forEach(owners::remove)
                if (owners.size >= MAX_OWNERS * 2) { active[type] = key; suppressedNativeTypes.add(type); failLocked("audio-native-owner-overflow"); return null }
                val owner = Owner(key, record, fields).also { it.since = nanoTime() }
                active[type]?.let(owners::get)?.let(::discardPending)
                owners[key] = owner; active[type] = key; latestNative[type to key.mode] = key.epoch; suppressedNativeTypes.remove(type)
                if (peer != null && !negotiating && failure == null) {
                    bind(owner, emit = false)
                    return if (owner.slot != null) annotate(record, fields, owner) else null
                }
                return null
            }
        }
        synchronized(lock) {
            if (closed) return record
            val owner = owners[key] ?: return if (type in suppressedNativeTypes || latestNative[type to key.mode]?.let { key.epoch - it <= 0 } == true) null else record
            if (owner.ended != null || active[type] != key) return null
            if (record.size < 37 || record.size - 36 > MAX_PACKET_BYTES || !wire.getDouble(28).isFinite()) {
                failLocked("invalid-native-audio-packet"); return null
            }
            if (failure != null && failure != "audio-slots-exhausted") return null
            val backend = peer
            if (backend != null && !negotiating && owner.slot != null && owner.receiverReady) {
                submit(backend, owner, record); return null
            }
            if (stagedBytes + record.size > MAX_STAGED_BYTES || stagedPackets >= MAX_STAGED_PACKETS ||
                owner.bytes + record.size > MAX_TRACK_BYTES || owner.packets.size >= MAX_TRACK_PACKETS) {
                failLocked("audio-native-staging-overflow"); return null
            }
            owner.packets.addLast(record); owner.bytes += record.size
            stagedBytes += record.size; stagedPackets++
            return null
        }
    }

    private fun discardPending(owner: Owner) {
        stagedBytes -= owner.bytes; stagedPackets -= owner.packets.size
        owner.packets.clear(); owner.bytes = 0
    }
    private fun bind(owner: Owner, emit: Boolean) {
        if (assigned >= slots.size) { failLocked("audio-slots-exhausted"); return }
        if (peer == null) return
        owner.slot = slots[assigned++].mid; owner.generation = generation; owner.receiverReady = false
        owner.since = nanoTime()
        if (emit) metadata.addLast(annotate(owner.config, owner.fields, owner))
        owner.ended?.let { @Suppress("UNCHECKED_CAST")
            val fields = WebJson.parse(String(it, 28, it.size - 28, Charsets.UTF_8)) as Map<String, Any?>
            metadata.addLast(annotate(it, fields, owner))
        }
    }
    private fun submit(backend: BrowserRtcAudioBackend, owner: Owner, record: ByteArray) {
        try { backend.send(requireNotNull(owner.slot), record.copyOfRange(36, record.size), ByteBuffer.wrap(record).order(ByteOrder.BIG_ENDIAN).getDouble(28)) }
        catch (_: Throwable) { failLocked("audio-native-send-failed") }
    }
    private fun annotate(record: ByteArray, fields: Map<String, Any?>, owner: Owner): ByteArray {
        val body = WebJson.write(fields + mapOf("audioTransport" to TRANSPORT, "rtpSlot" to requireNotNull(owner.slot),
            "rtcGeneration" to owner.generation, "rtcOwnerEpoch" to (owner.key.epoch.toLong() and 0xffff_ffffL))).toByteArray(Charsets.UTF_8)
        return record.copyOf(28 + body.size).also {
            ByteBuffer.wrap(it).order(ByteOrder.BIG_ENDIAN).putInt(it.size - 4)
            body.copyInto(it, 28)
        }
    }
    /** Remote application barrier: an RTP receiver and Worklet graph own this exact slot. */
    fun readyTrack(fields: Map<*, *>): Boolean = synchronized(lock) {
        fun exact(value: Any?, min: Long, max: Long): Long? = (value as? Number)?.toDouble()
            ?.takeIf { it.isFinite() && it >= min && it <= max && it % 1.0 == 0.0 }?.toLong()
        val requestedGeneration = exact(fields["rtcGeneration"], 1, Int.MAX_VALUE.toLong())?.toInt() ?: return false
        val type = exact(fields["type"], 0, 255)?.toInt() ?: return false
        val epoch = exact(fields["rtcOwnerEpoch"], 0, 0xffff_ffffL)?.toInt() ?: return false
        val mode = when (fields["mode"]) { "carplay" -> 0; "airplay-mirror" -> 4; "airplay-audio" -> 8; else -> return false }
        val slot = fields["rtpSlot"] as? String ?: return false
        if (closed || negotiating || failure != null || generation != requestedGeneration) return false
        val owner = owners[Key(type, mode, epoch)] ?: return false
        if (owner.generation != requestedGeneration || owner.slot != slot) return false
        if (owner.receiverReady) return true
        val backend = peer ?: return false
        owner.receiverReady = true
        while (owner.packets.isNotEmpty()) {
            val record = owner.packets.removeFirst(); owner.bytes -= record.size
            stagedBytes -= record.size; stagedPackets--
            submit(backend, owner, record)
        }
        true
    }
    fun drainMetadata(): List<ByteArray> = synchronized(lock) { buildList { while (metadata.isNotEmpty()) add(metadata.removeFirst()) } }
    fun ready(): Boolean = synchronized(lock) { !closed && !negotiating && failure == null && peer?.ready() == true }
    fun snapshot(): Map<String, Any?> = synchronized(lock) {
        mapOf("transport" to TRANSPORT, "generation" to generation, "negotiating" to negotiating,
            "slots" to assigned, "owners" to owners.size, "receiverReadySlots" to owners.values.count { it.receiverReady }, "queuedBytes" to stagedBytes,
            "queuedPackets" to stagedPackets, "failure" to failure, "native" to peer?.snapshot())
    }
    private fun checkWaiting() = synchronized(lock) {
        if (!closed && failure == null && owners.values.any { !it.receiverReady && nanoTime() - it.since >= WAIT_NANOS })
            failLocked("audio-native-negotiation-timeout")
    }
    private fun fail(nextGeneration: Int, reason: String) = synchronized(lock) {
        if (!closed && generation == nextGeneration) { negotiating = false; failLocked(reason) }
    }
    private fun failLocked(reason: String) {
        if (closed || failure != null) return
        failure = reason
        // No callback runs under the router lock or a native library callback stack.
        val failedGeneration = generation
        watchdog.execute {
            if (synchronized(lock) { !closed && generation == failedGeneration && failure == reason }) onFailure(reason)
        }
    }
    /** Audio opt-out/reset retires native owners; it does not reset unsupported fallback streams. */
    fun reset() {
        val retired = synchronized(lock) {
            val old = listOfNotNull(peer, pendingPeer); peer = null; pendingPeer = null; negotiating = false; slots = emptyList(); assigned = 0
            owners.clear(); active.clear(); latestNative.clear(); suppressedNativeTypes.clear(); metadata.clear(); stagedBytes = 0; stagedPackets = 0; failure = null
            old
        }
        retired.forEach { it.close() }
    }
    override fun close() {
        synchronized(lock) { if (closed) return; closed = true }
        reset(); watchdog.shutdownNow()
    }

    companion object {
        const val TRANSPORT = "webrtc-track-v1"
        private const val MAX_SDP_BYTES = 48 * 1024
        private const val MAX_OWNERS = 16
        private const val MAX_STAGED_BYTES = 1024 * 1024
        private const val MAX_TRACK_BYTES = 256 * 1024
        private const val MAX_STAGED_PACKETS = 1024
        private const val MAX_TRACK_PACKETS = 128
        private const val MAX_PACKET_BYTES = 65479
        private const val WAIT_NANOS = 5_000_000_000L

        private fun supportedConfig(fields: Map<*, *>?, record: ByteArray): Boolean = fields?.get("codec") == "opus"
            && (fields["sampleRate"] as? Number)?.toDouble() == 48000.0
            && (fields["channels"] as? Number)?.toDouble() in listOf(1.0, 2.0)
            && ByteBuffer.wrap(record).getInt(8) == 48000
            && (fields["channels"] as Number).toInt() == (record[6].toInt() and 255)

        internal fun parseOffer(sdp: String): List<BrowserRtcAudioSlot> {
            require(sdp.toByteArray(Charsets.UTF_8).size <= MAX_SDP_BYTES && sdp.startsWith("v=0")) { "invalid-audio-offer" }
            val sections = mutableListOf<MutableList<String>>()
            val session = mutableListOf<String>()
            for (line in sdp.lineSequence().map { it.trimEnd('\r') }) {
                if (line.startsWith("m=")) sections.add(mutableListOf(line))
                else if (sections.isEmpty()) session.add(line) else sections.last().add(line)
                if (line.startsWith("a=candidate:")) require(Regex("(?:^| )typ host(?: |$)").containsMatchIn(line)) { "audio-non-host-candidate" }
            }
            require(sections.isNotEmpty() && sections.size <= MAX_OWNERS) { "invalid-audio-slot-count" }
            val result = sections.map { lines ->
                val media = lines.first().split(Regex(" +"))
                require(media.size >= 4 && media[0] == "m=audio" && media[1].toIntOrNull() in 0..65535 && media[2] == "UDP/TLS/RTP/SAVPF") { "audio-only-offer-required" }
                val direction = lines.firstOrNull { it in setOf("a=recvonly", "a=sendonly", "a=sendrecv", "a=inactive") }
                    ?: session.firstOrNull { it in setOf("a=recvonly", "a=sendonly", "a=sendrecv", "a=inactive") }
                require(direction == "a=recvonly") { "audio-offer-must-be-receive-only" }
                val mid = lines.singleOrNull { it.startsWith("a=mid:") }?.substringAfter(':')
                    ?: error("audio-mid-required")
                val bundle = session.filter { it.startsWith("a=group:BUNDLE ") }.flatMap { it.substringAfter("BUNDLE ").split(' ') }.toSet()
                require(media[1] != "0" || "a=bundle-only" in lines && mid in bundle) { "audio-inactive-slot" }
                require(mid.length in 1..32 && mid.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in "_-" }) { "invalid-audio-mid" }
                require(lines.any { it == "a=rtcp-mux" }) { "audio-rtcp-mux-required" }
                val payloads = media.drop(3).mapNotNull(String::toIntOrNull).toSet()
                val opus = lines.firstNotNullOfOrNull { line ->
                    Regex("a=rtpmap:(\\d+) opus/48000/2", RegexOption.IGNORE_CASE).matchEntire(line)?.groupValues?.get(1)?.toIntOrNull()
                        ?.takeIf { it in payloads && it in 0..127 }
                } ?: error("audio-opus-not-negotiated")
                BrowserRtcAudioSlot(mid, opus)
            }
            require(result.map { it.mid }.distinct().size == result.size) { "duplicate-audio-mid" }
            return result
        }
    }
}
