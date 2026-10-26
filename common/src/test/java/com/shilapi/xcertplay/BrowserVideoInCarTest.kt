package com.shilapi.xcertplay

import android.os.Looper
import com.shilapi.xcertplay.airplay.VideoInCar
import com.shilapi.xcertplay.web.AirPlayBrowserPlayback
import java.time.Duration
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class BrowserVideoInCarTest {
    private val replies = LinkedBlockingQueue<Map<String, Any?>>()
    private lateinit var video: BrowserVideoInCar

    @Before fun setup() {
        TeslaBrowserLink.resetForTest()
        VideoInCar.allowed = true
        video = BrowserVideoInCar { _, message -> replies.offer(message); true }
    }

    @After fun cleanup() {
        video.onVideoSessionEnded()
        idle()
        VideoInCar.allowed = false
        TeslaBrowserLink.resetForTest()
    }

    private fun idle() { shadowOf(Looper.getMainLooper()).idle() }
    private fun message(type: String, fields: Map<String, Any?> = emptyMap()) {
        video.onVideoMessage(7L, mapOf("type" to type) + fields)
        idle()
    }
    private fun insert(url: String = "https://example.test/video.mp4") = message("insertPlayQueueItem",
        mapOf("item" to mapOf("uuid" to "one", "Content-Location" to url, "Start-Position-Seconds" to 12.0)))

    @Test fun iphoneControlsReachBrowserAndSessionEndRemovesEntry() {
        insert()
        assertNull(AirPlayBrowserPlayback.snapshot())
        message("setRate", mapOf("rate" to 1.0))
        assertEquals(12.0, AirPlayBrowserPlayback.snapshot()!!["target"])
        message("seek", mapOf("time" to VideoInCar.cmTime(30.0), "kind" to "request", "messageID" to 10L))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
        assertEquals(30.0, AirPlayBrowserPlayback.snapshot()!!["target"])
        val response = replies.poll(2, TimeUnit.SECONDS)!!
        assertEquals("response", response["kind"])
        assertEquals(10L, response["messageID"])
        message("setRate", mapOf("rate" to 0.0))
        assertEquals(false, AirPlayBrowserPlayback.snapshot()!!["playing"])
        video.onVideoSessionEnded(); idle()
        assertNull(AirPlayBrowserPlayback.snapshot())
    }

    @Test fun replacementAndStopRetireTheOldBrowserResource() {
        insert(); message("setRate", mapOf("rate" to 1.0))
        val oldId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        insert("https://example.test/new.mp4")
        assertNull(AirPlayBrowserPlayback.video(oldId))
        message("setRate", mapOf("rate" to 1.0))
        assertNotEquals(oldId, AirPlayBrowserPlayback.snapshot()!!["id"])
        message("stop")
        assertNull(AirPlayBrowserPlayback.snapshot())
    }

    @Test fun seekImmediatelyAfterStartSurvivesQueuedPlayerCreation() {
        insert()
        video.onVideoMessage(7L, mapOf("type" to "setRate", "rate" to 1.0))
        video.onVideoMessage(7L, mapOf("type" to "seek", "time" to VideoInCar.cmTime(45.0)))
        idle()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
        assertEquals(45.0, AirPlayBrowserPlayback.snapshot()!!["target"])
    }

    @Test fun unsupportedLocalItemReportsFailureWithoutOpeningPlayer() {
        insert("file:///private/movie.mp4")
        assertEquals("error", replies.poll(2, TimeUnit.SECONDS)!!["type"])
        message("setRate", mapOf("rate" to 1.0))
        assertNull(AirPlayBrowserPlayback.snapshot())
    }
}
