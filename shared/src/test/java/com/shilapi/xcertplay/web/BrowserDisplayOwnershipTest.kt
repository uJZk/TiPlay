package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.VideoCodec
import java.util.concurrent.Executor
import org.junit.Assert.*
import org.junit.Test

class BrowserDisplayOwnershipTest {
    private val avcc = byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18)
    private val mirrorFrame = byteArrayOf(0, 0, 0, 1, 0x65, 7)
    private val carPlayFrame = byteArrayOf(0, 0, 0, 1, 0x65, 9)

    private fun start(sink: WebMediaSink) {
        sink.onScreenStreamActive(110, true)
        sink.onVideoCodec(110, VideoCodec.H264)
        sink.onVideoConfig(110, avcc)
    }

    private fun assertMirrorFrame(hub: WebVideoHub, mirror: WebMediaSink, browser: WebVideoSubscription) {
        mirror.onVideoFrame(110, mirrorFrame, 1L, 1L)
        val records = generateSequence { browser.take(0) }.toList()
        val frame = records.last { it.kind == WebVideoRecords.KIND_FRAME }
        assertArrayEquals(mirrorFrame, frame.payload)
        assertEquals(hub.info()!!.epoch, frame.epoch)
        assertEquals(498, hub.info()!!.width)
        assertTrue(hub.hasAirPlayDisplay())
    }

    @Test fun carPlayThenMirrorKeepsMirrorEvenAfterCarPlayRepeatsSetup() {
        val hub = WebVideoHub(Executor { it.run() })
        val carPlay = WebMediaSink(hub, 1920, 1080, 60)
        val mirror = WebMediaSink(hub, 498, 1080, 60, BrowserDisplaySource.AIRPLAY)
        start(carPlay)
        val browser = hub.subscribe()
        start(mirror)
        start(carPlay)
        carPlay.onVideoFrame(110, carPlayFrame)
        assertMirrorFrame(hub, mirror, browser)
        mirror.close(); carPlay.close(); browser.close()
    }

    @Test fun mirrorSetupReservesTheCanvasBeforeItsFirstConfigArrives() {
        val hub = WebVideoHub(Executor { it.run() })
        val mirror = WebMediaSink(hub, 720, 1280, 60, BrowserDisplaySource.AIRPLAY)
        mirror.onScreenStreamActive(110, true)
        val carPlay = WebMediaSink(hub, 1920, 1080, 60)
        start(carPlay)
        carPlay.close()
        assertTrue(hub.hasAirPlayDisplay())
        assertEquals(720, hub.info()!!.width)
        assertNull(hub.info()!!.codec)
        mirror.onScreenStreamActive(110, false)
        mirror.updateCanvas(498, 1080)
        start(mirror)
        val browser = hub.subscribe()
        assertMirrorFrame(hub, mirror, browser)
        mirror.close(); browser.close()
    }

    @Test fun repeatedActiveAfterConfigKeepsTheSameEpochAndDecodableFrames() {
        val hub = WebVideoHub(Executor { it.run() })
        val mirror = WebMediaSink(hub, 498, 1080, 60, BrowserDisplaySource.AIRPLAY)
        start(mirror)
        val epoch = hub.info()!!.epoch
        val browser = hub.subscribe()
        mirror.onScreenStreamActive(110, true)
        assertEquals(epoch, hub.info()!!.epoch)
        assertEquals("avc1.640028", hub.info()!!.codec)
        assertMirrorFrame(hub, mirror, browser)
        mirror.close(); browser.close()
    }

    @Test fun stoppingCarPlayDuringMirrorCannotIdleOrEndTheMirror() {
        val hub = WebVideoHub(Executor { it.run() })
        val carPlay = WebMediaSink(hub, 1920, 1080, 60)
        val mirror = WebMediaSink(hub, 498, 1080, 60, BrowserDisplaySource.AIRPLAY)
        start(carPlay)
        val browser = hub.subscribe()
        start(mirror)
        carPlay.onScreenStreamActive(110, false)
        carPlay.close()
        assertMirrorFrame(hub, mirror, browser)
        mirror.close(); browser.close()
    }

    @Test fun openingCarPlayDuringMirrorKeepsMirrorUntilItEndsAndCarPlayResumes() {
        val hub = WebVideoHub(Executor { it.run() })
        val mirror = WebMediaSink(hub, 498, 1080, 60, BrowserDisplaySource.AIRPLAY)
        start(mirror)
        val browser = hub.subscribe()
        val carPlay = WebMediaSink(hub, 1920, 1080, 60)
        start(carPlay)
        carPlay.onVideoFrame(110, carPlayFrame)
        assertMirrorFrame(hub, mirror, browser)
        carPlay.pauseDisplay()
        mirror.close()
        carPlay.resumeDisplay()
        assertFalse(hub.hasAirPlayDisplay())
        assertEquals(1920, hub.info()!!.width)
        carPlay.onVideoFrame(110, carPlayFrame)
        val frame = generateSequence { browser.take(0) }.last { it.kind == WebVideoRecords.KIND_FRAME }
        assertArrayEquals(carPlayFrame, frame.payload)
        carPlay.close(); browser.close()
    }
}
