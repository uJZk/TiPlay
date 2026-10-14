package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlay
import org.junit.Assert.*
import org.junit.Test

class AirPlayVideoPlaybackTest {
    @Test fun queuedSeekReadbackAcknowledgesTheTargetUntilTheBrowserAppliesItsRevision() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { null }) {}
        try {
            val fields = mapOf("revision" to 0L, "duration" to 100.0, "position" to 20.0,
                "bufferedPosition" to 30.0, "playing" to true, "ready" to true, "buffering" to false, "seekable" to true)
            assertTrue(video.report(fields))
            val token = video.queueSeek(80.0)!!
            assertEquals(80.0, video.receiverPlayback().position, 0.0)
            assertEquals(20.0, video.playback.position, 0.0)
            assertTrue(video.receiverPlayback().buffering)
            assertEquals(80.0, video.receiverPlayback().bufferedPosition, 0.0)
            assertEquals(0L, video.source()["revision"])
            assertTrue(video.report(fields))
            assertEquals(80.0, video.receiverPlayback().position, 0.0)
            assertTrue(video.dispatchQueuedSeek(token))
            assertFalse(video.report(fields))
            video.control("pause", null)
            video.control("play", null)
            assertTrue(video.report(fields + mapOf("revision" to 3L, "position" to 80.0,
                "bufferedPosition" to 80.0, "ready" to false, "buffering" to true)))
            assertTrue(video.receiverPlayback().buffering)
            assertTrue(video.report(fields + mapOf("revision" to 3L, "position" to 83.0, "bufferedPosition" to 90.0)))
            assertEquals("A delayed ready report restores the measured clock without a target-distance limit",
                83.0, video.receiverPlayback().position, 0.0)
            assertFalse(video.receiverPlayback().buffering)
        } finally { video.close() }
    }

    @Test fun newerQueuedSeekRejectsOldDispatchAndOldConfirmationEvenForTheSameTarget() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { null }) {}
        try {
            val fields = mapOf("revision" to 0L, "duration" to 100.0, "position" to 20.0,
                "bufferedPosition" to 30.0, "playing" to true, "ready" to true, "buffering" to false, "seekable" to true)
            assertTrue(video.report(fields))
            val old = video.queueSeek(80.0)!!
            val latest = video.queueSeek(80.0)!!
            assertFalse(video.dispatchQueuedSeek(old))
            assertTrue(video.dispatchQueuedSeek(latest))
            val next = video.queueSeek(120.0)!!
            assertTrue(video.report(fields + mapOf("revision" to 1L, "position" to 80.0, "bufferedPosition" to 90.0)))
            assertEquals("An older confirmation cannot consume a new, undispatched target", 100.0, video.receiverPlayback().position, 0.0)
            assertTrue(video.dispatchQueuedSeek(next))
            assertFalse(video.report(fields + mapOf("revision" to 1L)))
            assertTrue(video.report(fields + mapOf("revision" to 2L, "position" to 100.0, "bufferedPosition" to 100.0)))
            assertFalse(video.receiverPlayback().buffering)
        } finally { video.close() }
    }

    @Test fun repeatedSeekBufferingReportsSendOnlyOneLoadingEventAndResumePlaying() {
        val events = mutableListOf<String>()
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { null }, events::add)
        try {
            val fields = mapOf("revision" to 0L, "duration" to 100.0, "position" to 10.0,
                "bufferedPosition" to 20.0, "playing" to true, "ready" to true, "buffering" to false, "seekable" to true)
            assertTrue(video.report(fields))
            val seeking = fields + mapOf("position" to 50.0, "bufferedPosition" to 50.0, "ready" to false, "buffering" to true)
            repeat(5) { assertTrue(video.report(seeking)) }
            assertTrue(video.playback.ready)
            assertEquals(listOf("playing", "loading"), events)
            assertTrue(video.report(fields + mapOf("position" to 50.0, "bufferedPosition" to 60.0)))
            assertEquals(listOf("playing", "loading", "playing"), events)
        } finally { video.close() }
    }

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
            assertEquals(0L, video.playback.info()["playbackBufferFull"])
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
