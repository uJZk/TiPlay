package com.shilapi.xcertplay.web

import java.util.concurrent.CountDownLatch
import org.junit.Assert.*
import org.junit.Test

class BrowserRtcSourceRateGuardTest {
    @Test fun rejectsMissingChangedAndFailedEpochs() {
        val guard = BrowserRtcSourceRateGuard()
        val first = Any()
        val second = Any()
        val bridge = Any()
        assertEquals("video-source-rate-epoch-pending", guard.inspect(1, first, bridge, 0, 0, 1L))
        assertEquals("video-source-rate-epoch-unavailable", guard.inspect(1, first, bridge, 0, 0, 6_000_000_001L))
        assertNull(guard.inspect(1, first, bridge, 7, 0))
        assertEquals("video-source-rate-send-failed", guard.inspect(1, first, bridge, 7, 7))
        assertEquals("video-source-rate-status-mismatch", guard.inspect(2, second, bridge, 9, 7))
        assertNull(guard.inspect(2, second, bridge, 9, 0))
        assertEquals("video-source-rate-epoch-changed", guard.inspect(2, second, bridge, 10, 0))
    }

    @Test fun pendingDeadlineIsIndependentForEachGeneration() {
        val guard = BrowserRtcSourceRateGuard()
        val sender = Any()
        val bridge = Any()
        assertEquals("video-source-rate-epoch-pending", guard.inspect(1, sender, bridge, 0, 0, 1L))
        assertEquals("video-source-rate-epoch-unavailable", guard.inspect(1, sender, bridge, 0, 0, 6_000_000_001L))
        assertEquals("video-source-rate-epoch-pending", guard.inspect(2, sender, bridge, 0, 0, 6_000_000_002L))
        assertNull(guard.inspect(2, sender, bridge, 8, 0, 6_000_000_003L))
    }

    @Test fun sourceEndBeforeOfferRetainsAnnouncedSnapshotWithoutResurrectingCurrent() {
        val source = BrowserRtcPendingVideoSource<String>()
        assertTrue(source.pause("old") { true })
        assertFalse(source.pause(null) { false })
        var offered: String? = null
        assertTrue(source.claim { offered = it })
        assertEquals("old", offered)
        assertNull(source.current()) // The negotiated snapshot does not revive old frames.
        source.update("new")
        assertEquals("new", source.current())
    }

    @Test fun sourceEndAfterOfferLeavesCurrentIdleAndNewSourceAvailable() {
        val source = BrowserRtcPendingVideoSource<String>()
        assertTrue(source.pause("old") { true })
        var offered: String? = null
        assertTrue(source.claim { offered = it })
        assertFalse(source.pause(null) { false })
        assertEquals("old", offered)
        assertNull(source.current())
        source.update("new")
        assertEquals("new", source.current())
    }

    @Test fun concurrentOfferAndEndAreSerializedInBothOrders() {
        fun runCase(endFirst: Boolean) {
            val source = BrowserRtcPendingVideoSource<String>()
            assertTrue(source.pause("old") { true })
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            val competing = CountDownLatch(1)
            val chosen = java.util.concurrent.atomic.AtomicReference<String>()
            val first = Thread {
                if (endFirst) source.pause(null) { entered.countDown(); release.await(); false }
                else source.claim { chosen.set(it); entered.countDown(); release.await() }
            }
            first.start()
            entered.await()
            val second = Thread {
                competing.countDown()
                if (endFirst) source.claim { chosen.set(it) } else source.pause(null) { false }
            }
            second.start()
            competing.await()
            release.countDown()
            first.join(2000); second.join(2000)
            assertFalse(first.isAlive); assertFalse(second.isAlive)
            assertEquals("old", chosen.get())
            assertNull(source.current())
            source.update("new")
            assertEquals("new", source.current())
        }
        runCase(true)
        runCase(false)
    }

    @Test fun nextSourceWinsOverOldFailureInSamePumpTurn() {
        assertTrue(BrowserRtcSourceRateRecovery.sourceTransition(true, false, false, 1, 2, null))
        assertTrue(BrowserRtcSourceRateRecovery.sourceTransition(false, false, true, 1, 1, "source-ended"))
        assertTrue(BrowserRtcSourceRateRecovery.sourceTransition(false, false, true, 1, 1, "source-changed"))
        assertTrue(BrowserRtcSourceRateRecovery.sourceTransition(false, true, false, 1, 1, null))
        assertFalse(BrowserRtcSourceRateRecovery.sourceTransition(true, false, false, 1, 1, null))
        assertFalse(BrowserRtcSourceRateRecovery.sourceTransition(false, false, true, 1, 1, "decoder-failed"))
    }

    @Test fun retryIsBoundedAndNeedsCurrentConfiguration() {
        val recovery = BrowserRtcSourceRateRecovery()
        assertFalse(recovery.shouldRetry("video-source-rate-send-failed", false))
        assertFalse(recovery.shouldRetry("video-source-rate-epoch-unavailable", true))
        assertTrue(recovery.shouldRetry("video-source-rate-send-failed", true))
        assertFalse(recovery.shouldRetry("video-source-rate-send-failed", true))
    }

    @Test fun failedSnapshotSampledBeforeReplacementCannotRecoverOrFailNewTrack() {
        val lease = BrowserRtcVideoLease()
        val guard = BrowserRtcSourceRateGuard()
        val recovery = BrowserRtcSourceRateRecovery()
        val oldSender = Any()
        val oldBridge = Any()
        val sender = java.util.concurrent.atomic.AtomicReference(oldSender)
        val bridge = java.util.concurrent.atomic.AtomicReference(oldBridge)
        val sampled = CountDownLatch(1)
        val resume = CountDownLatch(1)
        val applied = java.util.concurrent.atomic.AtomicBoolean(false)
        val worker = Thread {
            val status = longArrayOf(7, 7) // A completed, atomic JNI snapshot.
            sampled.countDown()
            resume.await()
            val reason = guard.inspect(1, oldSender, oldBridge, status[0], status[1])
            lease.runIfReady(1) {
                if (sender.get() === oldSender && bridge.get() === oldBridge && reason != null) {
                    recovery.shouldRetry(reason, true)
                    applied.set(true)
                }
            }
        }
        worker.start()
        sampled.await()
        lease.pause()
        lease.offer(2)
        sender.set(Any())
        bridge.set(Any())
        lease.answered()
        assertTrue(lease.ready(2))
        resume.countDown()
        worker.join()
        assertFalse(applied.get())
        assertTrue(recovery.shouldRetry("video-source-rate-send-failed", true))
    }

    @Test fun lateResultCannotEnterReplacedGeneration() {
        val lease = BrowserRtcVideoLease()
        val sampled = CountDownLatch(1)
        val resume = CountDownLatch(1)
        var applied = false
        val worker = Thread {
            sampled.countDown()
            resume.await()
            lease.runIfReady(1) { applied = true }
        }
        worker.start()
        sampled.await()
        lease.pause()
        lease.offer(2)
        resume.countDown()
        worker.join()
        assertFalse(applied)
    }
}
