package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverPlay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AirPlayVideoBorrowGateTest {
    @Test fun waitingForOwnershipPausesOutputButPreservesPhonePlaybackAndSeekIntent() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.25, true), { _, _ -> null }) {}
        try {
            video.setOutputAllowed(false)
            assertFalse(video.state().playing)
            assertEquals(false, video.source()["outputAllowed"])
            val gatedRevision = video.source()["revision"] as Long
            assertTrue(video.report(report(gatedRevision, playing = false)))
            video.setOutputAllowed(true)
            assertTrue(video.state().playing)
            assertEquals(0L, video.source()["seekRevision"])
            assertEquals(0.25, video.source()["target"])
            assertEquals(true, video.source()["fraction"])
            assertFalse(video.report(report(gatedRevision, playing = false)))
            assertTrue(video.state().playing)
        } finally { video.close() }
    }

    @Test fun aPhonePauseDuringTheLoanRemainsPausedWhenOwnershipReturns() {
        val video = AirPlayVideoPlayback(ReceiverPlay("http://example.test/video.mp4", 0.0, false), { _, _ -> null }) {}
        try {
            video.setOutputAllowed(false)
            video.control("pause", null)
            val revision = video.source()["revision"] as Long
            assertTrue(video.report(report(revision, playing = false)))
            video.setOutputAllowed(true)
            assertFalse(video.state().playing)
            video.control("play", null)
            assertTrue(video.state().playing)
        } finally { video.close() }
    }

    private fun report(revision: Long, playing: Boolean) = mapOf(
        "revision" to revision, "duration" to 100.0, "position" to 25.0,
        "bufferedPosition" to 35.0, "rate" to 1.0, "playing" to playing,
        "ready" to true, "buffering" to false, "seekable" to true,
    )
}
