package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlay
import org.junit.Assert.*
import org.junit.Test

class AirPlayVideoPlaybackTest {
    @Test fun rateChangesPreserveAnUnacknowledgedSeekAndBufferingRetainsRatePreparedStateAndRanges() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.2, true), { null }) {}
        try {
            video.control("seek", 50.0)
            video.control("pause", null)
            video.control("play", null)
            assertEquals(50.0, video.source()["target"])
            assertEquals(1L, video.source()["seekRevision"])
            val fields = mapOf("revision" to 3L, "duration" to 100.0, "position" to 50.0, "bufferedPosition" to 60.0,
                "playing" to true, "ready" to true, "buffering" to false, "seekable" to true)
            assertTrue(video.report(fields))
            assertTrue(video.report(fields + mapOf("ready" to false, "buffering" to true)))
            assertEquals(1.0, video.playback.rate, 0.0)
            assertTrue(video.playback.ready)
            assertEquals(false, video.playback.info()["playbackBufferFull"])
            assertEquals(listOf(mapOf("start" to 50.0, "duration" to 10.0)), video.playback.info()["loadedTimeRanges"])
            assertFalse(video.report(fields + mapOf("bufferedPosition" to 49.0)))
            assertFalse(video.report(fields + mapOf("bufferedPosition" to Double.NaN)))
        } finally { video.close() }
    }
    @Test fun browserOwnsTheClockAndRetiredReportsCannotUndoAnIphoneCommand() {
        val events = mutableListOf<String>()
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.2, true), { null }, events::add)
        val binding = AirPlayBrowserPlayback.register(video::state, video, video::control)
        try {
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            val fields = mapOf("revision" to 0L, "duration" to 100.0, "position" to 20.0,
                "playing" to true, "ready" to true, "buffering" to false, "seekable" to true)
            assertTrue(AirPlayBrowserPlayback.report(id, fields))
            assertEquals(20.0, video.playback.position, 0.0)
            assertTrue(AirPlayBrowserPlayback.command(id, "seek", 50.0))
            assertFalse(AirPlayBrowserPlayback.report(id, fields))
            assertEquals(50.0, video.source()["target"])
            assertTrue(AirPlayBrowserPlayback.report(id, fields + mapOf("revision" to 1L, "position" to 50.0)))
            assertEquals(50.0, video.playback.position, 0.0)
            assertFalse(AirPlayBrowserPlayback.report(id, fields + mapOf("revision" to 1L, "duration" to Double.NaN)))
            assertFalse(AirPlayBrowserPlayback.report(id, fields + mapOf("revision" to 1.5)))
            assertFalse(AirPlayBrowserPlayback.report(id + 1, fields))
        } finally { binding.close(); video.close() }
    }
}
