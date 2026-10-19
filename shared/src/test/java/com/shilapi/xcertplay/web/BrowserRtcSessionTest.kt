package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.AirPlayContact
import org.bouncycastle.crypto.agreement.srp.SRP6Client
import org.bouncycastle.crypto.agreement.srp.SRP6StandardGroups
import org.bouncycastle.crypto.digests.SHA256Digest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.math.BigInteger
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Real HTTP and SRP proofs exercise the host lifecycle without loading WebRTC JNI. */
class BrowserRtcSessionTest {
    private val code = "1234"
    private val session = "rtc-browser-session-0001"
    private val other = "rtc-browser-session-0002"
    private val offer = "v=0\r\no=browser 1 1 IN IP4 127.0.0.1\r\ns=TiPlay offer\r\n"
    private val answer = "v=0\r\no=phone 2 2 IN IP4 127.0.0.1\r\ns=TiPlay answer\r\n"
    @Volatile private var currentCode: String? = code
    @Volatile private var now = 100_000L
    private val seen = CopyOnWriteArrayList<String>()
    private val gone = CopyOnWriteArrayList<String>()
    private val keys = CopyOnWriteArrayList<String>()
    private val touches = CopyOnWriteArrayList<List<AirPlayContact>>()
    private val requests = CopyOnWriteArrayList<Pair<String, Map<String, Any?>>>()
    private val peers = CopyOnWriteArrayList<FakePeer>()
    private val identities = AtomicInteger()
    private val hub = WebVideoHub(Executor { it.run() })
    private val server = BrowserLinkServer(hub, object : BrowserLinkServer.Callbacks {
        override fun code() = currentCode
        override fun status() = BrowserLinkStatus(BrowserLinkStatus.State.STREAMING, touchAvailable = true)
        override fun onTouch(contacts: List<AirPlayContact>) = touches.add(contacts)
        override fun onBrowserSeen(session: String) { seen += session }
        override fun onBrowserGone(session: String) { gone += session }
        override fun onViewport(viewport: BrowserViewport) {}
        override fun onFit() {}
        override fun onKey(name: String) { keys += name }
        override fun onBrowserStats(stats: Map<String, Any?>) {}
        override fun log(message: String) {}
    }, "127.0.0.1", 0, nowMillis = { now }, audioHub = WebAudioHub())
    private var port = 0

    private inner class FakePeer(private val receive: (String) -> Unit, private val failure: (String) -> Unit) : BrowserRtcConnection {
        override val id = identities.incrementAndGet()
        val replies = CopyOnWriteArrayList<Map<*, *>>()
        val videos = CopyOnWriteArrayList<WebVideoRecord>()
        val audio = CopyOnWriteArrayList<ByteArray>()
        var receivedOffer: String? = null
        @Volatile var authenticated = false
        @Volatile var closed = false
        override fun answer(offerSdp: String, onAnswer: (String) -> Unit) { receivedOffer = offerSdp; onAnswer(this@BrowserRtcSessionTest.answer) }
        override fun authenticate() { authenticated = true }
        override fun sendControl(message: String): Boolean { replies += WebJson.parse(message) as Map<*, *>; return !closed }
        override fun sendVideo(record: WebVideoRecord): Boolean { videos += record; return !closed }
        override fun sendAudio(record: ByteArray): Boolean { audio += record; return !closed }
        override fun close() { closed = true }
        fun rpc(type: String, values: Map<String, Any?> = emptyMap()): Map<*, *> {
            val id = replies.size + 1
            receive(WebJson.write(values + mapOf("id" to id, "type" to type)))
            return replies.last { (it["id"] as Number).toInt() == id }
        }
        fun raw(message: String) = receive(message)
        fun fail(reason: String) = failure(reason)
    }

    @Before fun start() {
        server.rtcFactory = BrowserRtcFactory { receive, failure -> FakePeer(receive, failure).also { peers += it } }
        port = server.start().getOrThrow()
    }
    @After fun stop() { server.stop() }

