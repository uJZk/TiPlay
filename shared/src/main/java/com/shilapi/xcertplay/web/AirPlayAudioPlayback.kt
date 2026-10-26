package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverAudioMetadataUpdate
import com.shilapi.xcertplay.receiver.ReceiverAudioProgress
import java.io.Closeable

/** Sender metadata and received RTP coordinates; this model never takes ownership of the canvas. */
class AirPlayAudioPlayback : Closeable {
    private var title = ""
    private var artist = ""
    private var album = ""
    private var sampleRate = 0
    private var durationMillis = 0L
    private var progress: ReceiverAudioProgress? = null
    private var position = 0.0
    private var frozenPosition = 0.0
    private var paused = false
    private var closed = false
    private var artwork: AirPlayPhotoPlayback? = null
    private var artworkRevision = 0L
    private var remoteActions = emptyList<String>()
    private var awaitingSourceTimeline = false
    private var remotePending = false
    private var remoteSourceConfirmation = false
    private var remoteSourceAcknowledged = false
    private var expectingTrackChange = false

    @Synchronized fun update(value: ReceiverAudioMetadataUpdate) {
        if (closed) return
        value.title?.let {
            if (it != title && (title.isNotEmpty() || expectingTrackChange)) {
                progress = null; durationMillis = 0; position = 0.0; frozenPosition = 0.0
                expectingTrackChange = false
            }
            title = it
        }
        value.artist?.let { artist = it }
        value.album?.let { album = it }
        value.durationMillis?.let { durationMillis = it }
        value.progress?.let {
            if (offset(it.current, it.start) <= offset(it.end, it.start)) {
                progress = it
                if (sampleRate > 0) {
                    position = offset(it.current, it.start).toDouble() / sampleRate
                    if (remoteSourceConfirmation && remoteSourceAcknowledged) {
                        if (paused) frozenPosition = position
                        remoteSourceConfirmation = false
                    }
                }
            }
        }
        value.artwork?.let {
            artwork?.close()
            artwork = if (it.bytes.isEmpty()) null else AirPlayPhotoPlayback(it.bytes)
            artworkRevision++
        }
    }

    /** Called after source-order/decryption validation, independently of browser currentTime. */
    @Synchronized fun sample(sample: Long, rate: Int) {
        if (closed || rate !in 8000..192000) return
        sampleRate = rate
        if (awaitingSourceTimeline) return
        val timeline = progress ?: return
        val distance = offset(sample, timeline.start)
        // A stale packet preceding the new RTP origin must not wrap to the end of the track.
        if (distance >= 0x8000_0000L || distance > offset(timeline.end, timeline.start)) return
        val elapsed = distance.toDouble() / sampleRate
        val reported = offset(timeline.current, timeline.start).toDouble() / sampleRate
        // Progress may arrive before already-in-flight audio. Never rewind its report accidentally.
        position = maxOf(elapsed, reported).coerceAtMost(duration())
    }

    @Synchronized fun remoteControls(actions: List<String>) {
        if (!closed) remoteActions = REMOTE_ACTIONS.filter { it in actions }
    }
    @Synchronized fun canRemote(action: String): Boolean = !closed && !remotePending && action in remoteActions
    @Synchronized fun remoteRequested(action: String = "") { if (!closed) {
        awaitingSourceTimeline = true; remotePending = true; remoteSourceConfirmation = true; remoteSourceAcknowledged = false
        expectingTrackChange = action in listOf("previous", "next")
    } }
    @Synchronized fun remoteFinished(accepted: Boolean) {
        remoteSourceAcknowledged = accepted
        if (!accepted) { awaitingSourceTimeline = false; remoteSourceConfirmation = false; expectingTrackChange = false }
    }
    @Synchronized fun remoteExpired() { remoteSourceConfirmation = false; remoteSourceAcknowledged = false; expectingTrackChange = false }
    @Synchronized fun remoteIdle() { remotePending = false }
    @Synchronized fun timelineReset() { awaitingSourceTimeline = false }

    @Synchronized fun setPaused(value: Boolean) {
        if (closed || paused == value) return
        if (value) frozenPosition = position
        paused = value
    }

    @Synchronized fun state(): AirPlayBrowserPlayback.State = AirPlayBrowserPlayback.State(
        duration(), (if (paused) frozenPosition else position).coerceIn(0.0, duration()),
        !paused && !closed, !closed, false, false, "audio",
    )

    @Synchronized fun source(): Map<String, Any?> = if (closed) emptyMap() else mapOf(
        "title" to title, "artist" to artist, "album" to album,
        "artworkResource" to artwork?.let { "audio-art-$artworkRevision" },
        "controls" to listOf("play", "pause", "stop") + remoteActions, "controlScope" to "receiver",
        "remoteControls" to remoteActions, "remoteControlScope" to "sender",
        "remotePending" to remotePending,
        "progressKnown" to (progress != null && sampleRate > 0),
    )

    @Synchronized fun open(resource: String, range: String?): AirPlayVideoProxy.Resource? =
        if (!closed && resource == "audio-art-$artworkRevision") artwork?.open(range) else null

    private fun duration(): Double = if (sampleRate > 0 && progress != null)
        offset(requireNotNull(progress).end, requireNotNull(progress).start).toDouble() / sampleRate
        else durationMillis / 1000.0

    private fun offset(sample: Long, start: Long): Long = (sample - start) and 0xffff_ffffL

    @Synchronized override fun close() {
        closed = true
        artwork?.close(); artwork = null
        title = ""; artist = ""; album = ""; progress = null
        remoteActions = emptyList()
    }

    companion object {
        private val REMOTE_ACTIONS = listOf("previous", "next", "skip-back", "skip-forward")
    }
}
