package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlayback
import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong

/** Controls only URL video playback; mirror/photo frames do not have a seek timeline. */
object AirPlayBrowserPlayback {
    data class State(val duration: Double, val position: Double, val playing: Boolean,
                     val ready: Boolean, val buffering: Boolean, val seekable: Boolean,
                     val kind: String = "video", val rate: Double = 1.0, val outputAllowed: Boolean = true)
    private data class Entry(val id: Long, val state: () -> State,
                             val control: (String, Double?) -> Unit, val video: AirPlayVideoPlayback?,
                             val photo: AirPlayPhotoPlayback?)
    private val ids = AtomicLong()
    private var current: Entry? = null

    @Synchronized
    fun register(state: () -> State, video: AirPlayVideoPlayback? = null, photo: AirPlayPhotoPlayback? = null,
                 control: (String, Double?) -> Unit): Closeable {
        val entry = Entry(ids.incrementAndGet(), state, control, video, photo)
        current = entry
        return Closeable {
            synchronized(this) { if (current === entry) current = null }
            entry.video?.close()
            entry.photo?.close()
        }
    }

    @Synchronized
    fun snapshot(): Map<String, Any?>? {
        val entry = current ?: return null
        val state = entry.state()
        return mapOf("id" to entry.id, "duration" to state.duration, "position" to state.position,
            "playing" to state.playing, "ready" to state.ready, "buffering" to state.buffering,
            "seekable" to state.seekable, "kind" to state.kind, "rate" to state.rate, "outputAllowed" to state.outputAllowed) +
            (entry.video?.source() ?: entry.photo?.source() ?: emptyMap())
    }

    @Synchronized
    fun video(id: Long): AirPlayVideoPlayback? = current?.takeIf { it.id == id }?.video

    @Synchronized
    fun photo(id: Long): AirPlayPhotoPlayback? = current?.takeIf { it.id == id }?.photo

    @Synchronized
    fun report(id: Long, fields: Map<*, *>): Boolean = current?.takeIf { it.id == id }?.video?.report(fields) ?: false

    /** The playback ID prevents a delayed browser command controlling the next iPhone item. */
    @Synchronized
    fun command(id: Long, action: String, value: Double? = null): Boolean {
        val entry = current?.takeIf { it.id == id } ?: return false
        when (action) {
            "play", "pause", "stop" -> if (value != null) return false
            "seek" -> {
                val state = entry.state()
                if (!state.seekable || value == null || !value.isFinite() || value < 0 ||
                    value > state.duration) return false
            }
            "rate" -> if (entry.state().kind != "video" || value == null || !ReceiverPlayback.supportsRate(value)) return false
            else -> return false
        }
        entry.control(action, value)
        return true
    }
}