    private data class Response(val status: Int, val json: Map<*, *>)
    private fun post(path: String, body: Map<String, Any?>): Response {
        requests += path to body
        val encoded = WebJson.write(body).toByteArray(Charsets.UTF_8)
        return Socket("127.0.0.1", port).use { socket ->
            socket.soTimeout = 5000
            socket.getOutputStream().apply {
                write(("POST $path HTTP/1.1\r\nHost: 127.0.0.1:$port\r\nOrigin: https://tiplay.example\r\n" +
                    "Content-Type: text/plain;charset=UTF-8\r\nContent-Length: ${encoded.size}\r\nConnection: close\r\n\r\n").toByteArray())
                write(encoded); flush()
            }
            val input = BufferedInputStream(socket.getInputStream())
            val header = ByteArrayOutputStream()
            while (!header.toString("ISO-8859-1").endsWith("\r\n\r\n")) {
                val byte = input.read(); check(byte >= 0) { "Server closed before HTTP headers" }; header.write(byte)
            }
            val lines = header.toString("ISO-8859-1").split("\r\n")
            val status = lines.first().split(' ')[1].toInt()
            val length = lines.firstOrNull { it.startsWith("Content-Length:", true) }?.substringAfter(':')?.trim()?.toInt() ?: 0
            val bytes = ByteArray(length)
            var offset = 0
            while (offset < length) { val count = input.read(bytes, offset, length - offset); check(count > 0); offset += count }
            val value = if (length == 0) emptyMap<Any?, Any?>() else WebJson.parse(String(bytes, Charsets.UTF_8)) as Map<*, *>
            Response(status, value)
        }
    }

