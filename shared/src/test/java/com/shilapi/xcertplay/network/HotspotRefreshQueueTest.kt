package com.shilapi.xcertplay.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HotspotRefreshQueueTest {
    @Test fun aBurstRetainsOneCheckAndAnExplicitRetry() {
        val worker = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }
        val blocked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val checked = CountDownLatch(1)
        val retries = CopyOnWriteArrayList<Boolean>()
        try {
            worker.execute { blocked.countDown(); release.await() }
            assertTrue(blocked.await(2, TimeUnit.SECONDS))
            val refresh = HotspotRefreshQueue(worker) { retries += it; checked.countDown() }
            repeat(10_000) { refresh.request(it == 50) }
            assertEquals(1, worker.queue.size)
            release.countDown()
            assertTrue(checked.await(2, TimeUnit.SECONDS))
            assertEquals(listOf(true), retries)
            assertTrue(refresh.close())
        } finally {
            release.countDown()
            worker.shutdownNow()
        }
    }

    @Test fun closingDuringACheckCancelsTheSingleFollowupAndRejectsLaterEvents() {
        val worker = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val retries = CopyOnWriteArrayList<Boolean>()
        try {
            val refresh = HotspotRefreshQueue(worker) {
                retries += it
                entered.countDown()
                release.await()
            }
            refresh.request(false)
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            repeat(10_000) { refresh.request(true) }
            assertEquals(1, worker.queue.size)
            assertTrue(refresh.close())
            repeat(10_000) { refresh.request(true) }
            assertTrue(worker.queue.isEmpty())
            release.countDown()
            worker.execute { finished.countDown() }
            assertTrue(finished.await(2, TimeUnit.SECONDS))
            assertEquals(listOf(false), retries)
        } finally {
            release.countDown()
            worker.shutdownNow()
        }
    }

    @Test fun replacingUnopenedSessionsDoesNotRetainTheirWorkOrRequireTeardown() {
        val worker = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }
        val blocked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val checked = CountDownLatch(1)
        val generations = CopyOnWriteArrayList<Int>()
        try {
            worker.execute { blocked.countDown(); release.await() }
            assertTrue(blocked.await(2, TimeUnit.SECONDS))
            repeat(1_000) { generation ->
                val refresh = HotspotRefreshQueue(worker) { generations += generation }
                refresh.request(true)
                assertFalse(refresh.close())
            }
            assertTrue(worker.queue.isEmpty())
            HotspotRefreshQueue(worker) { generations += 1_000; checked.countDown() }.request(false)
            release.countDown()
            assertTrue(checked.await(2, TimeUnit.SECONDS))
            assertEquals(listOf(1_000), generations)
        } finally {
            release.countDown()
            worker.shutdownNow()
        }
    }
}
