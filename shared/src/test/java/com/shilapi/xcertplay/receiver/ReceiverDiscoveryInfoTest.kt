package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicInteger
import java.io.ByteArrayInputStream
import java.net.Socket
import org.junit.Assert.*
import org.junit.Test

class ReceiverDiscoveryInfoTest {
    private val probe = RtspMessage.Request("GET", "/info?txtAirPlay&txtRAOP", "RTSP/1.0",
        mapOf("x-apple-qr" to "BT"), byteArrayOf())

    @Test fun updatesAreReadLiveAndClosedProviderCannotReturnOldInfo() {
        var config: ReceiverConfig? = profile("first")
        val lease = ReceiverDiscoveryInfo.register { config }
        try {
            assertEquals("first", info()["name"])
            config = config!!.copy(name = "updated", hevcEnabled = true)
            assertEquals("updated", info()["name"])
            assertEquals(config!!.features, (info()["features"] as Number).toLong())
            config = null
            assertEquals(503, ReceiverDiscoveryInfo.response(probe)!!.status)
        } finally { lease.close() }
        assertEquals(503, ReceiverDiscoveryInfo.response(probe)!!.status)
    }

    @Test fun oldLeaseCloseCannotRemoveReplacement() {
        val old = ReceiverDiscoveryInfo.register { profile("old") }
        val replacement = ReceiverDiscoveryInfo.register { profile("replacement") }
        try {
            old.close()
            old.close()
            assertEquals("replacement", info()["name"])
        } finally { old.close(); replacement.close() }
        assertEquals(503, ReceiverDiscoveryInfo.response(probe)!!.status)
    }