    private inner class Proof(val browserSession: String = session, password: String = code) {
        val challenge = post("/rtc/pair/start", mapOf("s" to browserSession)).also { assertEquals(200, it.status) }.json
        val client = SRP6Client().apply { init(SRP6StandardGroups.rfc5054_2048, SHA256Digest(), SecureRandom()) }
        private val saltText = challenge["salt"] as String
        val a: String = client.generateClientCredentials(hexBytes(saltText), BrowserRtcPairing.IDENTITY.toByteArray(), password.toByteArray()).toString(16)
        val m1: String = run {
            client.calculateSecret(BigInteger(challenge["B"] as String, 16))
            client.calculateClientEvidenceMessage().toString(16)
        }
        fun finish(s: String = browserSession, sentOffer: String = offer, extra: Map<String, Any?> = emptyMap()) =
            post("/rtc/pair/finish", mapOf("s" to s, "id" to challenge["id"], "A" to a, "M1" to m1, "offer" to sentOffer) + extra)
        fun expectedBinding(result: Map<*, *>, boundOffer: String = offer, boundAnswer: String = result["sdp"] as String,
                            identity: Long = (result["session"] as Number).toLong()): String {
            assertTrue(client.verifyServerEvidenceMessage(BigInteger(result["M2"] as String, 16)))
            val integerKey = client.calculateSessionKey().toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
            val key = ByteArray(32).also { integerKey.copyInto(it, 32 - integerKey.size) }
            val fields = listOf(BrowserRtcPairing.PROTOCOL, challenge["id"] as String, browserSession,
                a, challenge["B"] as String, saltText, boundOffer, boundAnswer, identity.toString())
            val transcript = ByteArrayOutputStream()
            DataOutputStream(transcript).use { output -> fields.forEach { value ->
                val bytes = value.toByteArray(Charsets.UTF_8); output.writeInt(bytes.size); output.write(bytes)
            } }
            val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
            return mac.doFinal(transcript.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
        }
    }
    private fun hexBytes(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun paired(s: String = session): FakePeer {
        assertEquals(200, Proof(s).finish().status)
        return peers.last()
    }
    private fun auth(peer: FakePeer, s: String = session, c: String = code) = peer.rpc("auth", mapOf("s" to s, "c" to c, "codecs" to "avc1", "timing" to 1, "lifecycle" to 1))
    private fun result(reply: Map<*, *>) = reply["result"] as Map<*, *>
    private fun eventually(message: String, predicate: () -> Boolean) {
        val end = System.nanoTime() + 3_000_000_000L
        while (!predicate() && System.nanoTime() < end) Thread.sleep(10)
        assertTrue(message, predicate())
    }

    @Test fun authenticatedLifecycleRoutesControlClockAndByeWithoutHttpSecrets() {
        val proof = Proof()
        val response = proof.finish()
        assertEquals(200, response.status)
        assertEquals(proof.expectedBinding(response.json), response.json["binding"])
        val peer = peers.single()
        assertEquals(offer, peer.receivedOffer)
        assertFalse(peer.authenticated)
        assertTrue(peer.videos.isEmpty())
        val hello = auth(peer)
        assertEquals(true, hello["ok"])
        assertEquals("TiPlay", result(hello)["app"])
        assertEquals("webrtc", result(hello)["transport"])
        assertTrue((result(hello)["resourceToken"] as String).length >= 32)
        assertTrue(peer.authenticated)
        assertTrue(session in seen)
        val status = peer.rpc("control", mapOf("q" to 1, "e" to listOf(mapOf("k" to "key", "n" to "home"))))
        assertEquals(true, status["ok"])
        assertEquals(listOf("home"), keys.toList())
        assertTrue(result(peer.rpc("clock"))["clockMs"] is Number)
        assertEquals(true, peer.rpc("bye")["ok"])
        eventually("bye retires RTC", { peer.closed })
        assertTrue(session in gone)
        assertTrue(requests.all { (path, body) -> !path.contains(code) && !body.containsKey("c") && !body.containsKey("code") })
    }

    @Test fun wrongPasswordNeverCreatesAPeer() {
        assertEquals(401, Proof(password = "9999").finish().status)
        assertTrue(peers.isEmpty())
    }

    @Test fun challengeIsSingleUseEvenWhenTheFirstProofSucceeds() {
        val proof = Proof()
        assertEquals(200, proof.finish().status)
        assertEquals(401, proof.finish().status)
        assertEquals(1, peers.size)
    }

    @Test fun proofCannotMoveToAnotherBrowserSession() {
        val proof = Proof()
        assertEquals(401, proof.finish(s = other).status)
        assertEquals(401, proof.finish().status)
        assertTrue(peers.isEmpty())
    }

    @Test fun codeRotationInvalidatesAnOutstandingPairingProof() {
        val proof = Proof(); currentCode = "5678"
        assertEquals(401, proof.finish().status)
        assertTrue(peers.isEmpty())
    }

    @Test fun fiveBadProofsLockOutTheCorrectPasswordAcrossHttpAndRtc() {
        val existing = paired(); auth(existing)
        repeat(BrowserPairingGate.MAX_FAILURES) { assertEquals(401, Proof(password = "9999").finish().status) }
        assertEquals(429, post("/rtc/pair/start", mapOf("s" to session)).status)
        val denied = existing.rpc("control", mapOf("q" to 1, "e" to emptyList<Any>()))
        assertEquals(429, (denied["status"] as Number).toInt())
        eventually("online lockout retires the prior peer", { existing.closed })
        now += BrowserPairingGate.LOCKOUT_MILLIS + 1
        assertEquals(200, Proof().finish().status)
    }

    @Test fun signalingRejectsPlaintextCodeFieldsAtBothEndpoints() {
        assertEquals(400, post("/rtc/pair/start", mapOf("s" to session, "c" to code)).status)
        val proof = Proof()
        assertEquals(400, proof.finish(extra = mapOf("code" to code)).status)
        assertEquals(200, proof.finish().status)
    }

    @Test fun transcriptBindingDetectsOfferAnswerAndRtcIdentityTampering() {
        val proof = Proof()
        val altered = offer + "a=changed:1\r\n"
        val response = proof.finish(sentOffer = altered)
        assertEquals(200, response.status)
        val binding = response.json["binding"]
        assertEquals(proof.expectedBinding(response.json, boundOffer = altered), binding)
        assertNotEquals(proof.expectedBinding(response.json, boundOffer = offer), binding)
        assertNotEquals(proof.expectedBinding(response.json, boundOffer = altered, boundAnswer = answer + "x"), binding)
        assertNotEquals(proof.expectedBinding(response.json, boundOffer = altered, identity = 9999), binding)
    }

    @Test fun unauthenticatedControlHasNoEffectsAndClosesThePeer() {
        val peer = paired()
        val reply = peer.rpc("control", mapOf("q" to 1, "e" to listOf(mapOf("k" to "key", "n" to "home"))))
        assertEquals(401, (reply["status"] as Number).toInt())
        assertTrue(keys.isEmpty()); assertFalse(peer.authenticated)
        eventually("unauthenticated RPC closes peer", { peer.closed })
    }

    @Test fun incorrectEncryptedAuthDoesNotStartMedia() {
        val peer = paired()
        assertEquals(401, (auth(peer, c = "9999")["status"] as Number).toInt())
        assertFalse(peer.authenticated); assertTrue(peer.videos.isEmpty())
        eventually("wrong auth closes peer", { peer.closed })
    }

    @Test fun newAuthenticatedSessionRetiresTheOldOwner() {
        val first = paired(); assertEquals(true, auth(first)["ok"])
        val second = paired(other); assertEquals(true, auth(second, s = other)["ok"])
        assertTrue(first.closed); assertFalse(second.closed)
        assertTrue(session in gone); assertTrue(other in seen)
    }

    @Test fun sameSessionReconnectRetiresOldPeerWithoutReleasingTheNewOwnersTouches() {
        val first = paired(); auth(first)
        val second = paired(); assertEquals(true, auth(second)["ok"])
        assertTrue("the prior RTC peer with the same browser session must retire", first.closed)
        val touch = mapOf("k" to "t", "p" to listOf(listOf(0, 0.4, 0.5, true)))
        assertEquals(true, second.rpc("control", mapOf("q" to 1, "e" to listOf(touch)))["ok"])
        assertTrue(touches.last().any { it.down })
        val count = touches.size
        first.fail("late old transport close")
        first.raw(WebJson.write(mapOf("id" to 999, "type" to "control", "q" to 999,
            "e" to listOf(mapOf("k" to "t", "p" to emptyList<Any>())))))
        assertEquals("old callbacks cannot release the new connection's fingers", count, touches.size)
        assertFalse(second.closed)
        assertEquals(true, second.rpc("control", mapOf("q" to 2, "e" to listOf(touch)))["ok"])
        assertTrue(touches.last().any { it.down })
    }

    @Test fun oldAuthenticatedPeerCannotApplyControlsAfterCodeRotation() {
        val old = paired(); auth(old)
        currentCode = "5678"
        val reply = old.rpc("control", mapOf("q" to 1, "e" to listOf(mapOf("k" to "key", "n" to "home"))))
        assertEquals(409, (reply["status"] as Number).toInt())
        assertTrue(keys.isEmpty())
        eventually("code rotation retires the old authenticated peer", { old.closed })
    }

    @Test fun codeRotationAndDisabledPairingRetireExistingPeers() {
        val peer = paired(); auth(peer)
        currentCode = null
        now += 1
        eventually("disabled pairing closes authenticated peer", { peer.closed })
        assertEquals(401, post("/rtc/pair/start", mapOf("s" to other)).status)
    }

    @Test fun pendingAuthenticationAndStaleAuthenticatedPeersHaveFiniteLifetimes() {
        val pending = paired(); now += 15_001
        eventually("pending auth times out", { pending.closed })
        val live = paired(); auth(live)
        now += BrowserPairingGate.STALE_MILLIS + 1
        eventually("authenticated peer expires without heartbeat", { live.closed })
    }

    @Test fun malformedControlRetiresPeerWithoutCallingProductControls() {
        val peer = paired(); auth(peer)
        peer.raw("{broken")
        assertTrue(peer.closed); assertTrue(keys.isEmpty())
    }

    @Test fun signalingFailureReleasesFinitePeerSlots() {
        server.rtcFactory = BrowserRtcFactory { _, _ -> throw IllegalStateException("test create failure") }
        repeat(4) { assertEquals(503, Proof().finish().status) }
        server.rtcFactory = BrowserRtcFactory { receive, failure -> FakePeer(receive, failure).also { peers += it } }
        assertEquals(200, Proof().finish().status)
    }

    @Test fun stopClosesEveryPendingOrAuthenticatedPeer() {
        val first = paired(); auth(first)
        val pending = paired(other)
        server.stop()
        assertTrue(first.closed); assertTrue(pending.closed)
    }
}
