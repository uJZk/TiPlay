package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.AirPlayContact
import org.bouncycastle.crypto.agreement.srp.SRP6Client
import org.bouncycastle.crypto.agreement.srp.SRP6StandardGroups
import org.bouncycastle.crypto.digests.SHA256Digest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArrayList
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Real HTTP/SRP/SDP binding and DTLS-control ownership, with only Android JNI replaced. */
class BrowserRtcSignalingTest {
    private val code = "1234"
    private val session = "rtc-session-0001"
    private val offer = "v=0\r\ns=test-offer\r\n"
    private val peers = CopyOnWriteArrayList<FakePeer>()
    private val keys = CopyOnWriteArrayList<String>()
    private val statistics = CopyOnWriteArrayList<Map<String, Any?>>()
    private var browserSeen = 0
    private val hub = WebVideoHub()
    private val audio = WebAudioHub()
    private val audioLease = audio.subscribe()
    private val callbacks = object : BrowserLinkServer.Callbacks {
        override fun code() = code
        override fun status() = BrowserLinkStatus(BrowserLinkStatus.State.IDLE)
        override fun onTouch(contacts: List<AirPlayContact>): Boolean = true
        override fun onViewport(viewport: BrowserViewport) {}
        override fun onFit() {}
        override fun onKey(name: String) { keys += name }
        override fun onBrowserSeen(session: String) { browserSeen++ }
        override fun onBrowserStats(stats: Map<String, Any?>) { statistics += stats }
        override fun log(message: String) {}
    }
    private val server = BrowserLinkServer(hub, callbacks, "127.0.0.1", 0, audioHub = audio,
        rtcFactory = BrowserRtcFactory { session, control -> FakePeer(session, peers.size + 1, control).also(peers::add) })
    private var port = 0
    @Before fun start() { port = server.start().getOrThrow() }
    @After fun stop() { server.stop(); audioLease.close() }

