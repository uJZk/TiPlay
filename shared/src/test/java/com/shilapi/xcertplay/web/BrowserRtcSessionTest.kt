package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.AirPlayContact
import com.shilapi.xcertplay.airplay.VideoCodec
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
import java.nio.ByteBuffer
import java.nio.ByteOrder
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
    private val logs = CopyOnWriteArrayList<String>()
    private val videoDiagnostics = CopyOnWriteArrayList<Map<String, Any?>>()
    private val identities = AtomicInteger()
    private val hub = WebVideoHub(Executor { it.run() })
    private val audioHub = WebAudioHub()
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
        override fun onBrowserVideoDiagnostics(stats: Map<String, Any?>) { videoDiagnostics += stats }
        override fun log(message: String) { logs += message }
    }, "127.0.0.1", 0, nowMillis = { now }, audioHub = audioHub)
    private var port = 0

    private inner class FakePeer(private val receive: (String) -> Unit, private val failure: (String) -> Unit) : BrowserRtcConnection {
        override val id = identities.incrementAndGet()
        val replies = CopyOnWriteArrayList<Map<*, *>>()
        val videos = CopyOnWriteArrayList<WebVideoRecord>()
        val audio = CopyOnWriteArrayList<ByteArray>()
        var receivedOffer: String? = null
        @Volatile var allowSend = true
        @Volatile var authenticated = false
        @Volatile var closed = false
        @Volatile var diagnosticSnapshot = emptyMap<String, Any?>()
        @Volatile var diagnosticFailure: RuntimeException? = null
        @Volatile var closeFailure: RuntimeException? = null
        override fun answer(offerSdp: String, onAnswer: (String) -> Unit) { receivedOffer = offerSdp; onAnswer(this@BrowserRtcSessionTest.answer) }
        override fun authenticate() { authenticated = true }
        override fun sendControl(message: String): Boolean { replies += WebJson.parse(message) as Map<*, *>; return allowSend && !closed }
        override fun sendVideo(record: WebVideoRecord): Boolean { videos += record; return !closed }
        override fun sendAudio(record: ByteArray): Boolean { audio += record; return !closed }
        override fun diagnostics(): Map<String, Any?> {
            diagnosticFailure?.let { throw it }
            return diagnosticSnapshot
        }
        override fun close() { closed = true; closeFailure?.let { throw it } }
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

    private fun videoDiagnostic(sample: Int) = linkedMapOf<String, Any?>("schema" to 1, "pageVersion" to "v71",
        "sample" to sample, "streamGeneration" to 2, "epoch" to 7, "raw.readFrames" to sample * 60,
        "raw.scheduledDroppedFrames" to sample, "raw.mode" to "carplay", "interval.state" to "valid")

    private fun diagnosticJournal(file: java.io.File): List<Map<*, *>> = file.readLines().map { it.split('\t') }
        .filter { it.size == 5 && it[2] == "browser/video-diagnostics" }
        .map { WebJson.parse(String(java.util.Base64.getDecoder().decode(it[4]), Charsets.UTF_8)) as Map<*, *> }
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

    @Test fun rtcControlJournalsEveryValidatedVideoSampleAndRetiresCaptureTokensAcrossClearAndDisable() {
        val directory = java.nio.file.Files.createTempDirectory("rtc-video-diagnostics").toFile()
        val capture = java.io.File(directory, "capture.tsv")
        try {
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, true)
            com.shilapi.xcertplay.diagnostics.RawTraffic.clear()
            val peer = paired(); auth(peer)
            var sequence = 0
            fun emit(sample: Int, captureId: String) = peer.rpc("control", mapOf("q" to ++sequence, "e" to listOf(
                mapOf("k" to "video-diag", "d" to captureId, "v" to videoDiagnostic(sample)))))
            val original = requireNotNull(com.shilapi.xcertplay.diagnostics.RawTraffic.activeSessionId())
            assertEquals(true, emit(1, original)["ok"])
            assertEquals(true, emit(2, original)["ok"])
            assertEquals("Diagnostic samples must not use the ordinary ten-second stats throttle", listOf(1L, 2L), videoDiagnostics.map { it["sample"] })
            assertEquals(videoDiagnostics.toList(), diagnosticJournal(capture))
            com.shilapi.xcertplay.diagnostics.RawTraffic.clear()
            val cleared = requireNotNull(com.shilapi.xcertplay.diagnostics.RawTraffic.activeSessionId())
            emit(3, original)
            assertEquals(2, videoDiagnostics.size); assertTrue(diagnosticJournal(capture).isEmpty())
            emit(4, cleared)
            assertEquals(listOf(4L), diagnosticJournal(capture).map { it["sample"] })
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, false)
            emit(5, cleared)
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, true)
            emit(6, cleared)
            assertEquals(3, videoDiagnostics.size)
            val reopened = requireNotNull(com.shilapi.xcertplay.diagnostics.RawTraffic.activeSessionId())
            emit(7, reopened)
            assertEquals(listOf(1L, 2L, 4L, 7L), videoDiagnostics.map { it["sample"] })
            assertEquals(listOf(4L, 7L), diagnosticJournal(capture).map { it["sample"] })
            assertFalse("Safe journal contains no pairing credentials or video payload", diagnosticJournal(capture).any {
                it.containsKey("c") || it.containsKey("s") || it.containsKey("payload") || it.containsKey("d")
            })
            assertFalse(peer.closed)
        } finally {
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, false)
            directory.deleteRecursively()
        }
    }

    @Test fun rtcVideoDiagnosticsRejectMalformedOversizedOrUnversionedReportsWithoutInterruptingControl() {
        val directory = java.nio.file.Files.createTempDirectory("rtc-invalid-video-diagnostics").toFile()
        val capture = java.io.File(directory, "capture.tsv")
        try {
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, true)
            com.shilapi.xcertplay.diagnostics.RawTraffic.clear()
            val peer = paired(); auth(peer)
            val id = requireNotNull(com.shilapi.xcertplay.diagnostics.RawTraffic.activeSessionId())
            val invalid = listOf(
                videoDiagnostic(1) + ("schema" to 2), videoDiagnostic(1) - "schema",
                videoDiagnostic(1) + ("raw.readFrames" to "100.111.111.111"),
                videoDiagnostic(1) + ("raw.readFrames" to mapOf("hidden" to 1)),
                videoDiagnostic(1) + ("code" to "private-pin"), videoDiagnostic(1) + ("pageVersion" to "x".repeat(20_000)),
                videoDiagnostic(1) + (0..256).associate { "field$it" to it },
            )
            invalid.forEachIndexed { index, values ->
                assertEquals(true, peer.rpc("control", mapOf("q" to index + 1, "e" to listOf(mapOf("k" to "video-diag", "d" to id, "v" to values))))["ok"])
            }
            assertTrue(videoDiagnostics.isEmpty()); assertTrue(diagnosticJournal(capture).isEmpty()); assertFalse(peer.closed)
            assertEquals(true, peer.rpc("control", mapOf("q" to 99, "e" to listOf(mapOf("k" to "key", "n" to "home"))))["ok"])
            assertEquals(listOf("home"), keys.toList())
        } finally {
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, false)
            directory.deleteRecursively()
        }
    }

    @Test fun failedDiagnosticJournalAppendCannotInvokeMetadataCallback() {
        val directory = java.nio.file.Files.createTempDirectory("rtc-failed-video-journal").toFile()
        val capture = java.io.File(directory, "capture.tsv")
        try {
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, true)
            com.shilapi.xcertplay.diagnostics.RawTraffic.clear()
            val peer = paired(); auth(peer)
            val id = requireNotNull(com.shilapi.xcertplay.diagnostics.RawTraffic.activeSessionId())
            assertTrue(capture.delete()); assertTrue(capture.mkdir())
            assertEquals(true, peer.rpc("control", mapOf("q" to 1, "e" to listOf(mapOf("k" to "video-diag", "d" to id, "v" to videoDiagnostic(1)))))["ok"])
            assertTrue(videoDiagnostics.isEmpty())
            assertTrue((com.shilapi.xcertplay.diagnostics.RawTraffic.integrity()["failures"] as Long) > 0)
            assertFalse(peer.closed)
        } finally {
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, false)
            capture.deleteRecursively()
            com.shilapi.xcertplay.diagnostics.RawTraffic.clear()
            directory.deleteRecursively()
        }
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

    @Test fun unauthenticatedIceFailureKeepsBoundedConnectionSummaryBeforeLargeMediaCounters() {
        val peer = paired()
        peer.closeFailure = NativeCloseFailureWithAnExceptionTypeNameLongerThanFortyEightCharacters()
        peer.diagnosticSnapshot = linkedMapOf(
            "video" to mapOf("privatePayload" to "x".repeat(3000)),
            "authenticated" to false, "ready" to false, "closed" to false,
            "networkMode" to "android-network-monitor",
            "localCandidateCount" to Int.MAX_VALUE, "remoteCandidateCount" to Int.MAX_VALUE,
            "localIPv4LinkLocalCandidateCount" to Int.MAX_VALUE, "remoteIPv4LinkLocalCandidateCount" to Int.MAX_VALUE,
            "iceGatheringState" to "DISCONNECTED", "iceConnectionState" to "DISCONNECTED", "peerConnectionState" to "DISCONNECTED",
            "privateAddress" to "169.254.111.111", "sdp" to "private SDP",
        )
        peer.fail("WebRTC ICE failed")
        assertTrue(peer.closed); assertFalse(peer.authenticated)
        val prefix = "Browser RTC: connection summary "
        val summary = logs.single { it.startsWith(prefix) }
        assertTrue("connection diagnostics must survive the host's 700-character log bound", summary.length < 700)
        assertTrue(logs.indexOf(summary) < logs.indexOfFirst { it.startsWith("Browser RTC: final stages ") })
        val value = WebJson.parse(summary.removePrefix(prefix)) as Map<*, *>
        assertEquals(false, value["authenticated"]); assertEquals(false, value["ready"])
        assertEquals(true, value["closed"]); assertEquals(true, value["peerInitialized"])
        assertEquals("android-network-monitor", value["networkMode"])
        assertEquals(Int.MAX_VALUE.toLong(), value["localCandidateCount"])
        assertEquals(Int.MAX_VALUE.toLong(), value["localIPv4LinkLocalCandidateCount"])
        assertEquals("DISCONNECTED", value["iceGatheringState"]); assertEquals("DISCONNECTED", value["iceConnectionState"])
        assertEquals(48, (value["closeError"] as String).length)
        assertFalse(summary.contains("private")); assertFalse(summary.contains("169.254")); assertFalse(value.containsKey("video"))
    }

    private class NativeCloseFailureWithAnExceptionTypeNameLongerThanFortyEightCharacters : RuntimeException()

    @Test fun diagnosticCollectionFailureStillLogsConnectionSummaryAndRetiresUnauthenticatedPeer() {
        val peer = paired()
        peer.diagnosticFailure = IllegalStateException("private SDP must not enter summary")
        peer.fail("WebRTC authentication timed out")
        assertTrue(peer.closed); assertFalse(peer.authenticated)
        val prefix = "Browser RTC: connection summary "
        val summary = logs.single { it.startsWith(prefix) }
        assertTrue(summary.length < 700)
        val value = WebJson.parse(summary.removePrefix(prefix)) as Map<*, *>
        assertEquals(false, value["authenticated"]); assertEquals(true, value["closed"])
        assertEquals("failed", value["diagnostics"]); assertEquals("IllegalStateException", value["diagnosticError"])
        assertFalse(logs.any { it.contains("private SDP") })
        assertFalse(logs.any { it.startsWith("Browser RTC: final stages ") })
        assertEquals(200, Proof(other).finish().status)
    }

    @Test fun factoryFailureLogsConnectionSummaryBeforePeerInstallation() {
        server.rtcFactory = BrowserRtcFactory { _, _ -> throw IllegalStateException("private initialization detail") }
        assertEquals(503, Proof().finish().status)
        val prefix = "Browser RTC: connection summary "
        val summary = logs.single { it.startsWith(prefix) }
        assertTrue(summary.length < 700)
        val value = WebJson.parse(summary.removePrefix(prefix)) as Map<*, *>
        assertEquals(false, value["authenticated"]); assertEquals(true, value["closed"])
        assertEquals(false, value["peerInitialized"]); assertEquals("no-peer", value["diagnostics"])
        assertFalse(summary.contains("private"))
    }

    @Test fun videoProducerChangeAndEndPreservePeerAudioTimelineAndTouchOwnership() {
        val avcc = byteArrayOf(1, 0x64, 0x00, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0x00, 0x28, 1, 0, 2, 0x68, -18)
        val idr = byteArrayOf(0, 0, 0, 1, 0x65, 1, 2, 3)
        val firstSource = Any(); val secondSource = Any(); val thirdSource = Any(); val audioSource = Any()
        fun begin(owner: Any) {
            hub.beginStream(owner, 1182, 920, 60, {}, {})
            hub.configure(owner, VideoCodec.H264, avcc)
        }
        fun configs(peer: FakePeer) = peer.videos.filter { it.kind == WebVideoRecords.KIND_CONFIG }
        fun frames(peer: FakePeer) = peer.videos.filter { it.kind == WebVideoRecords.KIND_FRAME }
        fun idleCount(peer: FakePeer) = peer.videos.count { it.kind == WebVideoRecords.KIND_IDLE }
        begin(firstSource); audioHub.begin(audioSource)
        val peer = paired(); assertEquals(true, auth(peer)["ok"])
        eventually("initial source configuration reaches the authenticated peer", { configs(peer).size == 1 })
        hub.frame(firstSource, idr, 1_000_000_000L, System.nanoTime())
        eventually("initial source key frame is delivered", { frames(peer).size == 1 })
        val initialEpoch = frames(peer).last().epoch
        val firstPcm = byteArrayOf(1, 2, 3, 4)
        audioHub.publish(audioSource, 0, 48000, 2, firstPcm)
        eventually("initial independent audio reaches peer", { peer.audio.any { it.size == 32 && it.copyOfRange(28, 32).contentEquals(firstPcm) } })
        val touch = mapOf("k" to "t", "p" to listOf(listOf(0, 0.4, 0.5, true)))
        assertEquals(true, peer.rpc("control", mapOf("q" to 1, "e" to listOf(touch)))["ok"])
        val beforeChange = idleCount(peer)

        begin(secondSource)
        eventually("source change emits idle and new configuration", { idleCount(peer) > beforeChange && configs(peer).size == 2 })
        hub.frame(secondSource, idr, 2_000_000_000L, System.nanoTime())
        eventually("replacement source key frame reaches the same peer", { frames(peer).size == 2 })
        assertTrue(frames(peer).last().epoch > initialEpoch)
        val secondPcm = byteArrayOf(5, 6, 7, 8)
        audioHub.publish(audioSource, 0, 48000, 2, secondPcm)
        eventually("audio continues through video source change", { peer.audio.any { it.size == 32 && it.copyOfRange(28, 32).contentEquals(secondPcm) } })
        assertEquals(true, peer.rpc("control", mapOf("q" to 2, "e" to listOf(touch)))["ok"])
        assertTrue(touches.last().any { it.down })
        val beforeEnd = idleCount(peer)

        hub.endStream(secondSource)
        eventually("ending video leaves the same peer idle", { idleCount(peer) > beforeEnd })
        val thirdPcm = byteArrayOf(9, 10, 11, 12)
        audioHub.publish(audioSource, 0, 48000, 2, thirdPcm)
        eventually("audio continues while video has ended", { peer.audio.any { it.size == 32 && it.copyOfRange(28, 32).contentEquals(thirdPcm) } })
        begin(thirdSource)
        eventually("video restarts with a fresh configuration on the same peer", { configs(peer).size == 3 })
        hub.frame(thirdSource, idr, 3_000_000_000L, System.nanoTime())
        eventually("restarted video key frame is delivered", { frames(peer).size == 3 })
        assertEquals(true, peer.rpc("control", mapOf("q" to 3, "e" to listOf(touch)))["ok"])
        assertTrue(touches.last().any { it.down })
        val pcm = peer.audio.filter { it.size == 32 }
        assertEquals("video lifecycle never resets the independent audio epoch", 1,
            pcm.map { ByteBuffer.wrap(it).order(ByteOrder.BIG_ENDIAN).getInt(16) }.toSet().size)
        val sequences = pcm.map { ByteBuffer.wrap(it).order(ByteOrder.BIG_ENDIAN).getInt(12) }
        assertEquals(sequences.sorted(), sequences)
        assertEquals(sequences.size, sequences.toSet().size)
        assertEquals(1, peers.size); assertSame(peer, peers.single())
        assertTrue(peer.authenticated); assertFalse(peer.closed)
        assertFalse("producer boundaries must not end the shared peer", peer.videos.any { it.kind == WebVideoRecords.KIND_END })
        assertFalse("video producer boundaries do not release browser ownership", session in gone)
    }

    @Test fun rejectedAuthenticationReplyClosesPeerAndReleasesOwnershipBeforeMediaStarts() {
        val failed = paired()
        failed.allowSend = false
        auth(failed)
        assertTrue("a rejected auth response must immediately retire its peer", failed.closed)
        assertTrue("media cannot start when authentication success could not reach the browser", failed.videos.isEmpty())
        assertTrue(failed.audio.isEmpty())
        assertTrue("the failed authenticated owner must be released", session in gone)
        val replacement = paired(other)
        assertEquals(true, auth(replacement, s = other)["ok"])
        assertFalse(replacement.closed)
        assertEquals(true, replacement.rpc("control", mapOf("q" to 1,
            "e" to listOf(mapOf("k" to "key", "n" to "home"))))["ok"])
        assertEquals(listOf("home"), keys.toList())
    }

    @Test fun stopClosesEveryPendingOrAuthenticatedPeer() {
        val first = paired(); auth(first)
        val pending = paired(other)
        server.stop()
        assertTrue(first.closed); assertTrue(pending.closed)
    }
}
