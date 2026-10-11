package com.shilapi.xcertplay.web

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executor
import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.media.BrowserOnlyMediaSink
import org.junit.Assert.*
import org.junit.Test

class WebDebugTimingTest {
    private fun frame(capture: Long?) = WebVideoRecord(2, 1, 1, 7, 3, 99, byteArrayOf(1, 2), captureNanos = capture)

    @Test fun timingPreservesFrameIdentityAndDoesNotChangeVideoPayload() {
        val frame = frame(1_000_000_000)
        val timing = WebDebugTiming.record(frame.withFlags(2), 1_050_000_000)!!
        assertEquals(5, timing.kind)
        assertEquals(frame.epoch, timing.epoch)
        assertEquals(frame.sequence, timing.sequence)
        assertEquals(frame.timestampUs, timing.timestampUs)
        assertEquals(1000.0, ByteBuffer.wrap(timing.payload).order(ByteOrder.LITTLE_ENDIAN).double, 0.0)
        assertArrayEquals(byteArrayOf(1, 2), frame.payload)
    }

    @Test fun missingFutureAndStaleMediaClocksProduceNoTimingRecord() {
        assertNull(WebDebugTiming.record(frame(null), 100))
        assertNull(WebDebugTiming.record(frame(101), 100))
        assertNull(WebDebugTiming.record(frame(100), 10_000_000_101))
        assertNull(WebDebugTiming.record(WebVideoRecords.HEARTBEAT, 100))
    }

    @Test fun browserProductRoutesTheSynchronizedPhoneClockIntoQueuedFrames() {
        val hub = WebVideoHub(Executor { it.run() })
        val sink = BrowserOnlyMediaSink(object : MediaSink {}, WebMediaSink(hub, 800, 480, 60))
        sink.setVideoClockHandler(110) { it - 1000 }
        sink.onScreenStreamActive(110, true)
        sink.onVideoCodec(110, VideoCodec.H264)
        sink.onVideoConfig(110, byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18))
        val subscription = hub.subscribe()
        subscription.take(0) // config
        sink.onVideoFrame(110, byteArrayOf(0, 0, 0, 1, 0x65, 1), 2000, 3000)
        assertEquals(1000L, subscription.take(0)!!.captureNanos)
        sink.onScreenStreamActive(110, false)
    }
}
