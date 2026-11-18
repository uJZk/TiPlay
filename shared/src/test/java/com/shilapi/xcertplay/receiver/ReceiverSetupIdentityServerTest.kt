package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.BrowserDisplaySource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import java.io.Closeable
import java.net.InetAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

/** Synthetic control metadata only: no captured sender identifiers, keys or media. */
class ReceiverSetupIdentityServerTest {
    @Test fun controlSetupCachesDeviceIdentityWithoutPromptingUntilTypedMirrorSetup() {
        Fixture(remember = false).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(DEVICE_A).path)
                assertTrue(fixture.identities.isEmpty())
                assertTrue(fixture.prompts.isEmpty())
                assertEquals(0, fixture.preparations)
                assertEquals("200", peer.mirror().path)
                assertEquals("200", peer.mirror().path)
                val expected = ReceiverSenderIdentity.identity(emptyMap(), mapOf("deviceID" to DEVICE_A))!!
                assertEquals(2, fixture.identities.size)
                fixture.identities.forEach { assertArrayEquals(expected, it) }
                assertEquals(listOf(true), fixture.prompts.toList())
                assertEquals(0, fixture.store.values.size)
                assertTrue(fixture.logs.any { "stage=TRUST_IDENTITY source=setup-device-id" in it })
                assertFalse(fixture.logs.any { DEVICE_A in it })
            }
        }
    }

    @Test fun rememberedDeviceSurvivesNewSessionUuidButDoesNotAuthorizeAnotherDevice() {
        Fixture(remember = true).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(DEVICE_A, SESSION_A).path)
                assertEquals("200", peer.mirror().path)
            }
            fixture.awaitEnded(1)
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(DEVICE_A.lowercase(), SESSION_B).path)
                assertEquals("200", peer.mirror().path)
            }
            fixture.awaitEnded(2)
            assertArrayEquals(fixture.identities[0], fixture.identities[1])
            assertEquals(listOf(true), fixture.prompts.toList())
            assertEquals(1, fixture.store.values.size)
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(DEVICE_B, SESSION_A).path)
                assertEquals("200", peer.mirror().path)
            }
            assertFalse(fixture.identities[0]!!.contentEquals(fixture.identities[2]!!))
            assertEquals(listOf(true, true), fixture.prompts.toList())
            assertEquals(2, fixture.store.values.size)
        }
    }

    @Test fun absentInvalidAndPlaceholderDeviceClaimsRemainConnectionOnly() {
        for (claim in listOf(null, "00:00:00:00:00:00", "02:00:00:00:00:00", "FF:FF:FF:FF:FF:FF",
            "01:11:22:33:44:55", "not-a-device", 42)) {
            Fixture(remember = true).use { fixture ->
                fixture.peer().use { peer ->
                    assertEquals("200", peer.prepare(claim).path)
                    assertEquals("200", peer.mirror().path)
                    assertEquals(1, fixture.identities.size)
                    assertNull(fixture.identities.single())
                    assertEquals(listOf(false), fixture.prompts.toList())
                    assertTrue(fixture.store.values.isEmpty())
                    assertTrue(fixture.logs.any { "stage=TRUST_IDENTITY source=connection-only" in it })
                }
            }
        }
    }

    @Test fun rejectedOrUnknownControlSetupCannotPlantARememberIdentity() {
        val valid = controlFields(DEVICE_A)
        val attempts = listOf(
            BplistCodec.encode(valid + ("eiv" to ByteArray(2))) to "400",
            BplistCodec.encode(valid + ("timingProtocol" to "PTP")) to "461",
            BplistCodec.encode(valid + ("streams" to listOf(mapOf("type" to 999)))) to "400",
            BplistCodec.encode(mapOf("deviceID" to DEVICE_A, "sessionUUID" to SESSION_A)) to "200",
            "not-a-plist".toByteArray() to "400",
        )
        for ((body, status) in attempts) {
            Fixture(remember = true).use { fixture ->
                fixture.peer().use { peer ->
                    peer.fairPlay()
                    assertEquals(status, peer.request("SETUP", "/session", body).path)
                    assertEquals("200", peer.prepare(null, withFairPlay = false).path)
                    assertEquals("200", peer.mirror().path)
                    assertNull(fixture.identities.single())
                    assertEquals(listOf(false), fixture.prompts.toList())
                    assertTrue(fixture.store.values.isEmpty())
                }
            }
        }
    }

    @Test fun anExplicitChangedOrInvalidClaimCannotReuseAnApprovedConnection() {
        Fixture(remember = false).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(DEVICE_A).path)
                assertEquals("200", peer.mirror().path)
                for (claim in listOf(DEVICE_B, "00:00:00:00:00:00", 42))
                    assertEquals("403", peer.mirror(mapOf("deviceID" to claim)).path)
                assertEquals("403", peer.mirror(headers = mapOf("X-Apple-Client-ID" to CLIENT_A)).path)
                assertEquals("403", peer.mirror(headers = mapOf("X-Apple-Client-ID" to "invalid")).path)
                assertEquals(1, fixture.identities.size)
                assertEquals("200", peer.mirror().path)
                assertEquals(2, fixture.identities.size)
                assertArrayEquals(fixture.identities[0], fixture.identities[1])
                assertEquals(listOf(true), fixture.prompts.toList())
                assertTrue(fixture.store.values.isEmpty())
            }
        }
    }

    @Test fun anEarlierClientHeaderKeepsPriorityOverLaterBodyMetadata() {
        Fixture(remember = false).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.request("GET", "/info", headers = mapOf("X-Apple-Client-ID" to CLIENT_A)).path)
                assertEquals("200", peer.prepare(DEVICE_A).path)
                assertEquals("200", peer.mirror(mapOf("deviceID" to DEVICE_B)).path)
                val expected = ReceiverSenderIdentity.identity(mapOf("x-apple-client-id" to CLIENT_A))
                assertArrayEquals(expected, fixture.identities.single())
                assertEquals("403", peer.mirror(headers = mapOf("X-Apple-Client-ID" to CLIENT_B)).path)
                assertEquals(1, fixture.identities.size)
                assertTrue(fixture.logs.any { "stage=TRUST_IDENTITY source=x-apple-client-id" in it })
            }
        }
    }

    @Test fun invalidClientHeaderNeverFallsBackToAValidSetupDevice() {
        Fixture(remember = true).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(DEVICE_A, headers = mapOf("X-Apple-Client-ID" to "invalid")).path)
                assertEquals("200", peer.mirror().path)
                assertNull(fixture.identities.single())
                assertEquals(listOf(false), fixture.prompts.toList())
                assertTrue(fixture.store.values.isEmpty())
            }
        }
    }

    @Test fun verifiedPairingKeyRequiresItsOwnApprovalAndOutranksConvenienceClaims() {
        Fixture(remember = true).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(DEVICE_A).path)
                assertEquals("200", peer.mirror().path)
            }
            fixture.awaitEnded(1)
            val signing = AirPlayCrypto.ed25519Generate()
            fixture.peer().use { peer ->
                peer.verifyIdentity(signing)
                assertEquals("200", peer.prepare(DEVICE_A).path)
                assertEquals("200", peer.mirror(mapOf("deviceID" to DEVICE_B),
                    mapOf("X-Apple-Client-ID" to "invalid")).path)
                assertArrayEquals(signing.publicKey, fixture.identities[1])
                assertFalse(fixture.identities[0]!!.contentEquals(fixture.identities[1]!!))
                assertEquals(listOf(true, true), fixture.prompts.toList())
                assertEquals(2, fixture.store.values.size)
                assertTrue(fixture.logs.any { "stage=TRUST_IDENTITY source=verified-key" in it })
            }
            fixture.awaitEnded(2)
            val replacementKey = AirPlayCrypto.ed25519Generate()
            fixture.peer().use { peer ->
                // Also cover a key verified after the weaker body claim was cached.
                assertEquals("200", peer.prepare(DEVICE_A).path)
                peer.verifyIdentity(replacementKey)
                assertEquals("200", peer.mirror(mapOf("deviceID" to DEVICE_B),
                    mapOf("X-Apple-Client-ID" to "invalid")).path)
                assertArrayEquals(replacementKey.publicKey, fixture.identities[2])
                assertEquals(listOf(true, true, true), fixture.prompts.toList())
                assertEquals(3, fixture.store.values.size)
            }
        }
    }

    private class Store : ReceiverDeviceTrust.Store {
        val values = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        override fun contains(fingerprint: String) = fingerprint in values
        override fun remember(fingerprint: String) { values.add(fingerprint) }
        override fun forgetAll() = values.clear()
    }

    private class Fixture(private val remember: Boolean) : Closeable, ReceiverServer.Listener {
        val store = Store()
        val identities = CopyOnWriteArrayList<ByteArray?>()
        val prompts = CopyOnWriteArrayList<Boolean>()
        val logs = CopyOnWriteArrayList<String>()
        @Volatile var preparations = 0
        @Volatile private var ended = 0
        private val browser = "synthetic-browser"
        private val trust = ReceiverDeviceTrust(store)
        private val hub = WebVideoHub(Executor { it.run() })
        private val receiver = ReceiverServer(ReceiverConfig("Synthetic receiver", "02:11:22:33:44:55",
            AirPlayIdentity.generate(), audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS), this,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) },
            fairPlayDecrypt = { _, _ -> ByteArray(16) })
        init { receiver.start() }
        fun peer() = Peer(receiver.port)
        fun awaitEnded(count: Int) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            // Peer.close completes TEARDOWN before EOF, so its media owner is already gone.
            while (ended < count && System.nanoTime() < deadline) Thread.sleep(1)
            assertTrue("control connection ended", ended >= count)
        }
        override fun authorizeDevice(sessionToken: String, identity: ByteArray, deviceName: String,
            mediaType: String, verifiedSessionId: String?) = authorize(sessionToken, identity, deviceName, mediaType, verifiedSessionId)
        override fun authorizeConnection(sessionToken: String, deviceName: String, mediaType: String) =
            authorize(sessionToken, null, deviceName, mediaType, null)
        private fun authorize(token: String, identity: ByteArray?, name: String, type: String, session: String?): Boolean {
            identities.add(identity?.copyOf())
            trust.browserSeen(browser)
            val decision = trust.requestSession(token, identity, name, type, session)
            if (decision is ReceiverDeviceTrust.Decision.Pending) {
                val prompt = requireNotNull(trust.prompt(browser))
                prompts.add(prompt["verified"] as Boolean)
                assertTrue(trust.respond(browser, prompt["id"] as String, allow = true, remember = remember))
            }
            return trust.authorizeSession(token, identity, name, type, session)
        }
        override fun onAuthorizationSessionEnded(sessionToken: String) { trust.endSession(sessionToken); ended++ }
        override fun prepareMirror() { preparations++ }
        override fun mirrorSink() = WebMediaSink(hub, 720, 1280, 60, BrowserDisplaySource.AIRPLAY)
        override fun play(item: ReceiverPlay) = error("Unexpected URL playback")
        override fun stopPlayback() {}
        override fun seek(seconds: Double) {}
        override fun rate(value: Double) {}
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) {}
        override fun log(message: String) { logs.add(message) }
        override fun close() { receiver.close(); trust.close() }
    }

    private class Peer(port: Int) : Closeable {
        private val socket = Socket(InetAddress.getByName("127.0.0.1"), port).apply { soTimeout = 3000 }
        private var sequence = 0
        fun fairPlay() {
            for ((size, step) in listOf(16 to 1, 164 to 3)) {
                val body = ByteArray(size).apply {
                    byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, step.toByte(), 0).copyInto(this)
                    ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
                }
                assertEquals("200", request("POST", "/fp-setup", body).path)
            }
        }
        fun prepare(device: Any?, session: String = SESSION_A, withFairPlay: Boolean = true,
            headers: Map<String, String> = emptyMap()): RtspMessage.Request {
            if (withFairPlay) fairPlay()
            return request("SETUP", "/session", BplistCodec.encode(controlFields(device, session)), headers)
        }
        fun mirror(fields: Map<String, Any> = emptyMap(), headers: Map<String, String> = emptyMap()) =
            request("SETUP", "/stream", BplistCodec.encode(mapOf("streams" to listOf(
                mapOf("type" to 110, "streamConnectionID" to 1234L))) + fields), headers)
        fun verifyIdentity(signing: AirPlayCrypto.Ed25519KeyPair) {
            val curve = AirPlayCrypto.x25519Generate()
            val reply = request("POST", "/pair-verify", byteArrayOf(1, 0, 0, 0) + curve.publicKey + signing.publicKey)
            assertEquals("200", reply.path)
            val serverCurve = reply.body.copyOf(32)
            val secret = AirPlayCrypto.x25519Shared(curve.privateKey, serverCurve)
            val cipher = aesCtr(AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), secret).copyOf(16),
                AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), secret).copyOf(16))
            cipher.update(reply.body.copyOfRange(32, 96))
            assertEquals("200", request("POST", "/pair-verify", ByteArray(4) +
                cipher.update(AirPlayCrypto.ed25519Sign(signing.privateKey, curve.publicKey + serverCurve))).path)
        }
        fun request(method: String, target: String, body: ByteArray = ByteArray(0),
            headers: Map<String, String> = emptyMap()): RtspMessage.Request {
            val extras = headers.entries.joinToString("") { "${it.key}: ${it.value}\r\n" }
            val header = "$method $target RTSP/1.0\r\nCSeq: ${++sequence}\r\nContent-Type: application/x-apple-binary-plist\r\n${extras}Content-Length: ${body.size}\r\n\r\n"
            socket.getOutputStream().apply { write(header.toByteArray() + body); flush() }
            return requireNotNull(readReceiverRequest(socket.getInputStream()))
        }
        override fun close() {
            runCatching { request("TEARDOWN", "/session") }
            socket.close()
        }
    }

    companion object {
        private const val DEVICE_A = "02:AA:22:33:44:55"
        private const val DEVICE_B = "06:BB:22:33:44:55"
        private const val SESSION_A = "11111111-2222-3333-4444-555555555555"
        private const val SESSION_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        private const val CLIENT_A = "b5bf5f1e-7f23-4aa2-a02d-1133557799aa"
        private const val CLIENT_B = "c6cf6f2e-8f34-4bb3-b13e-22446688aabb"
        private fun controlFields(device: Any?, session: String = SESSION_A): Map<String, Any> =
            mutableMapOf<String, Any>("ekey" to ByteArray(72), "eiv" to ByteArray(16), "timingPort" to 0,
                "timingProtocol" to "NTP", "combinedGetInfoWithControlSetup" to true,
                "isScreenMirroringSession" to true, "sessionUUID" to session,
                "macAddress" to "0A:99:88:77:66:55").apply { if (device != null) put("deviceID", device) }
    }
}
