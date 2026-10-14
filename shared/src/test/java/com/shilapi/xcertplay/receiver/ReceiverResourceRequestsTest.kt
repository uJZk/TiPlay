package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.util.concurrent.TimeUnit

class ReceiverResourceRequestsTest {
    private val peer = InetAddress.getLoopbackAddress()

    @Test fun parallelMediaLoadsWaitForTheirPredecessorResourceAndShareRetries() {
        val requests = ReceiverResourceRequests()
        val first = requests.acquire("session", peer, "mlhls://app/video.m3u8")!!.pending
        val second = requests.acquire("session", peer, "mlhls://app/audio.m3u8")!!.pending
        val third = requests.acquire("session", peer, "mlhls://app/subtitles.m3u8")!!.pending
        assertSame(first, requests.nextToDispatch("session", peer))
        assertNull(requests.nextToDispatch("session", peer))
        assertSame(second, requests.acquire("session", peer, second.url)!!.pending)
        first.future.complete(ReceiverResource(byteArrayOf(1), 0, null))
        assertSame(second, requests.nextToDispatch("session", peer))
        assertNull(requests.nextToDispatch("session", peer))
        second.future.complete(ReceiverResource(byteArrayOf(2), 0, null))
        assertSame(third, requests.nextToDispatch("session", peer))
    }

    @Test fun expiryAdvancesTheQueueWithoutRestartingQueuedDeadlinesAndStopDiscardsIt() {
        var now = 0L
        val requests = ReceiverResourceRequests(nowNanos = { now })
        val first = requests.acquire("session", peer, "mlhls://app/video.m3u8")!!.pending
        assertSame(first, requests.nextToDispatch("session", peer))
        now = TimeUnit.SECONDS.toNanos(10)
        val second = requests.acquire("session", peer, "mlhls://app/audio.m3u8")!!.pending
        // Even without a surviving first waiter, the queued caller wakes at t=30 rather than t=40.
        assertEquals(TimeUnit.SECONDS.toNanos(20), requests.waitNanos(second))
        now = TimeUnit.SECONDS.toNanos(30)
        assertSame(second, requests.nextToDispatch("session", peer))
        assertTrue(first.future.isCompletedExceptionally)
        assertEquals(TimeUnit.SECONDS.toNanos(10), requests.remainingNanos(second))
        requests.clear()
        assertNull(second.future.get())
        assertNull(requests.nextToDispatch("session", peer))
        val replacement = requests.acquire("session", peer, first.url)!!.pending
        assertSame(replacement, requests.nextToDispatch("session", peer))
    }

    @Test fun cancelledWaiterCanReuseTheSameExchangeAfterTheOldTenSecondLimit() {
        var now = 0L
        val requests = ReceiverResourceRequests(nowNanos = { now })
        val original = requests.acquire("session", peer, "mlhls://app/media")!!.pending
        now = TimeUnit.SECONDS.toNanos(16)
        val resumed = requests.acquire("session", peer, original.url)!!
        assertFalse(resumed.created)
        assertSame(original, resumed.pending)
        val resource = ReceiverResource(byteArrayOf(1, 2), 0, null)
        assertTrue(requests[original.id]!!.future.complete(resource))
        assertSame(resource, resumed.pending.future.get())
        requests.remove(resumed.pending)
        assertNull(requests[original.id])
        assertTrue(requests.acquire("session", peer, original.url)!!.created)
    }

    @Test fun repeatedSeekLoadsDoNotExtendTheOriginalDeadlineAndAbandonedRequestsAreBounded() {
        var now = 0L
        val requests = ReceiverResourceRequests(maximumPending = 1, nowNanos = { now })
        val original = requests.acquire("session", peer, "mlhls://app/media")!!.pending
        now = TimeUnit.SECONDS.toNanos(29)
        assertFalse(requests.acquire("session", peer, original.url)!!.created)
        assertNull(requests.acquire("session", peer, "mlhls://app/other"))
        now = TimeUnit.SECONDS.toNanos(30)
        val next = requests.acquire("session", peer, original.url)!!
        assertTrue(next.created)
        assertNotEquals(original.id, next.pending.id)
        assertTrue(original.future.isCompletedExceptionally)
        assertNull(requests[original.id])
        // A late reply for the expired request cannot complete its replacement.
        assertFalse(original.future.complete(ReceiverResource(byteArrayOf(1), 0, null)))
        assertFalse(next.pending.future.isDone)
    }

    @Test fun exchangesCannotBeSharedAcrossPlaybackSessionsOrPeersAndStopCancelsAll() {
        val requests = ReceiverResourceRequests()
        val first = requests.acquire("first", peer, "mlhls://app/media")!!.pending
        val differentSession = requests.acquire("second", peer, first.url)!!
        val differentPeer = requests.acquire("first", InetAddress.getByAddress(byteArrayOf(127, 0, 0, 2)), first.url)!!
        assertTrue(differentSession.created)
        assertTrue(differentPeer.created)
        requests.clear()
        assertNull(first.future.get())
        assertNull(differentSession.pending.future.get())
        assertNull(differentPeer.pending.future.get())
        assertNull(requests[first.id])
        val replacement = requests.acquire("first", peer, first.url)!!.pending
        assertFalse(first.future.complete(ReceiverResource(byteArrayOf(1), 0, null)))
        assertFalse(replacement.future.isDone)
    }
}