    private class FakePeer(override val session: String, override val epoch: Int,
                           val control: (Map<*, *>) -> String) : BrowserRtcSession {
        var closed = false
        var authenticated = false
        override val live get() = !closed
        override fun answer(offer: String): String { check(offer.startsWith("v=0")); return "v=0\r\ns=test-answer\r\n" }
        override fun snapshot(): Map<String, Any?> = mapOf("epoch" to epoch)
        override fun maintain() {}
        override fun authenticate() { authenticated = true }
        override fun close() { closed = true }
        fun rpc(fields: Map<String, Any?>): Map<*, *> {
            val wire = WebJson.parse(WebJson.write(fields)) as Map<*, *>
            val result = WebJson.parse(control(wire)) as Map<*, *>
            if (fields["k"] == "auth") authenticate()
            return result
        }
    }
    private data class Response(val status: Int, val json: Map<*, *>)
    private fun request(path: String, body: Map<String, Any?>? = null): Response {
        val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 3_000; connection.readTimeout = 3_000
            if (body != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.outputStream.use { it.write(WebJson.write(body).toByteArray()) }
            }
            val status = connection.responseCode
            val text = (if (status < 400) connection.inputStream else connection.errorStream).bufferedReader().use { it.readText() }
            return Response(status, if (text.isEmpty()) emptyMap<String, Any?>() else WebJson.parse(text) as Map<*, *>)
        } finally { connection.disconnect() }
    }
    private inner class Proof(val s: String = session, password: String = code) {
        val challenge = request("/rtc/pair/start", mapOf("s" to s)).also { assertEquals(200, it.status) }.json
        val client = SRP6Client().apply { init(SRP6StandardGroups.rfc5054_2048, SHA256Digest(), SecureRandom()) }
        val salt = challenge["salt"] as String
        val a = client.generateClientCredentials(salt.chunked(2).map { it.toInt(16).toByte() }.toByteArray(),
            BrowserRtcPairing.IDENTITY.toByteArray(), password.toByteArray()).toString(16)
        val proof: String = run {
            client.calculateSecret(BigInteger(challenge["B"] as String, 16))
            client.calculateClientEvidenceMessage().toString(16)
        }
        fun finish(extra: Map<String, Any?> = emptyMap()) = request("/rtc/pair/finish", mapOf(
            "s" to s, "id" to challenge["id"], "A" to a, "M1" to proof, "offer" to offer) + extra)
        fun verifyBinding(answer: Map<*, *>) {
            assertTrue(client.verifyServerEvidenceMessage(BigInteger(answer["M2"] as String, 16)))
            val integer = client.calculateSessionKey().toByteArray().let { if (it.size > 32) it.takeLast(32).toByteArray() else it }
            val key = ByteArray(32).also { integer.copyInto(it, 32 - integer.size) }
            val bytes = ByteArrayOutputStream()
            DataOutputStream(bytes).use { out ->
                listOf(BrowserRtcPairing.PROTOCOL, challenge["id"], s, a, challenge["B"], salt,
                    offer, answer["sdp"], answer["session"].toString()).forEach { value ->
                    val text = value.toString().toByteArray(); out.writeInt(text.size); out.write(text)
                }
            }
            val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
            assertEquals(mac.doFinal(bytes.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }, answer["binding"])
        }
    }
    private fun pair(s: String = session): FakePeer {
        val proof = Proof(s)
        val result = proof.finish()
        assertEquals(200, result.status); proof.verifyBinding(result.json)
        assertFalse("Resource capability must not cross plaintext HTTP", result.json.containsKey("resourceToken"))
        return peers.last()
    }
    private fun auth(peer: FakePeer): Map<*, *> = peer.rpc(mapOf("k" to "auth", "q" to 1L, "s" to peer.session, "c" to code))

    @Test fun productRequiresWebRtcForMediaControlsAndPlaintextSignalingBeforeAdmission() {
        for (path in listOf("/video", "/audio", "/control", "/rtc")) {
            val result = if (path in listOf("/control", "/rtc")) request(path, mapOf("c" to code, "s" to session, "q" to 0, "e" to emptyList<Any>()))
                else request("$path?c=$code&s=$session")
            assertEquals(path, 410, result.status)
            assertEquals("transport-required", result.json["error"])
        }
        assertEquals(0, browserSeen); assertTrue(peers.isEmpty())
        assertEquals(false, hub.snapshot()["viewer"])
        assertFalse(audioLease.closed)
        assertEquals(200, request("/hello").status)
    }

    @Test fun srpBindsBothSdpsAndOnlyAuthenticatedDtlsControlGetsOwnershipAndResourceToken() {
        assertEquals(400, request("/rtc/pair/start", mapOf("s" to session, "c" to code)).status)
        val peer = pair()
        assertFalse(peer.authenticated); assertEquals(0, browserSeen)
        assertThrows(IllegalStateException::class.java) { peer.rpc(mapOf("q" to 1, "s" to session, "e" to emptyList<Any>())) }
        val hello = auth(peer)
        assertTrue(peer.authenticated)
        assertEquals("TiPlay", hello["app"])
        assertTrue(hello["clockMs"] is Number)
        val token = hello["resourceToken"] as String
        assertTrue(Regex("[A-Za-z0-9_-]{43}").matches(token))
        val batch = mapOf("q" to 1L, "s" to session, "e" to listOf(mapOf("k" to "key", "n" to "home")))
        assertEquals(1L, peer.rpc(batch)["q"])
        assertEquals(listOf("home"), keys.toList())
        assertEquals(401, request("/bye", mapOf("s" to session, "c" to code)).status)
        assertEquals(204, request("/bye", mapOf("s" to session, "c" to token)).status)
        assertTrue(peer.closed)
    }

    @Test fun sameSessionReplacementRejectsRetiredPeerControlAndByeZeroDoesNotConsumeApplicationSequence() {
        val old = pair(); auth(old)
        val next = pair(); assertTrue(old.closed); auth(next)
        val batch = mapOf("q" to 1L, "s" to session, "e" to listOf(mapOf("k" to "key", "n" to "home")))
        assertThrows(IllegalStateException::class.java) { old.rpc(batch) }
        assertEquals(1L, next.rpc(batch)["q"])
        assertEquals(listOf("home"), keys.toList())
        assertEquals(0L, next.rpc(mapOf("k" to "bye", "q" to 0L, "s" to session))["q"])
    }

    @Test fun wrongSrpProofIsOneShotAndSharesTheOnlineGuessBudget() {
        repeat(5) {
            val wrong = Proof(password = "9999")
            assertEquals(401, wrong.finish().status)
        }
        assertEquals(429, request("/rtc/pair/start", mapOf("s" to session)).status)
        assertTrue(peers.isEmpty())
    }

    @Test fun realBrowserStandardSelectorFixtureReachesTypedControlStatsCallback() {
        val fixture = WebJson.parse(File("src/test/resources/Browser-standard-diagnostics-v1.json").readText()) as Map<*, *>
        val peer = pair(); auth(peer)
        peer.rpc(mapOf("q" to 1L, "s" to session, "e" to listOf(mapOf("k" to fixture["k"], "v" to fixture["v"]))))
        assertEquals(fixture["v"], statistics.single())
    }
}
