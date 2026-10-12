package com.shilapi.xcertplay.web

import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong

/** Controls only URL video playback; mirror/photo frames do not have a seek timeline. */
object AirPlayBrowserPlayback {
    data class State(val duration: Double, val position: Double, val playing: Boolean,
                     val ready: Boolean, val buffering: Boolean, val seekable: Boolean,
                     val kind: String = "video")
    private data class Entry(val id: Long, val state: () -> State,
                             val control: (String, Double?) -> Unit)
    private val ids = AtomicLong()
    private var current: Entry? = null

    @Synchronized
    fun register(state: () -> State, control: (String, Double?) -> Unit): Closeable {
        val entry = Entry(ids.incrementAndGet(), state, control)
        current = entry
        return Closeable { synchronized(this) { if (current === entry) current = null } }
    }

    @Synchronized
    fun snapshot(): Map<String, Any?>? {
        val entry = current ?: return null
        val state = entry.state()
        return mapOf("id" to entry.id, "duration" to state.duration, "position" to state.position,
            "playing" to state.playing, "ready" to state.ready, "buffering" to state.buffering,
            "seekable" to state.seekable, "kind" to state.kind)
    }

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
            else -> return false
        }
        entry.control(action, value)
        return true
    }
}
