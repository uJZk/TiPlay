package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.EncodedImage
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoEncoder
import org.webrtc.VideoFrame
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class BrowserRtcVideoInputTest {
    @Test fun inputWaitsForTheOutputCallbackButNotTheRetainedScreenBuffer() {
        val callbackEntered = CountDownLatch(1)
        val finishCallback = CountDownLatch(1)
        Fixture(outputCallback = {
            callbackEntered.countDown()
            assertTrue(finishCallback.await(2, TimeUnit.SECONDS))
        }).use { f ->
            assertTrue(f.bridge.offer(f.frame(0, true)))
            val input = f.held.single()
            val waiter = f.waiter()
            assertBlocked(waiter)
            assertEquals("ready", f.bridge.diagnostics()["selection"])
            val encoding = f.executor.submit<VideoCodecStatus> { f.encoder.encode(input, f.encodeInfo) }
            assertTrue(callbackEntered.await(2, TimeUnit.SECONDS))
            assertEquals(1L, f.counter("encoderInputsInFlight"))
            assertBlocked(waiter)
            finishCallback.countDown()
            assertEquals(VideoCodecStatus.OK, encoding.get(2, TimeUnit.SECONDS))
            assertTrue(waiter.get(2, TimeUnit.SECONDS))
            assertEquals(0L, f.counter("encoderInputsInFlight"))
            assertEquals(1L, f.counter("pendingFrames")) // Zero-hertz may retain this encoded buffer.
            assertArrayEquals(f.frame(0, true).payload, f.output.single())
            assertEquals(VideoCodecStatus.NO_OUTPUT, f.encoder.encode(input, f.encodeInfo))
            assertEquals(0L, f.counter("encoderInputsInFlight"))
            f.releaseHeld()
            assertEquals(0L, f.counter("encoderInputsInFlight"))
            assertEquals(0L, f.counter("pendingFrames"))
            assertTrue(f.bridge.awaitInput(0))
        }
    }

    @Test fun unencodedReleasePublishesDependencyLossBeforeWakingTheNextCapture() {
        val recoveryEntered = CountDownLatch(1)
        val finishRecovery = CountDownLatch(1)
        Fixture(requestKeyFrame = {
            recoveryEntered.countDown()
            assertTrue(finishRecovery.await(2, TimeUnit.SECONDS))
        }).use { f ->
            assertTrue(f.bridge.offer(f.frame(0, true)))
            val waiter = f.waiter()
            val input = f.held.removeAt(0)
            val release = f.executor.submit { input.release() }
            assertTrue(recoveryEntered.await(2, TimeUnit.SECONDS))
            assertEquals(true, f.bridge.flowDiagnostics()["waitingForKey"])
            assertEquals(1L, f.counter("lossEvents"))
            assertEquals(1L, f.counter("encoderInputsInFlight"))
            assertEquals(1L, f.counter("pendingFrames"))
            assertBlocked(waiter)
            finishRecovery.countDown()
            release.get(2, TimeUnit.SECONDS)
            assertTrue(waiter.get(2, TimeUnit.SECONDS))
            assertTrue(f.bridge.offer(f.frame(16_667)))
            assertEquals(1L, f.counter("awaitingKeyFrames"))
            assertTrue(f.held.isEmpty())
            assertEquals(0L, f.counter("encoderInputsInFlight"))
        }
    }

    @Test fun failedRecoveryRequestCannotStrandTheInputPermitOrByteAccounting() = Fixture(
        requestKeyFrame = { throw IllegalStateException("recovery retired") },
    ).use { f ->
        assertTrue(f.bridge.offer(f.frame(0, true)))
        val waiter = f.waiter()
        val input = f.held.removeAt(0)
        assertThrows(IllegalStateException::class.java) { input.release() }
        assertTrue(waiter.get(2, TimeUnit.SECONDS))
        assertEquals(true, f.bridge.flowDiagnostics()["waitingForKey"])
        assertEquals(1L, f.counter("lossEvents"))
        assertEquals(1L, f.counter("releasedUnencodedFrames"))
        assertEquals(0L, f.counter("encoderInputsInFlight"))
        assertEquals(0L, f.counter("pendingFrames"))
        assertEquals(0L, f.counter("pendingBytes"))
    }

    @Test fun failedOutputCallbackReleasesThePermitEvenWhileItsInputBufferIsRetained() = Fixture(
        outputCallback = { throw IllegalStateException("native callback retired") },
    ).use { f ->
        assertTrue(f.bridge.offer(f.frame(0, true)))
        val waiter = f.waiter()
        assertEquals(VideoCodecStatus.OK, f.encoder.encode(f.held.single(), f.encodeInfo))
        assertFalse(waiter.get(2, TimeUnit.SECONDS))
        assertEquals("encoded-video-rejected", f.bridge.failure)
        assertEquals(0L, f.counter("encoderInputsInFlight"))
        assertEquals(1L, f.counter("pendingFrames"))
        f.releaseHeld()
        assertEquals(0L, f.counter("encoderInputsInFlight"))
        assertEquals(0L, f.counter("pendingFrames"))
    }

    @Test fun staleEncoderPublishesUnconsumedReferenceLossBeforeCompletionAndOnlyOnce() = Fixture().use { f ->
        assertTrue(f.bridge.offer(f.frame(0, true)))
        val waiter = f.waiter()
        f.encoder.release()
        assertEquals(VideoCodecStatus.NO_OUTPUT, f.encoder.encode(f.held.single(), f.encodeInfo))
        assertTrue(waiter.get(2, TimeUnit.SECONDS))
        assertEquals(true, f.bridge.flowDiagnostics()["waitingForKey"])
        assertEquals(1L, f.counter("lossEvents"))
        assertEquals(0L, f.counter("encoderInputsInFlight"))
        assertEquals(1L, f.counter("pendingFrames"))
        f.releaseHeld()
        assertEquals(1L, f.counter("lossEvents"))
        assertEquals(1L, f.counter("releasedUnencodedFrames"))
        assertEquals(0L, f.counter("encoderInputsInFlight"))
    }

    @Test fun timeoutIsBoundedAndCloseOrDisableWakesWaitersWithoutWaitingForNativeRelease() {
        for (close in listOf(false, true)) Fixture().use { f ->
            assertTrue(f.bridge.offer(f.frame(0, true)))
            val started = System.nanoTime()
            assertFalse(f.bridge.awaitInput(40))
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 2_000)
            val waiter = f.waiter()
            assertBlocked(waiter)
            if (close) f.bridge.close() else f.bridge.disable("test-retired")
            assertFalse(waiter.get(2, TimeUnit.SECONDS))
            assertEquals(1L, f.counter("encoderInputsInFlight"))
            f.releaseHeld()
            assertEquals(0L, f.counter("encoderInputsInFlight"))
            assertFalse(f.bridge.awaitInput(0))
        }
    }

    @Test fun interruptStopsTheWaitAndPreservesTheThreadsInterruptStatus() = Fixture().use { f ->
        assertTrue(f.bridge.offer(f.frame(0, true)))
        assertTrue(f.executor.submit<Boolean> {
            Thread.currentThread().interrupt()
            try { !f.bridge.awaitInput(1_000) && Thread.currentThread().isInterrupted }
            finally { Thread.interrupted() }
        }.get(2, TimeUnit.SECONDS))
        assertEquals(1L, f.counter("encoderInputsInFlight"))
    }

    private fun assertBlocked(waiter: Future<Boolean>) {
        assertThrows(TimeoutException::class.java) { waiter.get(50, TimeUnit.MILLISECONDS) }
    }

    private class Fixture(
        requestKeyFrame: () -> Unit = {},
        outputCallback: (EncodedImage) -> Unit = {},
    ) : AutoCloseable {
        val executor = Executors.newCachedThreadPool()
        val held = mutableListOf<VideoFrame>()
        val output = mutableListOf<ByteArray>()
        val encodeInfo = VideoEncoder.EncodeInfo(emptyArray())
        private val codec = BrowserRtcVideoPolicy.Codec("H264", mapOf(
            "packetization-mode" to "1", "profile-level-id" to "42e02a"))
        val bridge = BrowserRtcVideoTrack(listOf(codec), requestKeyFrame, captureFrame = { it.retain(); held.add(it) })
        val encoder = requireNotNull(bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
        init {
            assertEquals(VideoCodecStatus.OK, encoder.initEncode(VideoEncoder.Settings(1, 640, 360, 4_000, 60, 1, false),
                VideoEncoder.Callback { image, _ ->
                    outputCallback(image)
                    output.add(ByteArray(image.buffer.remaining()).also { image.buffer.duplicate().get(it) })
                }))
            assertTrue(bridge.configure(WebVideoRecord(WebVideoRecords.KIND_CONFIG, 0, WebVideoRecords.CODEC_H264, 0, 1, 0,
                WebJson.write(mapOf("codec" to "avc1.42e028", "width" to 640, "height" to 360, "fps" to 60)).toByteArray())))
        }
        fun frame(timeUs: Long, key: Boolean = false) = WebVideoRecord(WebVideoRecords.KIND_FRAME,
            if (key) WebVideoRecords.FLAG_KEY_FRAME else 0, WebVideoRecords.CODEC_H264, 0, 1, timeUs,
            byteArrayOf(0, 0, 0, 1, if (key) 0x65 else 0x41, 0xe0.toByte()))
        fun counter(name: String) = (bridge.flowDiagnostics().getValue(name) as Number).toLong()
        fun waiter(): Future<Boolean> {
            val entered = CountDownLatch(1)
            val future = executor.submit<Boolean> { entered.countDown(); bridge.awaitInput(5_000) }
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            return future
        }
        fun releaseHeld() { held.removeAt(0).release() }
        override fun close() {
            bridge.close()
            held.forEach(VideoFrame::release)
            executor.shutdownNow()
        }
    }
}
