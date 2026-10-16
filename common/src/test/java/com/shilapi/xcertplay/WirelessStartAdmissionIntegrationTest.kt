package com.shilapi.xcertplay

import com.shilapi.xcertplay.iap2.session.Iap2Session
import com.shilapi.xcertplay.iap2.wire.Iap2Frame
import com.shilapi.xcertplay.mfi.Iap2MfiAuthenticationClient
import com.shilapi.xcertplay.mfi.MfiAuthenticator
import com.shilapi.xcertplay.transport.Iap2IdentificationConfig
import com.shilapi.xcertplay.transport.Iap2WirelessCarPlayEndpoint
import com.shilapi.xcertplay.transport.Iap2WirelessControlClient
import com.shilapi.xcertplay.transport.Iap2WirelessControlTerminal
import com.shilapi.xcertplay.transport.Iap2WirelessIdentification
import com.shilapi.xcertplay.transport.Iap2WirelessSecurity
import org.junit.Assert.*
import org.junit.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyLong
import org.mockito.Mockito.*

/** Run the actual authenticated control loop; the mock replaces only the lower CSM transport. */
class WirelessStartAdmissionIntegrationTest {
    @Test fun inFlightBootstrapRetainsAvailabilityAndProcessesControlUntilTheLeaseEnds() =
        runLeaseSequence(leaseBeginsDuringValidation = false)

    @Test fun aLeaseBeginningDuringTheFinalHotspotCheckStillDefersTheActualStartWrite() =
        runLeaseSequence(leaseBeginsDuringValidation = true)

    private fun runLeaseSequence(leaseBeginsDuringValidation: Boolean) {
        val session = mock(Iap2Session::class.java)
        val writes = mutableListOf<Int>()
        var held = false
        var closed = false
        var received = 0
        var validations = 0
        var starts = 0
        `when`(session.awaitReady(anyLong())).thenReturn(true)
        `when`(session.isClosed).thenAnswer { closed }
        doAnswer { call ->
            writes += call.getArgument<Iap2Frame>(0).messageId
            null
        }.`when`(session).send(any(Iap2Frame::class.java) ?: Iap2Frame(0, byteArrayOf()), anyLong())
        `when`(session.recv(anyLong())).thenAnswer { call ->
            val step = received++
            if (step >= 2) assertTrue("A lease is rechecked through bounded receives", call.getArgument<Long>(0) <= 250L)
            when (step) {
                0 -> Iap2Frame(0x1d02, byteArrayOf()) // identification accepted
                1 -> Iap2Frame(0xaa05, byteArrayOf()) // MFi authenticated
                2 -> {
                    if (!leaseBeginsDuringValidation) held = true
                    Iap2Frame(0x4300, byteArrayOf()) // one availability notification only
                }
                3 -> {
                    assertTrue(held)
                    assertFalse(writes.contains(0x4301))
                    Iap2Frame(0x5702, byteArrayOf()) // ordinary control must still progress
                }
                4 -> {
                    assertTrue("Wi-Fi configuration is answered during the lease", writes.contains(0x5703))
                    assertFalse(writes.contains(0x4301))
                    held = false
                    Iap2Frame(0x5001, byteArrayOf())
                }
                5 -> {
                    assertEquals(1, writes.count { it == 0x4301 })
                    closed = true
                    null
                }
                else -> error("Control loop did not retire its closed transport")
            }
        }
        val auth = object : MfiAuthenticator {
            override fun protocolMajor() = 3
            override fun readCertificate(maximumOutputLength: Int) = byteArrayOf(1)
            override fun signChallenge(challenge: ByteArray) = error("No challenge in this sequence")
        }
        val result = Iap2WirelessControlClient(session, Iap2MfiAuthenticationClient(auth)).run(
            identification = Iap2IdentificationConfig("TiPlay", "TiPlay", "TiPlay", "test", "1", "1",
                Iap2WirelessIdentification("02:00:00:00:00:01", "Test")),
            endpoint = Iap2WirelessCarPlayEndpoint("Test", "password", 36, Iap2WirelessSecurity.WPA_WPA2,
                listOf("192.0.2.1"), 7000, "test", "test", "test"),
            timeoutMillis = 10_000,
            beforeStartSession = {
                validations++
                if (leaseBeginsDuringValidation && validations == 1) held = true
            },
            onStartSessionSent = {
                assertEquals(0x4301, writes.last())
                assertTrue(it.sentAtNanos > 0)
                starts++
            },
            startSessionAllowed = { !held },
        )
        assertEquals(Iap2WirelessControlTerminal.CHANNEL_CLOSED, result.terminal)
        assertEquals(1, result.carPlayStartSessionsSent)
        assertEquals(1, result.wifiConfigurationsSent)
        assertEquals(1, starts)
        assertEquals(if (leaseBeginsDuringValidation) 2 else 1, validations)
    }
}
