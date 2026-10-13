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
    private var requestedPlaying = true
    private var target = item.start
    private var fraction = item.fraction
    private var seekable = false
    private var closed = false

    @Synchronized fun state() = AirPlayBrowserPlayback.State(playback.duration, playback.position,
        requestedPlaying, playback.ready, playback.buffering, seekable)

    @Synchronized fun source(): Map<String, Any?> = mapOf("resource" to proxy.rootId,
        "directUrl" to proxy.directUrl(itemUrl), "revision" to revision, "target" to target, "fraction" to fraction)

    @Synchronized fun control(action: String, value: Double?) {
        if (closed) return
        when (action) {
            "play" -> requestedPlaying = true
            "pause" -> requestedPlaying = false
            "seek" -> { target = requireNotNull(value); fraction = false }
            else -> return
        }
        if (action != "seek") { target = playback.position; fraction = false }
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
        val previous = playback
        seekable = fields["seekable"] == true && duration > 0
        requestedPlaying = playing
        playback = ReceiverPlayback(duration, position, if (playing && !buffering) 1.0 else 0.0, ready, buffering)
        val state = when { fields["failed"] == true -> "failed"; fields["ended"] == true -> "stopped"
            buffering -> "loading"; playing -> "playing"; else -> "paused" }
        if (state == "failed" || state == "stopped" || previous.buffering != buffering || previous.rate != playback.rate || previous.ready != ready) event(state)
        return true
    }

    @Synchronized override fun close() { if (!closed) { closed = true; proxy.close() } }
}
