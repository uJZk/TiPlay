package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.AirPlayContact
import org.junit.Assert.*
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class BrowserRtcSignalingTest {
    private class FakePeer(override val session: String, override val epoch: Int,
                           val control: (Map<*, *>) -> String) : BrowserRtcSession {
        var closed = false
        override val live get() = !closed
        override fun answer(offer: String): String { check(offer == "test-offer"); return "test-answer" }
        override fun snapshot(): Map<String, Any?> = mapOf("epoch" to epoch)
        override fun maintain() {}
        override fun close() { closed = true }
    }

    @Test fun productRequiresWebRtcForMediaWhileRetainingHttpControlBootstrap() {
        var browserSeen = 0
        val callbacks = object : BrowserLinkServer.Callbacks {
            override fun code() = "1234"
            override fun status() = BrowserLinkStatus(BrowserLinkStatus.State.IDLE)
            override fun onTouch(contacts: List<AirPlayContact>): Boolean {
                assertTrue("Only shutdown finger release is allowed", contacts.isEmpty())
                return true
            }
            override fun onViewport(viewport: BrowserViewport) {}
            override fun onFit() {}
            override fun onKey(name: String) = error("media request applied key")
            override fun onBrowserSeen(session: String) { browserSeen++ }
            override fun onBrowserStats(stats: Map<String, Any?>) {}
            override fun log(message: String) {}
        }
        val hub = WebVideoHub()
        val audio = WebAudioHub()
        val audioLease = audio.subscribe()
        val server = BrowserLinkServer(hub, callbacks, "127.0.0.1", 0, audioHub = audio,
            rtcFactory = BrowserRtcFactory { _, _ -> error("media request created RTC peer") })
        val port = server.start().getOrThrow()
        try {
            for (path in listOf("/video", "/audio")) {
                val connection = URL("http://127.0.0.1:$port$path?c=1234&s=rtc-session-0001").openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 2_000; connection.readTimeout = 2_000
                    assertEquals(410, connection.responseCode)
                    val error = connection.errorStream.bufferedReader().use { WebJson.parse(it.readText()) as Map<*, *> }
                    assertEquals("transport-required", error["error"])
                } finally { connection.disconnect() }
            }
            assertEquals(0, browserSeen)
            assertEquals(false, hub.snapshot()["viewer"])
            assertFalse("HTTP audio must not acquire or replace the media lease", audioLease.closed)
            val connection = URL("http://127.0.0.1:$port/control").openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.connectTimeout = 2_000; connection.readTimeout = 2_000
                connection.outputStream.use { it.write("""{"c":"1234","s":"rtc-session-0001","q":0,"e":[]}""".toByteArray()) }
                assertEquals(200, connection.responseCode)
                connection.inputStream.close()
                assertEquals(1, browserSeen)
            } finally { connection.disconnect() }
        } finally { server.stop(); audioLease.close() }
    }

    @Test fun pairingAndPeerGenerationAreEnforcedAndShutdownRetiresNativeLease() {
        val peers = mutableListOf<FakePeer>()
        var keyCount = 0
        val callbacks = object : BrowserLinkServer.Callbacks {
            override fun code() = "1234"
            override fun status() = BrowserLinkStatus(BrowserLinkStatus.State.IDLE)
            override fun onTouch(contacts: List<AirPlayContact>) = true
            override fun onViewport(viewport: BrowserViewport) {}
            override fun onFit() {}
            override fun onKey(name: String) { keyCount++ }
            override fun onBrowserStats(stats: Map<String, Any?>) {}
            override fun log(message: String) {}
        }
        val server = BrowserLinkServer(WebVideoHub(), callbacks, "127.0.0.1", 0,
            rtcFactory = BrowserRtcFactory { session, control -> FakePeer(session, peers.size + 1, control).also(peers::add) })
        val port = server.start().getOrThrow()
        fun post(path: String, fields: Map<String, Any?>): Pair<Int, Map<*, *>> {
            val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.connectTimeout = 2_000; connection.readTimeout = 2_000
                connection.outputStream.use { it.write(WebJson.write(fields).toByteArray()) }
                val status = connection.responseCode
                val body = (if (status < 400) connection.inputStream else connection.errorStream).bufferedReader().use { it.readText() }
                return status to if (body.isEmpty()) emptyMap<String, Any?>() else WebJson.parse(body) as Map<*, *>
            } finally { connection.disconnect() }
        }
        val signaling = mapOf("c" to "1234", "s" to "rtc-session-0001", "offer" to "test-offer")
        try {
            assertEquals(401, post("/rtc", signaling + ("c" to "9999")).first)
            assertTrue(peers.isEmpty())
            val (status, answer) = post("/rtc", signaling)
            assertEquals(200, status)
            assertEquals("test-answer", answer["sdp"])
            assertEquals(1L, answer["epoch"])
            val batch = signaling.filterKeys { it != "offer" } + mapOf("q" to 0L, "e" to listOf(mapOf("k" to "key", "n" to "home")))
            assertEquals(0L, (WebJson.parse(peers[0].control(batch)) as Map<*, *>)["q"])
            assertEquals(1, keyCount)
            assertEquals(200, post("/rtc", signaling).first)
            assertTrue(peers[0].closed)
            try {
                peers[0].control(batch + ("q" to 1L))
                fail("retired same-session peer applied control")
            } catch (expected: IllegalStateException) { assertEquals("rtc-owner-retired", expected.message) }
            assertEquals(1, keyCount)
            peers[1].control(batch + ("q" to 1L))
            assertEquals(2, keyCount)
            assertEquals(204, post("/bye", signaling.filterKeys { it != "offer" }).first)
            assertTrue(peers[1].closed)
        } finally { server.stop() }
        assertTrue(peers.all { it.closed })
    }
}
