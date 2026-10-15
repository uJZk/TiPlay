package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlay
import org.junit.Assert.*
import org.junit.Test

class AirPlayVideoPlaybackTest {
    @Test fun mediaPropertiesSelectOnlyReportedTracksAndRejectUnknownStylesAndRemoteVolume() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { null }) {}
        try {
            assertFalse(video.property("selectedMediaArray", listOf(mapOf("type" to "audio", "id" to "1"))))
            assertTrue(video.report(rateReport() + ("tracks" to mapOf("audio" to listOf("1", "2"), "subtitle" to listOf("zh")))))
            assertTrue(video.property("selectedMediaArray", listOf(mapOf("type" to "audio", "id" to "2"), mapOf("type" to "subtitle", "id" to "zh"))))
            assertEquals(1L, video.source()["trackRevision"])
            assertFalse(video.property("selectedMediaArray", listOf(mapOf("type" to "subtitle", "id" to "missing"))))
            assertFalse(video.property("selectedMediaArray", listOf(mapOf("index" to 0))))
            assertFalse(video.property("textMarkupArray", listOf(mapOf("color" to "url(https://example.test)"))))
            assertFalse(video.property("textMarkupArray", listOf(mapOf("fontScale" to 5.0))))
            assertFalse(video.property("textMarkupArray", listOf(mapOf("unknown" to true))))
            assertTrue(video.property("textMarkupArray", listOf(mapOf("fontScale" to 1.5, "color" to "#F0E0D0"))))
            assertEquals(mapOf("fontScale" to 1.5, "color" to "#F0E0D0"), video.source()["textMarkup"])
            assertFalse(video.property("volume", 0.5))
            assertTrue(video.property("selectedMediaArray", listOf(mapOf("type" to "subtitle", "id" to null))))
        } finally { video.close() }
    }
    private fun rateReport(revision: Long = 0L, rate: Double = 1.0, playing: Boolean = true) =
        mapOf("revision" to revision, "duration" to 100.0, "position" to 20.0, "bufferedPosition" to 30.0,
            "rate" to rate, "playing" to playing, "ready" to true, "buffering" to false, "seekable" to true)

    @Test fun actualRateSurvivesBufferingAndPauseKeepsTheSelectedSpeed() {
        val events = mutableListOf<String>()
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { null }, events::add)
        try {
            assertTrue(video.report(rateReport(rate = 1.5)))
            assertEquals(1.5, video.playback.rate, 0.0)
            assertEquals(1.5, video.playback.info()["rate"])
            assertTrue(video.report(rateReport(rate = 1.5) + mapOf("ready" to false, "buffering" to true)))
            assertEquals(1.5, video.receiverPlayback().rate, 0.0)
            assertTrue(video.playback.ready)
            assertTrue(video.report(rateReport(rate = 2.0, playing = false)))
            assertEquals(0.0, video.playback.rate, 0.0)
            assertEquals(2.0, video.state().rate, 0.0)
            assertFalse(video.state().playing)
            assertEquals(listOf("playing", "loading", "paused"), events)
            assertTrue(video.report(rateReport(rate = 2.0) + ("ended" to true)))
            assertEquals(0.0, video.playback.rate, 0.0)
        } finally { video.close() }
    }

    @Test fun iphoneSpeedCommandsCannotUndoPendingSeekOrAcceptStaleReports() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { null }) {}
        try {
            assertTrue(video.report(rateReport()))
            video.control("seek", 80.0)
            video.control("rate", 1.5)
            video.control("rate", 0.0)
            video.control("play", null)
            assertEquals(1L, video.source()["seekRevision"])
            assertEquals(4L, video.source()["revision"])
            assertEquals(80.0, video.source()["target"])
            assertEquals(1.5, video.state().rate, 0.0)
            assertTrue(video.state().playing)
            assertFalse(video.report(rateReport(revision = 1L)))
            assertEquals(80.0, video.receiverPlayback().position, 0.0)
            assertTrue(video.report(rateReport(revision = 4L, rate = 1.5) +
                mapOf("position" to 80.0, "bufferedPosition" to 80.0, "buffering" to true)))
            assertEquals(80.0, video.receiverPlayback().position, 0.0)
            assertTrue(video.report(rateReport(revision = 4L, rate = 1.5) +
                mapOf("position" to 83.0, "bufferedPosition" to 90.0)))
            assertEquals(83.0, video.receiverPlayback().position, 0.0)
            assertEquals(1.5, video.receiverPlayback().rate, 0.0)
        } finally { video.close() }
    }

    @Test fun invalidRatesCannotMutatePlaybackAndLegacyReportsStillUseOneOrZero() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { null }) {}
        try {
            assertTrue(video.report(rateReport(rate = 1.5)))
            val accepted = video.playback
            for (rate in listOf(null, "1.5", 0.0, 0.24, 4.01, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
                assertFalse(video.report(rateReport() + ("rate" to rate)))
                assertEquals(accepted, video.playback)
            }
            for (rate in listOf(null, -1.0, 0.24, 4.01, Double.NaN, Double.POSITIVE_INFINITY)) {
                video.control("rate", rate)
                assertEquals(0L, video.source()["revision"])
                assertEquals(1.5, video.state().rate, 0.0)
            }
            for (rate in listOf(0.25, 4.0)) {
                assertTrue(video.report(rateReport(rate = rate)))
                assertEquals(rate, video.playback.rate, 0.0)
            }
            assertTrue(video.report(rateReport() - "rate"))
            assertEquals(1.0, video.playback.rate, 0.0)
            assertTrue(video.report(rateReport(playing = false) - "rate"))
            assertEquals(0.0, video.playback.rate, 0.0)
            assertEquals(1.0, video.state().rate, 0.0)
        } finally { video.close() }
    }

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
        val binding = AirPlayBrowserPlayback.register(video::state, video, control = video::control)
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
