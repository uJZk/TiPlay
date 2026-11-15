package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class BrowserRtcAudioRoutePolicyTest {
    private val good = "192.0.2.1"
    private val other = "198.51.100.1"
    private fun candidate(address: String = good) = "a=candidate:1 1 udp 123 $address 12345 typ host"
    private fun policy() = BrowserRtcAudioRoutePolicy().also { it.selected(candidate()) }
    private fun begin(p: BrowserRtcAudioRoutePolicy, offer: String = candidate(), connected: Boolean = true,
                      assigned: (String) -> Boolean = { true }) = p.begin(offer, { connected }, assigned)
    private val slots = listOf(BrowserRtcAudioSlot("0", 111))
    private class Backend(override val slots: List<BrowserRtcAudioSlot>) : BrowserRtcAudioBackend {
        var ready = false
        var closed = false
        var error: Throwable? = null
        override fun answer(offer: String): String { error?.let { throw it }; return offer }
        override fun ready() = ready && !closed
        override fun send(slot: String, payload: ByteArray, timestampUs: Double) {}
        override fun snapshot(): Map<String, Any?> = mapOf("ready" to ready())
        override fun close() { closed = true }
    }

    @Test fun onlyStrictUnicastIpv4HostUdpCandidatesAreEligible() {
        for (address in listOf("10.1.2.3", "172.20.1.2", "192.168.1.2", "100.64.1.2", good, "169.254.111.111"))
            assertEquals(address, BrowserRtcAudioRoutePolicy.hostIpv4(candidate(address)))
        for (address in listOf("0.0.0.0", "0.1.2.3", "127.1.2.3", "224.0.0.1", "255.255.255.255", "192.0.2.256",
                "192.00.2.1", "192.0.2", "localhost", "peer.local", "::1", "2001:db8::1", "192.0.2.1:80"))
            assertNull(BrowserRtcAudioRoutePolicy.hostIpv4(candidate(address)))
        for (bad in listOf(candidate().replace("1 1 udp", "1 2 udp"), candidate().replace(" udp ", " tcp "),
                candidate().replace("typ host", "typ prflx"), candidate().replace("typ host", "typ srflx"),
                candidate().replace(" 12345 ", " 0 "), candidate().replace(" 123 ", " -1 "),
                candidate().replace("candidate:1", "candidate:"))) assertNull(BrowserRtcAudioRoutePolicy.hostIpv4(bad))
    }

    @Test fun ipv6OnlyAndNoEligibleOfferKeepAnyWhileMixedOfferCanPreferIpv4() {
        val p = policy()
        for (offer in listOf("", candidate("2001:db8::1"), candidate("peer.local"), candidate().replace("typ host", "typ relay")))
            assertNull(begin(p, offer).address)
        assertEquals(good, begin(p, candidate("2001:db8::1") + "\r\n" + candidate()).address)
    }

    @Test fun currentConnectionAndFreshLocalAssignmentAreRequired() {
        val p = policy()
        assertNull(begin(p, connected = false).address)
        assertNull(begin(p, assigned = { false }).address)
        assertNull(begin(p, assigned = { error("interface-enumeration-failed") }).address)
        assertEquals(good, begin(p).address)
        p.disconnected()
        assertNull(begin(p).address)
        p.selected(candidate()); assertEquals(good, begin(p).address)
        p.close(); p.selected(candidate(other)); assertNull(begin(p).address)
    }

    @Test fun unreadyRetirementFallsBackWithoutAnyNativeFailureCallback() {
        val p = policy(); val first = begin(p)
        p.retired(first)
        assertNull(begin(p).address)
        p.selected(candidate()) // Repeated event/port changes must not reset the failed revision.
        assertNull(begin(p).address)
    }

    @Test fun normalReadyRetirementKeepsPreferenceButExplicitFailureDoesNot() {
        val p = policy(); val first = begin(p)
        p.ready(first); p.retired(first)
        val next = begin(p); assertEquals(good, next.address)
        p.ready(next); p.failed(next)
        assertNull(begin(p).address)
    }

    @Test fun oldAttemptAndOldRouteFailureCannotPoisonReplacement() {
        val p = policy(); val old = begin(p); p.ready(old); p.retired(old)
        val fresh = begin(p); p.failed(old); p.retired(old)
        p.ready(fresh); p.retired(fresh)
        assertEquals(good, begin(p).address)
        val previousRoute = begin(p)
        p.selected(candidate(other)); val newRoute = begin(p)
        assertEquals(other, newRoute.address)
        p.failed(previousRoute); p.retired(previousRoute)
        p.ready(newRoute); p.retired(newRoute)
        assertEquals(other, begin(p).address)
    }

    @Test fun slowAssignmentFromOldAttemptCannotReplaceNewToken() {
        val p = policy(); val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val old = AtomicReference<BrowserRtcAudioRoutePolicy.Attempt>()
        val worker = Thread { old.set(begin(p, assigned = { entered.countDown(); release.await(2, TimeUnit.SECONDS); true })) }
        worker.start(); assertTrue(entered.await(2, TimeUnit.SECONDS))
        val fresh = begin(p); assertEquals(good, fresh.address)
        release.countDown(); worker.join(2000); assertFalse(worker.isAlive)
        assertNull(old.get().address)
        p.failed(old.get()); p.ready(fresh); p.retired(fresh)
        assertEquals(good, begin(p).address)
    }

    @Test fun routeChangeDuringAssignmentRejectsStaleAddress() {
        val p = policy()
        val old = begin(p, assigned = { p.selected(candidate(other)); true })
        assertNull(old.address)
        assertEquals(other, begin(p).address)
    }

    @Test fun wrapperSnapshotDoesNotConstructPeerAndAnswerFailureReallyFallsBack() {
        val p = policy(); val bindings = mutableListOf<String?>(); var creations = 0
        fun peer() = PreferredBrowserRtcAudioPeer(slots, p, { true }, {}, { bind, _ ->
            creations++; bindings += bind; Backend(slots).also { it.error = IllegalStateException("description-failed") }
        }, { true })
        val first = peer(); assertEquals(false, first.snapshot()["ready"]); assertFalse(first.ready()); assertEquals(0, creations)
        assertThrows(IllegalStateException::class.java) { first.answer(candidate()) }; first.close()
        val next = peer(); assertThrows(IllegalStateException::class.java) { next.answer(candidate()) }; next.close()
        assertEquals(listOf(good, null), bindings)
    }

    @Test fun closedOrDuplicateWrapperAnswerDoesNotConsumeCurrentAttempt() {
        val p = policy(); val closed = PreferredBrowserRtcAudioPeer(slots, p, { true }, {}, { _, _ -> Backend(slots) }, { true })
        closed.close(); assertThrows(IllegalStateException::class.java) { closed.answer(candidate()) }
        assertEquals(good, begin(p).address)
        val backend = Backend(slots).also { it.ready = true }
        val live = PreferredBrowserRtcAudioPeer(slots, p, { true }, {}, { _, _ -> backend }, { true })
        live.answer(candidate()); assertTrue(live.ready())
        assertThrows(IllegalStateException::class.java) { live.answer(candidate()) }
        live.close(); assertEquals(good, begin(p).address)
    }

    @Test fun closeWhileFactoryIsBlockedClosesOrphanAndLateFailureCannotPoisonNextPeer() {
        val p = policy(); val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val orphan = Backend(slots); var callback: ((String) -> Unit)? = null; val errors = mutableListOf<String>()
        val peer = PreferredBrowserRtcAudioPeer(slots, p, { true }, errors::add, { _, failed ->
            callback = failed; entered.countDown(); release.await(2, TimeUnit.SECONDS); orphan
        }, { true })
        val outcome = AtomicReference<Throwable>()
        val worker = Thread { try { peer.answer(candidate()) } catch (e: Throwable) { outcome.set(e) } }
        worker.start(); assertTrue(entered.await(2, TimeUnit.SECONDS)); peer.close()
        val replacement = begin(p); assertNull(replacement.address)
        release.countDown(); worker.join(2000)
        assertFalse(worker.isAlive); assertTrue(orphan.closed); assertNotNull(outcome.get())
        callback!!("late-failure"); assertTrue(errors.isEmpty())
        p.selected(candidate(other)); assertEquals(other, begin(p).address)
    }

    @Test fun synchronousFactoryFailureAndReadyThenNativeFailureForceAny() {
        val p = policy(); var failures = 0
        val early = PreferredBrowserRtcAudioPeer(slots, p, { true }, { failures++ }, { _, failed ->
            failed("synchronous-failure"); Backend(slots)
        }, { true })
        early.answer(candidate()); early.close(); assertEquals(1, failures); assertNull(begin(p).address)
        p.selected(candidate(other)); var fail: ((String) -> Unit)? = null
        val ready = PreferredBrowserRtcAudioPeer(slots, p, { true }, {}, { _, failed ->
            fail = failed; Backend(slots).also { it.ready = true }
        }, { true })
        ready.answer(candidate()); assertTrue(ready.ready()); fail!!("transport-failed"); ready.close()
        assertNull(begin(p).address)
    }

    @Test fun browserRetirementAfterDisconnectionFallsBackEvenWithoutNativeFailure() {
        val p = policy(); val backend = Backend(slots).also { it.ready = true }
        val peer = PreferredBrowserRtcAudioPeer(slots, p, { true }, {}, { _, _ -> backend }, { true })
        peer.answer(candidate()); assertTrue(peer.ready())
        backend.ready = false // Browser recovery timeout can retire before any native failure callback.
        peer.close(); assertNull(begin(p).address)
        p.selected(candidate(other))
        val healthy = Backend(slots).also { it.ready = true }
        val normal = PreferredBrowserRtcAudioPeer(slots, p, { true }, {}, { _, _ -> healthy }, { true })
        normal.answer(candidate()); normal.close() // No preceding wrapper.ready() is required.
        assertEquals(other, begin(p).address)
    }

    @Test fun browserDrivenRouterGenerationRetiresUnreadyBindingBeforeNextAttempt() {
        val p = policy(); val bindings = mutableListOf<String?>()
        // The shared Chromium fixture precedes ICE gathering. Supply a real-shaped gathered host.
        val offer = File("src/test/resources/Browser-audio-track-offer.sdp").readText()
            .replaceFirst("a=mid:0\r\n", "a=mid:0\r\n${candidate("192.0.2.2")}\r\n")
        assertTrue(BrowserRtcAudioRoutePolicy.hasIpv4Host(offer))
        val router = BrowserRtcAudioRouter({}, peerFactory = { offered, failed ->
            PreferredBrowserRtcAudioPeer(offered, p, { true }, failed, { bind, _ ->
                bindings += bind; Backend(offered)
            }, { true })
        })
        try { router.answer(offer, 1); router.answer(offer, 2); assertEquals(listOf(good, null), bindings) }
        finally { router.close() }
    }
}
