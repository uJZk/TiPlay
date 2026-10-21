package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.util.concurrent.TimeUnit

class ReceiverResourceRequestsTest {
    private val peer = InetAddress.getLoopbackAddress()

    @Test fun deadlineEvidenceSeparatesQueuedExchangeAndLateDispatchOverallExpiryWithoutPrivateIdentity() {
        val second = TimeUnit.SECONDS.toNanos(1)
        data class Scenario(val dispatchAt: Long?, val expireAt: Long, val phase: String,
                            val deadline: String, val queueMs: Long, val exchangeMs: String)
        for ((dispatchAt, expireAt, expectedPhase, expectedDeadline, queueMs, exchangeMs) in listOf(
            Scenario(null, 30L, "QUEUED", "OVERALL", 30000L, "NONE"),
            Scenario(0L, 10L, "EXCHANGE", "EXCHANGE", 0L, "10000"),
            Scenario(25L, 30L, "EXCHANGE", "OVERALL", 25000L, "5000"),
        )) {
            var now = 0L; val evidence = mutableListOf<ReceiverResourceRequests.DeadlineEvidence>()
            val requests = ReceiverResourceRequests(nowNanos = { now }, onDeadline = evidence::add)
            val pending = requests.acquire("private-session", peer,
                "https://private-host/resource?token=private-secret", ownerGeneration = 42)!!.pending
            if (dispatchAt != null) {
                now = dispatchAt * second
                assertSame(pending, requests.nextToDispatch("private-session", peer))
            }
            assertTrue(evidence.isEmpty())
            now = expireAt * second - 1
            assertSame(pending, requests[pending.id]); assertTrue(evidence.isEmpty())
            now++
            assertNull(requests[pending.id]); assertTrue(pending.future.isCompletedExceptionally)
            val event = evidence.single()
            val line = event.line()
            assertEquals(42L, event.ownerGeneration)
            assertTrue(line.contains("request=${pending.id} owner=42 phase=$expectedPhase limitingDeadline=$expectedDeadline due=true"))
            assertTrue(line.contains("queueMs=$queueMs exchangeMs=$exchangeMs overallMs=${expireAt * 1000}"))
            assertTrue(line.contains("overallLimitMs=30000 exchangeLimitMs=10000"))
            assertTrue(line.length < 600); assertFalse(line.contains("private")); assertFalse(line.contains("secret"))
            requests.expire(pending); assertEquals(1, evidence.size)
        }
    }

    @Test fun aThrowingReentrantDeadlineObserverSeesRetiredStateAndCannotStrandTheQueueOrRetagTheOwner() {
        var now = 0L; var observed = 0
        lateinit var requests: ReceiverResourceRequests
        var replacement: ReceiverResourceRequests.Pending? = null
        requests = ReceiverResourceRequests(nowNanos = { now }, onDeadline = { event ->
            observed++
            assertNull(requests[event.request])
            replacement = requests.acquire("replacement", peer, "mlhls://app/new", ownerGeneration = 43)!!.pending
            error("logger unavailable")
        })
        val first = requests.acquire("private-session", peer, "mlhls://app/old", ownerGeneration = 42)!!.pending
        val shared = requests.acquire("private-session", peer, first.url, ownerGeneration = 99)!!.pending
        assertSame(first, shared); assertEquals(42L, shared.ownerGeneration)
        assertSame(first, requests.nextToDispatch("private-session", peer))
        now = TimeUnit.SECONDS.toNanos(10)
        assertNull(requests[first.id]); assertEquals(1, observed)
        assertTrue(first.future.isCompletedExceptionally)
        assertSame(replacement, requests.nextToDispatch("replacement", peer))
        assertEquals(43L, replacement!!.ownerGeneration)
        assertEquals(1, observed)
    }