    @Test fun closeWhileProviderIsTakingSnapshotRejectsThatSnapshot() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val profile = profile("retired")
        val lease = ReceiverDiscoveryInfo.register {
            entered.countDown()
            check(release.await(2, TimeUnit.SECONDS))
            profile
        }
        val response = AtomicReference<RtspMessage.Response?>()
        val worker = Thread { response.set(ReceiverDiscoveryInfo.response(probe)) }
        try {
            worker.start()
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            lease.close()
            release.countDown()
            worker.join(2_000)
            assertFalse(worker.isAlive)
            assertEquals(503, response.get()!!.status)
            assertTrue(response.get()!!.body.isEmpty())
        } finally { lease.close(); release.countDown(); worker.join(2_000) }
    }

    @Test fun onlyObservedBtInfoDiscoveryShapeUsesTheBroker() {
        val lease = ReceiverDiscoveryInfo.register { error("Non-discovery route invoked provider") }
        try {
            for (request in listOf(
                probe.copy(method = "POST"), probe.copy(protocol = "HTTP/1.1"),
                probe.copy(path = "/other?txtAirPlay"), probe.copy(path = "/info?other=txtAirPlay"),
                probe.copy(path = "/info"), probe.copy(headers = emptyMap()),
                probe.copy(headers = probe.headers + ("cseq" to "1")),
                probe.copy(headers = mapOf("x-apple-qr" to "other")),
                probe.copy(path = "/pair-setup?txtAirPlay"),
                probe.copy(path = "/pair-verify?txtRAOP"), probe.copy(body = byteArrayOf(1)),
            )) assertNull(ReceiverDiscoveryInfo.response(request))
        } finally { lease.close() }
    }

    @Test fun legacyAdmissionPreservesTheOriginalSocketInputAndQueuedRequests() {
        val config = profile("ordinary")
        val calls = AtomicInteger()
        Socket().use { socket ->
            val input = ByteArrayInputStream(byteArrayOf(1, 2, 3))
            val requests = listOf(probe.copy(method = "POST", path = "/fp-setup"), probe.copy(path = "/info"))
            val lease = ReceiverDiscoveryInfo.register({ config }, { actualSocket, actualInput, actualRequests ->
                assertSame(socket, actualSocket)
                assertSame(input, actualInput)
                assertSame(requests, actualRequests)
                calls.incrementAndGet()
                true
            })
            try {
                assertTrue(ReceiverDiscoveryInfo.isCurrent(lease))
                assertTrue(ReceiverDiscoveryInfo.serveLegacyConnection(socket, input, requests))
                assertEquals(1, calls.get())
            } finally { lease.close() }
            assertFalse(ReceiverDiscoveryInfo.isCurrent(lease))
            assertFalse(ReceiverDiscoveryInfo.serveLegacyConnection(socket, input, requests))
        }
    }

    @Test fun advertisedOwnerCannotSwitchToAReplacementButAFreshConnectionUsesIt() {
        val config = profile("ordinary")
        val old = ReceiverDiscoveryInfo.register({ config }, { _, _, _ -> error("Retired owner was called") })
        val advertised = requireNotNull(ReceiverDiscoveryInfo.discover(probe))
        val calls = AtomicInteger()
        val replacement = ReceiverDiscoveryInfo.register({ config.copy(name = "replacement") }, { _, _, _ -> calls.incrementAndGet(); true })
        try {
            old.close()
            assertFalse(ReceiverDiscoveryInfo.isCurrent(old))
            assertTrue(ReceiverDiscoveryInfo.isCurrent(replacement))
            assertEquals(503, ReceiverDiscoveryInfo.discover(probe, advertised)!!.response.status)
            Socket().use { socket ->
                val input = ByteArrayInputStream(byteArrayOf())
                val requests = listOf(probe.copy(method = "POST", path = "/fp-setup"))
                assertFalse(ReceiverDiscoveryInfo.serveLegacyConnection(socket, input, requests, advertised))
                assertTrue(ReceiverDiscoveryInfo.serveLegacyConnection(socket, input, requests))
            }
            assertEquals(1, calls.get())
        } finally { old.close(); replacement.close() }
    }

    @Test fun providerFailureOrNonLegacyFirstRequestCannotInvokeTheSessionCallback() {
        val lease = ReceiverDiscoveryInfo.register({ error("Closed provider") }, { _, _, _ -> error("Callback must not run") })
        try {
            assertEquals(503, ReceiverDiscoveryInfo.discover(probe)!!.response.status)
            Socket().use { socket ->
                val input = ByteArrayInputStream(byteArrayOf())
                for (request in listOf(probe, probe.copy(method = "POST", path = "/fp-setup"),
                    probe.copy(method = "GET", path = "/fp-setup"),
                    probe.copy(method = "POST", path = "/fp-setup?txtAirPlay"))) {
                    assertFalse(ReceiverDiscoveryInfo.serveLegacyConnection(socket, input, listOf(request)))
                }
                assertFalse(ReceiverDiscoveryInfo.serveLegacyConnection(socket, input, emptyList()))
            }
        } finally { lease.close() }
    }

    @Test fun replacementDuringProviderSnapshotCannotEnterTheRetiredSession() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val config = profile("old")
        val old = ReceiverDiscoveryInfo.register({
            entered.countDown()
            check(release.await(2, TimeUnit.SECONDS))
            config
        }, { _, _, _ -> error("Retired callback must not run") })
        Socket().use { socket ->
            val result = AtomicReference<Boolean>()
            val worker = Thread { result.set(ReceiverDiscoveryInfo.serveLegacyConnection(socket,
                ByteArrayInputStream(byteArrayOf()), listOf(probe.copy(method = "POST", path = "/fp-setup")))) }
            var replacement: java.io.Closeable? = null
            try {
                worker.start()
                assertTrue(entered.await(2, TimeUnit.SECONDS))
                replacement = ReceiverDiscoveryInfo.register { config.copy(name = "replacement") }
                release.countDown()
                worker.join(2_000)
                assertFalse(worker.isAlive)
                assertEquals(false, result.get())
            } finally { release.countDown(); worker.join(2_000); old.close(); replacement?.close() }
        }
    }

    private fun profile(name: String) = ReceiverConfig(name, "02:11:22:33:44:55", AirPlayIdentity.generate())
    private fun info(): Map<*, *> = BplistCodec.decode(ReceiverDiscoveryInfo.response(probe)!!.body) as Map<*, *>
}
