package com.shilapi.xcertplay

import androidx.media3.common.Player
import org.junit.Assert.*
import org.junit.Test

class AirPlayCastPlaybackTest {
    @Test fun seekingKeepsThePreparedItemAndRequestedRateWhileReportingLoading() {
        val playback = AirPlayCastPlayback()
        assertFalse(playback.snapshot(Player.STATE_BUFFERING, 120_000, 0, 0, true, true).ready)
        val ready = playback.snapshot(Player.STATE_READY, 120_000, 10_000, 40_000, true, true)
        assertTrue(ready.ready)
        val seeking = playback.snapshot(Player.STATE_BUFFERING, 120_000, 70_000, 70_000, true, true)
        assertTrue(seeking.ready)
        assertTrue(seeking.buffering)
        assertEquals(1.0, seeking.rate, 0.0)
        assertEquals("loading", playback.event(Player.STATE_BUFFERING, true))
        assertEquals(true, seeking.info()["playbackBufferEmpty"])
        assertEquals(false, seeking.info()["playbackBufferFull"])
        assertEquals(listOf(mapOf("start" to 0.0, "duration" to 120.0)), seeking.info()["seekableTimeRanges"])
        val paused = playback.snapshot(Player.STATE_BUFFERING, 120_000, 70_000, 80_000, false, true)
        assertEquals(0.0, paused.rate, 0.0)
        assertEquals("paused", playback.event(Player.STATE_BUFFERING, false))
    }

    @Test fun loadedRangesUseActualBufferedMediaAndResetDoesNotLeakPreviousReadiness() {
        val playback = AirPlayCastPlayback()
        val ready = playback.snapshot(Player.STATE_READY, 120_000, 10_000, 40_000, true, true)
        assertEquals(listOf(mapOf("start" to 10.0, "duration" to 30.0)), ready.info()["loadedTimeRanges"])
        assertEquals(false, ready.info()["playbackBufferFull"])
        val full = playback.snapshot(Player.STATE_READY, 120_000, 10_000, 120_000, true, true)
        assertEquals(true, full.info()["playbackBufferFull"])
        val live = playback.snapshot(Player.STATE_READY, -1, 10_000, 40_000, true, false)
        assertEquals(emptyList<Any>(), live.info()["seekableTimeRanges"])
        playback.reset()
        val next = playback.snapshot(Player.STATE_BUFFERING, -1, 0, 0, true, false)
        assertFalse(next.ready)
        assertEquals(false, next.info()["playbackBufferFull"])
        assertEquals(0.0, playback.snapshot(Player.STATE_ENDED, 120_000, 120_000, 120_000, true, true).rate, 0.0)
        assertEquals("stopped", playback.event(Player.STATE_ENDED, true))
    }
}