    @Test fun onlyTheSameByteRangeCanShareAnInflightSignedResource() {
        val requests = ReceiverResourceRequests()
        val url = "https://example.test/video.m4s?nbs=1&upsig=fake%2fSignature&uparams=nbs"
        val map = requests.acquire("session", peer, url, "bytes=0-978")!!.pending
        assertSame(map, requests.acquire("session", peer, url, "bytes=0-978")!!.pending)
        val segment = requests.acquire("session", peer, url, "bytes=1523-554873")!!.pending
        val full = requests.acquire("session", peer, url)!!.pending
        assertNotEquals(map.id, segment.id)
        assertNotEquals(segment.id, full.id)
        assertEquals(url, map.url)
        assertEquals(url, segment.url)
        assertEquals("bytes=0-978", map.range)
        assertSame(map, requests.nextToDispatch("session", peer))
        map.future.complete(ReceiverResource(byteArrayOf(1), 206, null))
        assertSame(segment, requests.nextToDispatch("session", peer))
        assertThrows(IllegalArgumentException::class.java) {
            requests.acquire("session", peer, url, "bytes=0-1\r\nAuthorization: secret")
        }
    }

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
        val requests = ReceiverResourceRequests(exchangeTimeoutNanos = TimeUnit.SECONDS.toNanos(30), nowNanos = { now })
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
        val requests = ReceiverResourceRequests(exchangeTimeoutNanos = TimeUnit.SECONDS.toNanos(30), nowNanos = { now })
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

    @Test fun defaultCapacityAdmitsSixteenUniqueLoadsAndSharesAtCapacityBeforeReclaimingCompletedLoads() {
        val requests = ReceiverResourceRequests(nowNanos = { 0L })
        val pending = (0 until 16).map { index ->
            val acquired = requests.acquire("session", peer, "mlhls://app/segment-$index.ts")!!
            assertTrue(acquired.created)
            acquired.pending
        }
        assertNull(requests.acquire("session", peer, "mlhls://app/segment-16.ts"))
        val shared = requests.acquire("session", peer, pending.last().url)!!
        assertFalse(shared.created)
        assertSame(pending.last(), shared.pending)

        assertTrue(pending.first().future.complete(ReceiverResource(byteArrayOf(1), 200, null)))
        val admitted = requests.acquire("session", peer, "mlhls://app/segment-16.ts")!!
        assertTrue(admitted.created)
        assertNull(requests[pending.first().id])
        assertSame(admitted.pending, requests[admitted.pending.id])
        assertNull(requests.acquire("session", peer, "mlhls://app/segment-17.ts"))
    }

    @Test fun defaultExchangeDeadlineExpiresAtTenSecondsAndAdvancesTheQueueWithoutRetryExtension() {
        var now = 0L
        val tenSeconds = TimeUnit.SECONDS.toNanos(10)
        val requests = ReceiverResourceRequests(nowNanos = { now })
        val first = requests.acquire("session", peer, "mlhls://app/segment.ts")!!.pending
        val queued = requests.acquire("session", peer, "mlhls://app/next.ts")!!.pending
        assertSame(first, requests.nextToDispatch("session", peer))

        now = tenSeconds - 1
        val retry = requests.acquire("session", peer, first.url)!!
        assertFalse(retry.created)
        assertSame(first, retry.pending)
        assertSame(first, requests[first.id])
        assertEquals(1L, requests.remainingNanos(first))
        assertEquals(1L, requests.waitNanos(queued))
        assertFalse(first.future.isDone)
        assertNull(requests.nextToDispatch("session", peer))

        now = tenSeconds
        assertSame(queued, requests.nextToDispatch("session", peer))
        assertTrue(first.future.isCompletedExceptionally)
        assertNull(requests[first.id])
        assertEquals(tenSeconds, requests.remainingNanos(queued))
        assertFalse(queued.future.isDone)

        now = tenSeconds + 1
        assertNull(requests[first.id])
        assertFalse(first.future.complete(ReceiverResource(byteArrayOf(1), 200, null)))
        assertEquals(tenSeconds - 1, requests.remainingNanos(queued))
        assertFalse(queued.future.isDone)
    }

