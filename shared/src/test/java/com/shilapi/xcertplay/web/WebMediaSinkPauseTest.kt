package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.VideoCodec
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.Executor

class WebMediaSinkPauseTest {
    private val avcc = byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18)

    @Test fun airplayCanBorrowTheCanvasAndCarPlayReturnsWithConfigAndKeyframeRequest() {
        val hub = WebVideoHub(Executor { it.run() })
        val carPlay = WebMediaSink(hub, 1920, 1080, 60)
        var requested = 0
        carPlay.setVideoRecoveryHandler(110) { requested++ }
        carPlay.onScreenStreamActive(110, true)
        carPlay.onVideoCodec(110, VideoCodec.H264)
        carPlay.onVideoConfig(110, avcc)
        carPlay.pauseDisplay()
        val airPlay = WebMediaSink(hub, 720, 1280, 60)
        airPlay.onScreenStreamActive(110, true)
        airPlay.onVideoCodec(110, VideoCodec.H264); airPlay.onVideoConfig(110, avcc)
        // Repeated CarPlay SETUP/config and delayed frames must not steal the display while paused.
        carPlay.onScreenStreamActive(110, true); carPlay.onVideoConfig(110, avcc)
        assertEquals(720, hub.info()!!.width)
        airPlay.close()
        carPlay.resumeDisplay()
        assertEquals(1920, hub.info()!!.width)
        assertEquals("avc1.640028", hub.info()!!.codec)
        assertEquals(1, requested)
        carPlay.resumeDisplay(); assertEquals(1, requested)
        airPlay.close(); assertEquals(1920, hub.info()!!.width)
    }

    @Test fun closedOrTornDownCarPlayCannotReturnFromPause() {
        val hub = WebVideoHub(Executor { it.run() })
        val sink = WebMediaSink(hub, 1920, 1080, 60)
        sink.onScreenStreamActive(110, true); sink.pauseDisplay(); sink.close(); sink.resumeDisplay()
        assertNull(hub.info())
        val next = WebMediaSink(hub, 1920, 1080, 60)
        next.onScreenStreamActive(110, true); next.pauseDisplay(); next.onScreenStreamActive(110, false); next.resumeDisplay()
        assertNull(hub.info())
    }
}
