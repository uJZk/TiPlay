package com.shilapi.xcertplay

import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class LatestSettingsProbeTest {
    @Test fun burstKeepsOnlyOneRunningProbeAndTheNewestOwner() {
        val ui = LinkedBlockingQueue<Runnable>()
        val probe = LatestSettingsProbe<Int>("settings-probe-test", ui::add, { ui.remove(it) })
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val results = mutableListOf<Int>()
        val old = probe.request({
            calls.incrementAndGet()
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            0
        }, results::add)
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            repeat(1_000) { index ->
                probe.request({ calls.incrementAndGet(); index + 1 }, results::add)
            }
            probe.cancel(old) // Destroying an older card must not cancel the replacement card.
            assertEquals(1, calls.get())
        } finally {
            release.countDown()
        }
        checkNotNull(ui.poll(5, TimeUnit.SECONDS)).run()
        assertEquals(listOf(1_000), results)
        assertEquals(2, calls.get())
        assertTrue(ui.isEmpty())
    }

    @Test fun detachDiscardsRunningAndPendingWorkAndAllowsReattach() {
        val ui = LinkedBlockingQueue<Runnable>()
        val probe = LatestSettingsProbe<Int>("settings-probe-test", ui::add, { ui.remove(it) })
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val completed = CountDownLatch(1)
        val calls = AtomicInteger()
        val results = mutableListOf<Int>()
        val first = probe.request({
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            completed.countDown()
            1
        }, results::add)
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            probe.cancel(first)
            val pending = probe.request({ calls.incrementAndGet(); 2 }, results::add)
            probe.cancel(pending)
        } finally {
            release.countDown()
        }
        assertTrue(completed.await(5, TimeUnit.SECONDS))
        probe.request({ 3 }, results::add)
        checkNotNull(ui.poll(5, TimeUnit.SECONDS)).run()
        assertEquals(listOf(3), results)
        assertEquals(0, calls.get())
        assertTrue(ui.isEmpty())
    }

    @Test fun detachClearsQueuedUiResultAndReusesOnlyOneDeliveryRunnable() {
        val ui = LinkedBlockingQueue<Runnable>()
        val probe = LatestSettingsProbe<Int>("settings-probe-test", ui::add, { ui.remove(it) })
        val results = mutableListOf<Int>()
        val first = probe.request({ 1 }, results::add)
        val delivery = checkNotNull(ui.poll(5, TimeUnit.SECONDS))
        probe.cancel(first)
        delivery.run()
        assertTrue(results.isEmpty())
        val second = probe.request({ 2 }, results::add)
        assertTrue(probe.awaitIdle())
        assertEquals(1, ui.size)
        probe.cancel(second)
        assertTrue(ui.isEmpty())
        probe.request({ 3 }, results::add)
        assertTrue(probe.awaitIdle())
        assertEquals(1, ui.size)
        checkNotNull(ui.poll(5, TimeUnit.SECONDS)).run()
        assertEquals(listOf(3), results)
    }

    @Test fun failedProbeDoesNotPreventTheNextRequest() {
        val ui = LinkedBlockingQueue<Runnable>()
        val probe = LatestSettingsProbe<Int>("settings-probe-test", ui::add, { ui.remove(it) })
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val results = mutableListOf<Int>()
        probe.request({
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            error("Probe unavailable")
        }, results::add)
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            probe.request({ 2 }, results::add)
        } finally {
            release.countDown()
        }
        checkNotNull(ui.poll(5, TimeUnit.SECONDS)).run()
        assertEquals(listOf(2), results)
    }
}