    @Test fun defaultQueuedDeadlineExpiresAtThirtySecondsWithoutDispatchOrSharingExtension() {
        var now = 0L
        val thirtySeconds = TimeUnit.SECONDS.toNanos(30)
        val requests = ReceiverResourceRequests(nowNanos = { now })
        val original = requests.acquire("session", peer, "mlhls://app/segment.ts")!!.pending
        now = TimeUnit.SECONDS.toNanos(10)
        assertFalse(requests.acquire("session", peer, original.url)!!.created)
        assertEquals(TimeUnit.SECONDS.toNanos(20), requests.remainingNanos(original))

        now = thirtySeconds - 1
        val retry = requests.acquire("session", peer, original.url)!!
        assertFalse(retry.created)
        assertSame(original, retry.pending)
        assertSame(original, requests[original.id])
        assertEquals(1L, requests.remainingNanos(original))
        assertEquals(1L, requests.waitNanos(original))
        assertFalse(original.future.isDone)

        now = thirtySeconds
        assertNull(requests.nextToDispatch("session", peer))
        assertTrue(original.future.isCompletedExceptionally)
        assertNull(requests[original.id])

        now = thirtySeconds + 1
        val replacement = requests.acquire("session", peer, original.url)!!
        assertTrue(replacement.created)
        assertNotEquals(original.id, replacement.pending.id)
        assertEquals(thirtySeconds, requests.remainingNanos(replacement.pending))
        assertFalse(original.future.complete(ReceiverResource(byteArrayOf(1), 200, null)))
        assertFalse(replacement.pending.future.isDone)
    }

    @Test fun lateDispatchKeepsTheOriginalThirtySecondDeadlineAndReleasesTheNextLoadExactlyAtExpiry() {
        var now = 0L
        val thirtySeconds = TimeUnit.SECONDS.toNanos(30)
        val tenSeconds = TimeUnit.SECONDS.toNanos(10)
        val requests = ReceiverResourceRequests(nowNanos = { now })
        val original = requests.acquire("session", peer, "mlhls://app/segment.ts")!!.pending
        now = TimeUnit.SECONDS.toNanos(25)
        val queued = requests.acquire("session", peer, "mlhls://app/next.ts")!!.pending
        assertSame(original, requests.nextToDispatch("session", peer))
        assertEquals(TimeUnit.SECONDS.toNanos(5), requests.remainingNanos(original))
        assertEquals(TimeUnit.SECONDS.toNanos(5), requests.waitNanos(queued))

        now = thirtySeconds - 1
        val retry = requests.acquire("session", peer, original.url)!!
        assertFalse(retry.created)
        assertSame(original, retry.pending)
        assertEquals(1L, requests.remainingNanos(original))
        assertEquals(1L, requests.waitNanos(queued))
        assertNull(requests.nextToDispatch("session", peer))

        now = thirtySeconds
        assertSame(queued, requests.nextToDispatch("session", peer))
        assertTrue(original.future.isCompletedExceptionally)
        assertNull(requests[original.id])
        assertEquals(tenSeconds, requests.remainingNanos(queued))
        assertFalse(queued.future.isDone)

        now = thirtySeconds + 1
        assertFalse(original.future.complete(ReceiverResource(byteArrayOf(1), 200, null)))
        assertEquals(tenSeconds - 1, requests.remainingNanos(queued))
        assertFalse(queued.future.isDone)
    }

    @Test fun stalledSegmentCannotBlockPlaylistsAndLiveRefreshDoesNotReuseCompletedResource() {
        var now = 0L
        val requests = ReceiverResourceRequests(nowNanos = { now })
        val segment = requests.acquire("session", peer, "mlhls://app/segment.ts")!!.pending
        assertSame(segment, requests.nextToDispatch("session", peer))
        val otherSegment = requests.acquire("session", peer, "mlhls://app/next.ts")!!.pending
        val playlist = requests.acquire("session", peer, "mlhls://app/live.m3u8")!!.pending
        now = TimeUnit.SECONDS.toNanos(10)
        assertSame(playlist, requests.nextToDispatch("session", peer))
        assertTrue(segment.future.isCompletedExceptionally)
        playlist.future.complete(ReceiverResource(byteArrayOf(1), 200, null))
        // Refresh can start before the previous loader's finally removes the completed exchange.
        val refresh = requests.acquire("session", peer, playlist.url)!!
        assertTrue(refresh.created)
        assertSame(refresh.pending, requests.nextToDispatch("session", peer))
        assertFalse(otherSegment.future.isDone)
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
