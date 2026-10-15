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
    private fun withPlayer(test: (AirPlayCastPlayer, MutableList<Pair<String, Long>>) -> Unit) {
        TeslaBrowserLink.resetForTest()
        val events = mutableListOf<Pair<String, Long>>()
        val player = AirPlayCastPlayer({ null }) { event, epoch -> events += event to epoch }
        try { test(player, events) } finally {
            player.close()
            shadowOf(Looper.getMainLooper()).idle()
            TeslaBrowserLink.resumeCarPlayDisplay()
            TeslaBrowserLink.resetForTest()
        }
    }

    private fun readyVideo(player: AirPlayCastPlayer): Long {
        assertTrue(player.play(ReceiverPlay("http://example.test/old.mp4", 0.0, false)))
        shadowOf(Looper.getMainLooper()).idle()
        val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        assertTrue(AirPlayBrowserPlayback.report(id, readyReport()))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(player.state.ready)
        return id
    }

    private fun replacementVideo(start: Double = 3.0) =
        ReceiverPlay("http://192.0.2.7/replacement.mp4", start, false, iphoneHost = "192.0.2.7")

    private fun readyReport(): Map<String, Any> = mapOf("revision" to 0L, "duration" to 100.0,
        "position" to 20.0, "bufferedPosition" to 30.0, "playing" to true, "ready" to true,
        "buffering" to false, "seekable" to true, "rate" to 1.0)

    @Test fun iphoneSpeedAndPauseReachTheBrowserWithoutReplacingACoalescedSeek() {
        TeslaBrowserLink.resetForTest()
        val player = AirPlayCastPlayer({ null }) { _, _ -> }
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
            TeslaBrowserLink.resetForTest()
        }
    }

    @Test fun receiverReadbackChangesBeforeMainDispatchWhileSliderBurstsStillCoalesce() {
        TeslaBrowserLink.resetForTest()
        val player = AirPlayCastPlayer({ null }) { _, _ -> }
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
            TeslaBrowserLink.resetForTest()
        }
    }

    @Test fun anOldBrowserTerminalReportQueuedBeforeAReplacementCannotEndTheNewItem() {
        for (terminal in listOf("ended", "failed")) withPlayer { player, events ->
            val oldId = readyVideo(player)
            events.clear()
            assertTrue(AirPlayBrowserPlayback.report(oldId, readyReport() + mapOf(terminal to true)))
            assertTrue(player.play(replacementVideo()))
            val replacementEpoch = player.playbackEpoch
            assertFalse("The iPhone must not read the retired item's ready state", player.state.ready)
            shadowOf(Looper.getMainLooper()).idle()
            val replacement = AirPlayBrowserPlayback.snapshot()!!
            assertNotEquals(oldId, replacement["id"])
            assertEquals("http://192.0.2.7/replacement.mp4", replacement["directUrl"])
            assertEquals(true, replacement["playing"])
            assertEquals(listOf("loading" to replacementEpoch), events)
            assertFalse(AirPlayBrowserPlayback.report(oldId, readyReport()))
        }
    }

    @Test fun oldBrowserControlsAcceptedBeforeAReplacementCannotChangeOrStopTheNewItem() {
        for ((action, value) in listOf("stop" to null, "pause" to null, "seek" to 80.0, "rate" to 2.0)) {
            withPlayer { player, events ->
                val oldId = readyVideo(player)
                events.clear()
                assertTrue(AirPlayBrowserPlayback.command(oldId, action, value))
                assertTrue(player.play(replacementVideo()))
                val replacementEpoch = player.playbackEpoch
                shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
                val replacement = AirPlayBrowserPlayback.snapshot()!!
                assertNotEquals(oldId, replacement["id"])
                assertEquals("http://192.0.2.7/replacement.mp4", replacement["directUrl"])
                assertEquals(true, replacement["playing"])
                assertEquals(1.0, replacement["rate"])
                assertEquals(3.0, replacement["target"])
                assertEquals(0L, replacement["revision"])
                assertEquals(listOf("loading" to replacementEpoch), events)
                assertFalse(AirPlayBrowserPlayback.command(oldId, "stop"))
            }
        }
    }

    @Test fun anOldReadyReportCannotMakeAnUndispatchedReplacementAppearReady() = withPlayer { player, events ->
        assertTrue(player.play(ReceiverPlay("http://example.test/old.mp4", 0.0, false)))
        shadowOf(Looper.getMainLooper()).idle()
        val oldId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        events.clear()
        assertTrue(AirPlayBrowserPlayback.report(oldId, readyReport()))
        assertTrue(player.state.ready)
        assertTrue(player.play(replacementVideo(0.0)))
        val replacementEpoch = player.playbackEpoch
        assertFalse(player.state.ready)
        assertTrue(player.state.buffering)
        assertEquals(0.0, player.state.duration, 0.0)
        assertEquals(0.0, player.state.position, 0.0)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("loading" to replacementEpoch), events)
        assertFalse(player.state.ready)
        val replacementId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        assertNotEquals(oldId, replacementId)
        assertTrue(AirPlayBrowserPlayback.report(replacementId, readyReport()))
        assertTrue(player.state.ready)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("playing" to replacementEpoch, events.last())
    }

    @Test fun queuedIphoneRateAndSeekCannotCarryIntoTheNextVideo() = withPlayer { player, _ ->
        readyVideo(player)
        player.seek(80.0)
        assertTrue(player.rate(2.0))
        assertTrue(player.play(replacementVideo()))
        assertFalse(player.state.ready)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
        val replacement = AirPlayBrowserPlayback.snapshot()!!
        assertEquals(1.0, replacement["rate"])
        assertEquals(3.0, replacement["target"])
        assertEquals(0L, replacement["revision"])
        assertEquals(0L, replacement["seekRevision"])
    }

    @Test fun replacingReadyVideoWithPhotoOrStandaloneAudioHidesOldStateBeforeMainDispatch() {
        for (kind in listOf("photo", "audio")) withPlayer { player, _ ->
            val oldId = readyVideo(player)
            var audioStops = 0
            assertTrue(if (kind == "photo") player.photo(byteArrayOf(-1, -40, -1, -39)) else player.audio { audioStops++ })
            assertFalse("A pending $kind must not inherit the previous video's readiness", player.state.ready)
            assertTrue(player.state.buffering)
            assertEquals(0.0, player.state.duration, 0.0)
            assertEquals(0.0, player.state.position, 0.0)
            shadowOf(Looper.getMainLooper()).idle()
            val replacement = AirPlayBrowserPlayback.snapshot()!!
            assertNotEquals(oldId, replacement["id"])
            assertEquals(kind, replacement["kind"])
            assertTrue(player.state.ready)
            assertEquals(0.0, player.state.duration, 0.0)
            assertFalse(AirPlayBrowserPlayback.command(oldId, "stop"))
            assertFalse(AirPlayBrowserPlayback.report(oldId, readyReport() + mapOf("ended" to true)))
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(replacement["id"], AirPlayBrowserPlayback.snapshot()!!["id"])
            assertEquals(0, audioStops)
        }
    }
}
