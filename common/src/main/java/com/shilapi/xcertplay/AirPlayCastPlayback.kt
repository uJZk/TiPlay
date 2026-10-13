package com.shilapi.xcertplay

import androidx.media3.common.Player
import com.shilapi.xcertplay.receiver.ReceiverPlayback

/** AirPlay reports the requested rate while buffering, without losing an already prepared item. */
internal class AirPlayCastPlayback {
    private var prepared = false

    fun snapshot(playbackState: Int, durationMs: Long, positionMs: Long, bufferedPositionMs: Long,
                 requestedPlaying: Boolean, seekable: Boolean): ReceiverPlayback {
        if (playbackState == Player.STATE_READY) prepared = true
        val duration = durationMs.coerceAtLeast(0) / 1000.0
        val position = (positionMs.coerceAtLeast(0) / 1000.0).let {
            if (duration > 0) it.coerceAtMost(duration) else it
        }
        val buffered = (bufferedPositionMs.coerceAtLeast(0) / 1000.0).let {
            if (duration > 0) it.coerceAtMost(duration) else it
        }.coerceAtLeast(position)
        return ReceiverPlayback(duration, position,
            if (requestedPlaying && playbackState != Player.STATE_ENDED) 1.0 else 0.0,
            prepared && playbackState != Player.STATE_IDLE, playbackState == Player.STATE_BUFFERING,
            buffered, seekable && duration > 0)
    }

    fun event(playbackState: Int, requestedPlaying: Boolean): String = when {
        playbackState == Player.STATE_ENDED -> "stopped"
        !requestedPlaying -> "paused"
        playbackState == Player.STATE_BUFFERING || playbackState == Player.STATE_IDLE -> "loading"
        else -> "playing"
    }

    fun reset() { prepared = false }
}
