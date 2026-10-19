package com.shilapi.xcertplay.web

import java.io.File
import java.security.SecureRandom
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class BrowserRtcPairingTest {
    private val vector = WebJson.parse(File("../tests/web/fixtures/rtc-srp.json").readText()) as Map<*, *>
    private fun value(name: String) = vector[name] as String
    private fun server(now: () -> Long = { 1000L }) = BrowserRtcPairing(object : SecureRandom() {
        override fun nextBytes(bytes: ByteArray) { bytes.fill(0x31) }
    }, now)

    @Test fun bouncyCastleAndVendoredBrowserClientShareProofsKeyAndSdpBinding() {
        val pairing = server()
        val challenge = pairing.start(value("session"), value("code"))
        assertEquals(value("id"), challenge.id)
        assertEquals(value("salt"), challenge.salt)
        assertEquals(value("B"), challenge.B)
        val verified = pairing.verify(challenge.id, value("A"), value("M1"), value("session"))
        assertEquals(value("M2"), verified.serverProof)
        assertEquals(value("binding"), verified.bind(value("offer"), value("sdp"), 177L))
        assertNotEquals(value("binding"), verified.bind(value("offer") + "changed", value("sdp"), 177L))
        assertNotEquals(value("binding"), verified.bind(value("offer"), value("sdp") + "changed", 177L))
        assertNotEquals(value("binding"), verified.bind(value("offer"), value("sdp"), 178L))
        assertNull(pairing.sessionFor(challenge.id))
        assertThrows(SecurityException::class.java) { pairing.verify(challenge.id, value("A"), value("M1"), value("session")) }
    }

    @Test fun wrongProofOrChangedSessionConsumesTheChallenge() {
        for (kind in listOf("proof", "session", "zero", "oversized")) {
            val pairing = server()
            val challenge = pairing.start(value("session"), value("code"))
            assertThrows(SecurityException::class.java) {
                pairing.verify(challenge.id,
                    when (kind) { "zero" -> "0"; "oversized" -> "a".repeat(513); else -> value("A") },
                    if (kind == "proof") "1" else value("M1"),
                    if (kind == "session") "another-session" else value("session"))
            }
            assertNull(pairing.sessionFor(challenge.id))
        }
    }

    @Test fun expiredChallengesAndClearCannotAuthenticate() {
        var now = 1000L
        val pairing = server { now }
        val challenge = pairing.start(value("session"), value("code"))
        now += 30_001L
        assertNull(pairing.sessionFor(challenge.id))
        assertThrows(SecurityException::class.java) { pairing.verify(challenge.id, value("A"), value("M1"), value("session")) }
        val next = pairing.start(value("session"), value("code"))
        pairing.clear()
        assertNull(pairing.sessionFor(next.id))
    }
}
