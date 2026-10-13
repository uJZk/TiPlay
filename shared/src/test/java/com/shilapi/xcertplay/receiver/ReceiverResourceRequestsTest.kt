package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.util.concurrent.TimeUnit

class ReceiverResourceRequestsTest {
    private val peer = InetAddress.getLoopbackAddress()

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
