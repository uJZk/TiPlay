package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlayback
import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong

/** URL media, photos and receiver-local live audio controls; only URL media can seek. */
object AirPlayBrowserPlayback {
    data class State(val duration: Double, val position: Double, val playing: Boolean,
                     val ready: Boolean, val buffering: Boolean, val seekable: Boolean,
                     val kind: String = "video", val rate: Double = 1.0, val outputAllowed: Boolean = true,
                     val videoShown: Boolean = true, val muted: Boolean = false)
    private data class Entry(val id: Long, val state: () -> State,
                             val control: (String, Double?) -> Unit, val video: AirPlayVideoPlayback?,
                             val photo: AirPlayPhotoPlayback?, val audio: AirPlayAudioPlayback?,
                             val onRetired: () -> Unit)
    private val ids = AtomicLong()
    private var visual: Entry? = null
    private var liveAudio: Entry? = null

    private fun front(): Entry? = visual ?: liveAudio
    private fun entry(id: Long): Entry? = visual?.takeIf { it.id == id } ?: liveAudio?.takeIf { it.id == id }

    fun register(state: () -> State, video: AirPlayVideoPlayback? = null, photo: AirPlayPhotoPlayback? = null,
                 audio: AirPlayAudioPlayback? = null, onRetired: () -> Unit = {},
                 control: (String, Double?) -> Unit): Closeable {
        val entry = Entry(ids.incrementAndGet(), state, control, video, photo, audio, onRetired)
        // Audio transport is independent of the displayed URL/photo. Keep its controls and
        // metadata alive in the background instead of retiring a VideoInCar picture.
        val replacingAudio = audio != null || state().kind == "audio"
        val retired = synchronized(this) {
            if (replacingAudio) liveAudio.also { liveAudio = entry }
            else visual.also { visual = entry }
        }
        retired?.let {
            closeResources(it)
            // Owner teardown may register or close other items, so it must run outside the registry.
            runCatching(it.onRetired)
        }
        return Closeable {
            synchronized(this) {
                if (visual === entry) visual = null
                if (liveAudio === entry) liveAudio = null
            }
            closeResources(entry)
        }
    }

    private fun closeResources(entry: Entry) {
        listOfNotNull<Closeable>(entry.video, entry.photo, entry.audio).forEach { runCatching(it::close) }
    }

    @Synchronized
    fun snapshot(): Map<String, Any?>? {
        val entry = front() ?: return null
        val state = entry.state()
        return mapOf("id" to entry.id, "duration" to state.duration, "position" to state.position,
            "playing" to state.playing, "ready" to state.ready, "buffering" to state.buffering,
            "seekable" to state.seekable, "kind" to state.kind, "rate" to state.rate, "outputAllowed" to state.outputAllowed,
            "videoShown" to state.videoShown, "muted" to state.muted) +
            (entry.video?.source() ?: entry.photo?.source() ?: entry.audio?.source() ?: emptyMap())
    }

    @Synchronized
    fun video(id: Long): AirPlayVideoPlayback? = entry(id)?.video

    @Synchronized
    fun photo(id: Long): AirPlayPhotoPlayback? = entry(id)?.photo

    @Synchronized
    fun audio(id: Long): AirPlayAudioPlayback? = entry(id)?.audio

    @Synchronized
    fun report(id: Long, fields: Map<*, *>): Boolean {
        val entry = front()?.takeIf { it.id == id } ?: return false
        return entry.video?.report(fields) ?: if (fields["failed"] == true) entry.photo?.fail() ?: false else false
    }

    /** The playback ID prevents a delayed browser command controlling the next iPhone item. */
    @Synchronized
    fun command(id: Long, action: String, value: Double? = null): Boolean {
        val entry = front()?.takeIf { it.id == id } ?: return false
        if (entry.state().kind == "audio" && action !in listOf("play", "pause", "stop") &&
            entry.audio?.canRemote(action) != true) return false
        if (entry.state().kind == "photo" && action != "stop") return false
        when (action) {
            "play", "pause", "stop" -> if (value != null) return false
            "previous", "next", "skip-back", "skip-forward" ->
                if (value != null || entry.audio?.canRemote(action) != true) return false
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
