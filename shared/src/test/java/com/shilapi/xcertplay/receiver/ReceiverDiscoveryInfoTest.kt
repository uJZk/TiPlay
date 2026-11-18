package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
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

    private fun profile(name: String) = ReceiverConfig(name, "02:11:22:33:44:55", AirPlayIdentity.generate())
    private fun info(): Map<*, *> = BplistCodec.decode(ReceiverDiscoveryInfo.response(probe)!!.body) as Map<*, *>
}
