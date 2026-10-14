package com.shilapi.xcertplay

import android.os.Looper
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.web.AirPlayBrowserPlayback
import java.time.Duration
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class AirPlayCastPlayerSeekTest {
    @Test fun iphoneSpeedAndPauseReachTheBrowserWithoutReplacingACoalescedSeek() {
        TeslaBrowserLink.resetForTest()
        val player = AirPlayCastPlayer({ null }) {}
        player.setOutputAllowed(true)
        try {
            player.play(ReceiverPlay("http://example.test/video.mp4", 0.0, false))
            shadowOf(Looper.getMainLooper()).idle()
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            val fields = mapOf("revision" to 0L, "duration" to 100.0, "position" to 20.0,
                "bufferedPosition" to 30.0, "playing" to true, "ready" to true, "buffering" to false,
                "seekable" to true, "rate" to 1.0)
            assertTrue(AirPlayBrowserPlayback.report(id, fields))
            player.seek(80.0)
            player.rate(1.5)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(80.0, player.state.position, 0.0)
            assertEquals(1.5, AirPlayBrowserPlayback.snapshot()!!["rate"])
            assertEquals(1L, AirPlayBrowserPlayback.snapshot()!!["revision"])
            assertEquals(0L, AirPlayBrowserPlayback.snapshot()!!["seekRevision"])
            assertFalse(AirPlayBrowserPlayback.report(id, fields))
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150))
            assertEquals(2L, AirPlayBrowserPlayback.snapshot()!!["revision"])
            assertEquals(1L, AirPlayBrowserPlayback.snapshot()!!["seekRevision"])
            assertEquals(80.0, AirPlayBrowserPlayback.snapshot()!!["target"])
            assertTrue(AirPlayBrowserPlayback.report(id, fields + mapOf("revision" to 2L, "position" to 82.0,
                "bufferedPosition" to 90.0, "rate" to 1.5)))
            assertEquals(1.5, player.state.rate, 0.0)
            player.rate(0.0)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(false, AirPlayBrowserPlayback.snapshot()!!["playing"])
            assertEquals(1.5, AirPlayBrowserPlayback.snapshot()!!["rate"])
            assertEquals(1L, AirPlayBrowserPlayback.snapshot()!!["seekRevision"])
            assertTrue(AirPlayBrowserPlayback.report(id, fields + mapOf("revision" to 3L, "position" to 82.0,
                "bufferedPosition" to 90.0, "playing" to false, "rate" to 1.5)))
            assertEquals(0.0, player.state.rate, 0.0)
            player.rate(Double.NaN)
            player.rate(4.01)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(3L, AirPlayBrowserPlayback.snapshot()!!["revision"])
        } finally {
            player.close()
            shadowOf(Looper.getMainLooper()).idle()
            TeslaBrowserLink.resumeCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            TeslaBrowserLink.resetForTest()
        }
    }

    @Test fun receiverReadbackChangesBeforeMainDispatchWhileSliderBurstsStillCoalesce() {
        TeslaBrowserLink.resetForTest()
        val player = AirPlayCastPlayer({ null }) {}
        player.setOutputAllowed(true)
        try {
            player.play(ReceiverPlay("http://example.test/video.mp4", 0.0, false))
            shadowOf(Looper.getMainLooper()).idle()
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            val fields = mapOf("revision" to 0L, "duration" to 100.0, "position" to 20.0,
                "bufferedPosition" to 30.0, "playing" to true, "ready" to true, "buffering" to false, "seekable" to true)
            assertTrue(AirPlayBrowserPlayback.report(id, fields))
            player.seek(40.0)
            player.seek(80.0)
            assertEquals("The next iPhone GET must see the target before any posted main task runs", 80.0, player.state.position, 0.0)
            assertEquals(0L, AirPlayBrowserPlayback.snapshot()!!["revision"])
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(149))
            assertEquals(0L, AirPlayBrowserPlayback.snapshot()!!["revision"])
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1))
            assertEquals(1L, AirPlayBrowserPlayback.snapshot()!!["revision"])
            assertEquals(80.0, AirPlayBrowserPlayback.snapshot()!!["target"])
            assertTrue(AirPlayBrowserPlayback.report(id, fields + mapOf("revision" to 1L,
                "position" to 82.0, "bufferedPosition" to 90.0)))
            assertEquals(82.0, player.state.position, 0.0)
        } finally {
            player.close()
            shadowOf(Looper.getMainLooper()).idle()
            TeslaBrowserLink.resumeCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            TeslaBrowserLink.resetForTest()
        }
    }
}
