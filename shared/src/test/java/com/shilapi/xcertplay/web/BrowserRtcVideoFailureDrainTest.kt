package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.VideoCodec
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.junit.Assert.*
import org.junit.Test

class BrowserRtcVideoFailureDrainTest {
    private val avcc = byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18)
    private fun hub(owner: Any) = WebVideoHub(Executor { it.run() }).apply {
        beginStream(owner, 640, 360, 60, {}, {})
        configure(owner, VideoCodec.H264, avcc)
    }

    @Test fun terminalInvalidConfigurationWaitsForANewValidSourceBeforeResubscribing() {
        val owner = Any()
        val hub = hub(owner)
        val subscription = hub.subscribe(reliable = true)
        val failedEpoch = requireNotNull(subscription.take(0)).epoch
        hub.configure(owner, VideoCodec.H264, byteArrayOf(1))
        assertEquals(WebVideoRecords.KIND_END, requireNotNull(subscription.take(0)).kind)
        assertEquals(WebVideoRecords.KIND_END, requireNotNull(subscription.take(0)).kind)
        val worker = Executors.newSingleThreadExecutor()
        val started = CountDownLatch(1)
        try {
            val waiting = worker.submit<WebVideoHub.SourceWait> {
                started.countDown()
                hub.awaitNextConfiguration(subscription, failedEpoch, 3000)
            }
            assertTrue(started.await(3, TimeUnit.SECONDS))
            assertThrows(TimeoutException::class.java) { waiting.get(100, TimeUnit.MILLISECONDS) }
            hub.configure(owner, VideoCodec.H264, avcc)
            assertEquals(WebVideoHub.SourceWait.CONFIGURED, waiting.get(3, TimeUnit.SECONDS))
            val resumed = requireNotNull(hub.resumeAfterFailure(subscription))
            try {
                val next = requireNotNull(resumed.take(0))
                assertEquals(WebVideoRecords.KIND_CONFIG, next.kind)
                assertNotEquals(failedEpoch, next.epoch)
                assertTrue(BrowserRtcSourceRateRecovery.recoverOnNewSource("video-keyframe-timeout", failedEpoch, true, next.epoch))
            } finally { resumed.close() }
        } finally { subscription.close(); worker.shutdownNow() }
    }

    @Test fun overloadDoesNotReopenTheSameFailedEpoch() {
        val owner = Any()
        val hub = hub(owner)
        val subscription = hub.subscribe(reliable = true)
        val failedEpoch = requireNotNull(subscription.take(0)).epoch
        subscription.end("reliable-overload")
        assertEquals(WebVideoHub.SourceWait.WAITING, hub.awaitNextConfiguration(subscription, failedEpoch, 0))
        val next = avcc.copyOf().apply { this[3] = 0x29; this[11] = 0x29 }
        hub.configure(owner, VideoCodec.H264, next)
        assertEquals(WebVideoHub.SourceWait.CONFIGURED, hub.awaitNextConfiguration(subscription, failedEpoch, 0))
        requireNotNull(hub.resumeAfterFailure(subscription)).close()
    }

    @Test fun aRetiredBrowserCannotTakeTheSubscriptionFromItsReplacement() {
        val owner = Any()
        val hub = hub(owner)
        val old = hub.subscribe(reliable = true)
        val failedEpoch = requireNotNull(old.take(0)).epoch
        old.end("reliable-overload")
        val replacement = hub.subscribe(reliable = true)
        try {
            assertEquals(WebVideoHub.SourceWait.REPLACED, hub.awaitNextConfiguration(old, failedEpoch, 0))
            assertNull(hub.resumeAfterFailure(old))
            assertEquals(WebVideoRecords.KIND_CONFIG, requireNotNull(replacement.take(0)).kind)
        } finally { replacement.close() }
    }
}
