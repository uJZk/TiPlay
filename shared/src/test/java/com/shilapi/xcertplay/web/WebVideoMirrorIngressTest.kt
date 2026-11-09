package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.VideoCodec
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.junit.Assert.*
import org.junit.Test

class WebVideoMirrorIngressTest {
    private val avcc = byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18)
    private fun idr() = byteArrayOf(0, 0, 0, 1, 0x65, 1, 2, 3)
    private fun hub(owner: Any, source: BrowserDisplaySource = BrowserDisplaySource.AIRPLAY,
                    timeoutMillis: Long = 3000) = WebVideoHub(Executor { it.run() }, videoReadyTimeoutMillis = timeoutMillis).apply {
        beginStream(owner, 640, 360, 60, {}, {}, source)
    }

    @Test fun initialMirrorIdrRemainsTheOriginalCurrentInputUntilMatchingVideoReady() {
        val owner = Any()
        val hub = hub(owner)
        val subscription = hub.subscribe(reliable = true, awaitVideoReady = true)
        val worker = Executors.newSingleThreadExecutor()
        val original = idr()
        try {
            hub.configure(owner, VideoCodec.H264, avcc)
            val config = requireNotNull(subscription.take(0))
            val entered = CountDownLatch(1)
            val incoming = worker.submit {
                entered.countDown()
                hub.frame(owner, original, 1_000_000_000L, 2_000_000_000L)
            }
            assertTrue(entered.await(3, TimeUnit.SECONDS))
            assertThrows(TimeoutException::class.java) { incoming.get(100, TimeUnit.MILLISECONDS) }
            assertNull(subscription.take(0))
            assertFalse(subscription.videoReady(config.epoch + 1))
            assertThrows(TimeoutException::class.java) { incoming.get(100, TimeUnit.MILLISECONDS) }
            assertTrue(subscription.videoReady(config.epoch))
            incoming.get(3, TimeUnit.SECONDS)
            val first = requireNotNull(subscription.take(0))
            assertTrue(first.keyFrame)
            assertSame(original, first.payload)
            assertArrayEquals(idr(), first.payload)
            assertEquals(0, first.sequence)
            assertEquals(0L, first.timestampUs)
        } finally { subscription.close(); worker.shutdownNow() }
    }

    @Test fun staleSubscriptionReadyCannotReleaseTheSuccessorInput() {
        val owner = Any()
        val hub = hub(owner)
        val old = hub.subscribe(reliable = true, awaitVideoReady = true)
        hub.configure(owner, VideoCodec.H264, avcc)
        val config = requireNotNull(old.take(0))
        val worker = Executors.newSingleThreadExecutor()
        try {
            val next = hub.subscribe(reliable = true, awaitVideoReady = true)
            try {
                assertEquals(config.epoch, requireNotNull(next.take(0)).epoch)
                val original = idr()
                val incoming = worker.submit { hub.frame(owner, original, 0L, 0L) }
                assertFalse(old.videoReady(config.epoch))
                assertThrows(TimeoutException::class.java) { incoming.get(100, TimeUnit.MILLISECONDS) }
                assertNull(next.take(0))
                assertTrue(next.videoReady(config.epoch))
                incoming.get(3, TimeUnit.SECONDS)
                assertSame(original, requireNotNull(next.take(0)).payload)
            } finally { next.close() }
        } finally { old.close(); worker.shutdownNow() }
    }

    @Test fun sourceAndSubscriptionRetirementBothCancelTheWaitingInput() {
        for (endSource in listOf(false, true)) {
            val owner = Any()
            val hub = hub(owner)
            val subscription = hub.subscribe(reliable = true, awaitVideoReady = true)
            val worker = Executors.newSingleThreadExecutor()
            try {
                hub.configure(owner, VideoCodec.H264, avcc)
                requireNotNull(subscription.take(0))
                val incoming = worker.submit { hub.frame(owner, idr(), 0L, 0L) }
                assertThrows(TimeoutException::class.java) { incoming.get(100, TimeUnit.MILLISECONDS) }
                if (endSource) hub.endStream(owner) else subscription.close()
                incoming.get(1, TimeUnit.SECONDS)
                assertFalse(subscription.videoReady(1))
            } finally { subscription.close(); worker.shutdownNow() }
        }
    }

    @Test fun aNewConfigurationRequiresItsOwnReadyEpoch() {
        val owner = Any()
        val hub = hub(owner)
        val subscription = hub.subscribe(reliable = true, awaitVideoReady = true)
        val worker = Executors.newSingleThreadExecutor()
        try {
            hub.configure(owner, VideoCodec.H264, avcc)
            val old = requireNotNull(subscription.take(0))
            assertTrue(subscription.videoReady(old.epoch))
            hub.configure(owner, VideoCodec.H264, avcc.copyOf().apply { this[3] = 0x29; this[11] = 0x29 })
            val next = requireNotNull(subscription.take(0))
            val original = idr()
            val incoming = worker.submit { hub.frame(owner, original, 0L, 0L) }
            assertFalse(subscription.videoReady(old.epoch))
            assertThrows(TimeoutException::class.java) { incoming.get(100, TimeUnit.MILLISECONDS) }
            assertTrue(subscription.videoReady(next.epoch))
            incoming.get(3, TimeUnit.SECONDS)
            assertSame(original, requireNotNull(subscription.take(0)).payload)
        } finally { subscription.close(); worker.shutdownNow() }
    }

    @Test fun sameSourceNativeReplacementRevokesReadinessUntilItIsReinstalled() {
        val owner = Any()
        val hub = hub(owner)
        val subscription = hub.subscribe(reliable = true, awaitVideoReady = true)
        val worker = Executors.newSingleThreadExecutor()
        try {
            hub.configure(owner, VideoCodec.H264, avcc)
            val epoch = requireNotNull(subscription.take(0)).epoch
            assertTrue(subscription.videoReady(epoch))
            assertFalse(subscription.videoPaused(epoch + 1))
            assertTrue(subscription.videoPaused(epoch))
            val original = idr()
            val incoming = worker.submit { hub.frame(owner, original, 0L, 0L) }
            assertThrows(TimeoutException::class.java) { incoming.get(100, TimeUnit.MILLISECONDS) }
            assertNull(subscription.take(0))
            assertTrue(subscription.videoReady(epoch))
            incoming.get(3, TimeUnit.SECONDS)
            assertSame(original, requireNotNull(subscription.take(0)).payload)
        } finally { subscription.close(); worker.shutdownNow() }
    }

    @Test fun readinessTimeoutIsExplicitAndDoesNotPublishTheOriginalInput() {
        val owner = Any()
        val hub = hub(owner, timeoutMillis = 20)
        val subscription = hub.subscribe(reliable = true, awaitVideoReady = true)
        try {
            hub.configure(owner, VideoCodec.H264, avcc)
            requireNotNull(subscription.take(0))
            assertThrows(WebVideoHub.VideoReadyTimeoutException::class.java) { hub.frame(owner, idr(), 0L, 0L) }
            val end = requireNotNull(subscription.take(0))
            assertEquals(WebVideoRecords.KIND_END, end.kind)
            assertEquals("video-source-ready-timeout", String(end.payload))
            assertFalse(subscription.videoReady(1))
        } finally { subscription.close() }
    }

    @Test fun aReplacementSourceWithoutConfigurationCancelsTheOldWaitingInput() {
        val owner = Any()
        val hub = hub(owner)
        val subscription = hub.subscribe(reliable = true, awaitVideoReady = true)
        val worker = Executors.newSingleThreadExecutor()
        try {
            hub.configure(owner, VideoCodec.H264, avcc)
            requireNotNull(subscription.take(0))
            val incoming = worker.submit { hub.frame(owner, idr(), 0L, 0L) }
            assertThrows(TimeoutException::class.java) { incoming.get(100, TimeUnit.MILLISECONDS) }
            hub.beginStream(Any(), 640, 360, 60, {}, {}, BrowserDisplaySource.AIRPLAY)
            incoming.get(1, TimeUnit.SECONDS)
            assertEquals(WebVideoRecords.KIND_IDLE, requireNotNull(subscription.take(0)).kind)
            assertNull(subscription.take(0))
        } finally { subscription.close(); worker.shutdownNow() }
    }

    @Test fun carPlayInputNeverWaitsAtTheMirrorReadinessBarrier() {
        val owner = Any()
        val hub = hub(owner, BrowserDisplaySource.CARPLAY, timeoutMillis = 0)
        val subscription = hub.subscribe(reliable = true, awaitVideoReady = true)
        try {
            hub.configure(owner, VideoCodec.H264, avcc)
            requireNotNull(subscription.take(0))
            val original = idr()
            hub.frame(owner, original, 0L, 0L)
            assertSame(original, requireNotNull(subscription.take(0)).payload)
        } finally { subscription.close() }
    }
}
