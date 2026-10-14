package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import java.io.Closeable

/** Browser owns decoding and its media clock; iPhone commands carry a revision to retire stale reports. */
class AirPlayVideoPlayback(item: ReceiverPlay, iphone: (String) -> ReceiverResource?,
                           private val event: (String) -> Unit) : Closeable {
    private val itemUrl = item.url
    val proxy = AirPlayVideoProxy(item.url, iphone, item.iphoneHost)
    @Volatile var playback = ReceiverPlayback(buffering = true)
        private set
    private var revision = 0L
    private var seekRevision = 0L
    private var prepared = false
    private var requestedPlaying = true
    private var target = item.start
    private var fraction = item.fraction
    private var seekable = false
    private var closed = false
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
        requestedPlaying, playback.ready, playback.buffering, seekable)

    @Synchronized fun source(): Map<String, Any?> = mapOf("resource" to proxy.rootId,
        "directUrl" to proxy.directUrl(itemUrl), "revision" to revision, "seekRevision" to seekRevision, "target" to target, "fraction" to fraction)

    @Synchronized fun control(action: String, value: Double?) {
        if (closed) return
        when (action) {
            "play" -> requestedPlaying = true
            "pause" -> requestedPlaying = false
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
        val ready = fields["ready"] as? Boolean ?: return false
        val buffering = fields["buffering"] as? Boolean ?: return false
        val buffered = if (fields.containsKey("bufferedPosition")) number("bufferedPosition") ?: return false else position
        if (buffered < position || (duration > 0 && buffered > duration)) return false
        val previous = playback
        seekable = fields["seekable"] == true && duration > 0
        requestedPlaying = playing
        prepared = prepared || ready
        playback = ReceiverPlayback(duration, position, if (playing && fields["ended"] != true) 1.0 else 0.0,
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
