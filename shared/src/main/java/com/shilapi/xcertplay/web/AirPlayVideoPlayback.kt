package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import java.io.Closeable

/** Browser owns decoding and its media clock; iPhone commands carry a revision to retire stale reports. */
class AirPlayVideoPlayback(item: ReceiverPlay, iphone: (String, String?) -> ReceiverResource?,
                           log: (String) -> Unit = {},
                           private val event: (String) -> Unit) : Closeable {
    private val itemUrl = item.url
    val proxy = AirPlayVideoProxy(item.url, iphone, item.iphoneHost, log)
    @Volatile var playback = ReceiverPlayback(buffering = true)
        private set
    private var revision = 0L
    private var seekRevision = 0L
    private var prepared = false
    private var requestedPlaying = true
    private var requestedRate = 1.0
    private var target = item.start
    private var fraction = item.fraction
    private var seekable = false
    private var closed = false
    private var outputAllowed = true
    private var videoShown = true
    private var muted = false
    private var availableTracks: Map<String, Set<String>> = emptyMap()
    private var trackRevision = 0L
    private var trackSelection: List<Map<String, Any?>> = emptyList()
    private var textMarkup: Map<String, Any> = mapOf("fontScale" to 1.0, "color" to "#FFFFFF")
    private data class PendingSeek(val token: Long, val position: Double, val dispatchedRevision: Long? = null)
    private var seekRequests = 0L
    private var pendingSeek: PendingSeek? = null

    /** A scrub read immediately after POST must acknowledge the accepted target during coalescing. */
    @Synchronized fun queueSeek(seconds: Double): Long? {
        if (closed) return null
        require(seconds.isFinite() && seconds >= 0)
        return (++seekRequests).also { pendingSeek = PendingSeek(it, seconds) }
    }

    @Synchronized fun dispatchQueuedSeek(token: Long): Boolean {
        val pending = pendingSeek?.takeIf { !closed && it.token == token } ?: return false
        applySeek(pending.position)
        pendingSeek = pending.copy(dispatchedRevision = revision)
        return true
    }

    /** Pending position is protocol feedback; the browser's measured clock remains in [playback]. */
    @Synchronized fun receiverPlayback(): ReceiverPlayback {
        val pending = pendingSeek ?: return playback
        val position = if (playback.duration > 0) pending.position.coerceAtMost(playback.duration) else pending.position
        return playback.copy(position = position, bufferedPosition = position, buffering = true)
    }

    private fun applySeek(seconds: Double) {
        target = seconds
        fraction = false
        seekRevision++
        revision++
    }

    @Synchronized fun state() = AirPlayBrowserPlayback.State(playback.duration, playback.position,
        requestedPlaying && outputAllowed, playback.ready, playback.buffering, seekable,
        rate = requestedRate, outputAllowed = outputAllowed, videoShown = videoShown, muted = muted)

    @Synchronized fun source(): Map<String, Any?> = mapOf("resource" to proxy.rootId,
        "proxyOnly" to com.shilapi.xcertplay.diagnostics.RawTraffic.enabled, "directUrl" to proxy.directUrl(itemUrl),
        "revision" to revision, "seekRevision" to seekRevision, "target" to target, "fraction" to fraction,
        "outputAllowed" to outputAllowed, "videoShown" to videoShown, "muted" to muted,
        "trackRevision" to trackRevision, "trackSelection" to trackSelection, "textMarkup" to textMarkup)

    @Synchronized fun setOutputAllowed(allowed: Boolean) {
        if (closed || outputAllowed == allowed) return
        outputAllowed = allowed
        revision++
    }

    /** Giving the picture back to CarPlay must not pause a permitted URL audio stream. */
    @Synchronized fun setVideoShown(shown: Boolean) {
        if (closed || videoShown == shown) return
        videoShown = shown
        revision++
    }

    /** Accept only implemented properties and tracks actually discovered by the browser. */
    @Synchronized fun property(name: String, value: Any?): Boolean {
        if (closed) return false
        when (name) {
            "muted" -> muted = value as? Boolean ?: return false
            "selectedMediaArray" -> {
                val selections = value as? List<*> ?: return false
                if (selections.size > 2) return false
                val seen = mutableSetOf<String>()
                val accepted = selections.map { entry ->
                    val fields = entry as? Map<*, *> ?: return false
                    val type = fields["type"] as? String ?: return false
                    if (type !in setOf("audio", "subtitle") || !seen.add(type)) return false
                    val id = fields["id"]
                    if (id == null && type != "subtitle") return false
                    if (id != null && (id !is String || id !in availableTracks[type].orEmpty())) return false
                    mapOf("type" to type, "id" to id)
                }
                trackSelection = accepted; trackRevision++
            }
            "textMarkupArray" -> {
                val styles = value as? List<*> ?: return false
                if (styles.size > 1) return false
                val fields = if (styles.isEmpty()) emptyMap<Any?, Any?>() else styles[0] as? Map<*, *> ?: return false
                if (fields.keys.any { it !in setOf("fontScale", "color") }) return false
                val scale = if (fields.containsKey("fontScale")) (fields["fontScale"] as? Number)?.toDouble()
                    ?.takeIf { it.isFinite() && it in 0.5..3.0 } ?: return false else 1.0
                val color = if (fields.containsKey("color")) (fields["color"] as? String)
                    ?.takeIf { Regex("#[0-9a-fA-F]{6}").matches(it) } ?: return false else "#FFFFFF"
                textMarkup = mapOf("fontScale" to scale, "color" to color)
            }
            else -> return false
        }
        revision++; return true
    }

    @Synchronized fun control(action: String, value: Double?) {
        if (closed) return
        when (action) {
            "play" -> requestedPlaying = true
            "pause" -> requestedPlaying = false
            "rate" -> {
                val rate = value?.takeIf { ReceiverPlayback.supportsRate(it) } ?: return
                requestedPlaying = rate > 0.0
                if (requestedPlaying) requestedRate = rate
            }
            "seek" -> {
                val seconds = requireNotNull(value)
                applySeek(seconds)
                pendingSeek = PendingSeek(++seekRequests, seconds, revision)
                return
            }
            else -> return
        }
        revision++
    }

    @Synchronized fun report(fields: Map<*, *>): Boolean {
        if (closed || (fields["revision"] as? Number)?.toDouble() != revision.toDouble()) return false
        fun number(key: String) = (fields[key] as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }
        val duration = number("duration") ?: return false
        val position = number("position") ?: return false
        if (position > duration && duration > 0) return false
        val playing = fields["playing"] as? Boolean ?: return false
        // Old browser reports only playing; their non-paused rate remains 1x.
        val rate = if (fields.containsKey("rate")) {
            number("rate")?.takeIf { ReceiverPlayback.supportsRate(it, allowPause = false) } ?: return false
        } else 1.0
        val ready = fields["ready"] as? Boolean ?: return false
        val buffering = fields["buffering"] as? Boolean ?: return false
        val buffered = if (fields.containsKey("bufferedPosition")) number("bufferedPosition") ?: return false else position
        if (buffered < position || (duration > 0 && buffered > duration)) return false
        val previous = playback
        val catalogue = fields["tracks"] as? Map<*, *>
        if (catalogue != null) {
            val decoded = mutableMapOf<String, Set<String>>()
            for (type in listOf("audio", "subtitle")) {
                val ids = catalogue[type] as? List<*> ?: return false
                if (ids.size > 64 || ids.any { it !is String || it.length !in 1..128 }) return false
                decoded[type] = ids.filterIsInstance<String>().toSet()
            }
            availableTracks = decoded
        }
        seekable = fields["seekable"] == true && duration > 0
        if (outputAllowed) requestedPlaying = playing
        requestedRate = rate
        prepared = prepared || ready
        playback = ReceiverPlayback(duration, position, if (playing && fields["ended"] != true) rate else 0.0,
            prepared, buffering, buffered, seekable)
        // The page reports this revision only after applying its directive. A queued, undispatched
        // seek must survive current reports; older dispatched revisions are rejected above.
        if (pendingSeek?.dispatchedRevision != null && ready && !buffering) pendingSeek = null
        val state = when { fields["failed"] == true -> "failed"; fields["ended"] == true -> "stopped"
            buffering -> "loading"; playing -> "playing"; else -> "paused" }
        if (state == "failed" || state == "stopped" || previous.buffering != buffering || previous.rate != playback.rate || previous.ready != playback.ready) event(state)
        return true
    }

    @Synchronized override fun close() { if (!closed) { closed = true; pendingSeek = null; proxy.close() } }
}
