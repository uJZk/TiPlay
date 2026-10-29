package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test

class ReceiverSenderIdentityTest {
    @Test fun clientUuidPersistsAcrossConnectionsDespiteChangingDacp() {
        val id = "b5bf5f1e-7f23-4aa2-a02d-1133557799aa"
        val first = ReceiverSenderIdentity.identity(mapOf("X-Apple-Client-ID" to id.uppercase(), "DACP-ID" to "1234567890abcdef"))
        val next = ReceiverSenderIdentity.identity(mapOf("x-apple-client-id" to id, "dacp-id" to "fedcba0987654321"))
        assertNotNull(first)
        assertArrayEquals(first, next)
        val store = object : ReceiverDeviceTrust.Store {
            private val remembered = mutableSetOf<String>()
            override fun contains(fingerprint: String) = fingerprint in remembered
            override fun remember(fingerprint: String) { remembered += fingerprint }
            override fun forgetAll() = remembered.clear()
        }
        val trust = ReceiverDeviceTrust(store)
        trust.browserSeen("browser")
        val pending = trust.requestSession("0123456789abcdef-first", first, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, allow = true, remember = true))
        trust.endSession("0123456789abcdef-first")
        assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.requestSession("0123456789abcdef-next", next, "iPhone"))
    }

    @Test fun malformedAndConflictingClaimsNeverCreatePersistentIdentity() {
        for (value in listOf("", "iPhone", "00000000-0000-0000-0000-000000000000",
            "ffffffff-ffff-ffff-ffff-ffffffffffff", "12345678-1234-1234-1234-1234567890ag",
            "b5bf5f1e7f234aa2a02d1133557799aa", "192.168.1.1", "a".repeat(129))) {
            assertNull(value, ReceiverSenderIdentity.identity(mapOf("x-apple-client-id" to value)))
        }
        assertNull(ReceiverSenderIdentity.identity(mapOf("X-Apple-Client-ID" to "b5bf5f1e-7f23-4aa2-a02d-1133557799aa",
            "x-apple-client-id" to "b5bf5f1e-7f23-4aa2-a02d-1133557799ab")))
        assertNull(ReceiverSenderIdentity.identity(mapOf("X-Apple-Client-ID" to "b5bf5f1e-7f23-4aa2-a02d-1133557799aa",
            "x-apple-client-id" to "bad")))
    }

    @Test fun unrelatedHeadersDoNotSupplyAnIdentity() {
        assertNull(ReceiverSenderIdentity.identity(mapOf("x-apple-device-id" to "abcdef123456",
            "client-instance" to "1234567890abcdef", "dacp-id" to "abcdef1234567890",
            "x-apple-client-name" to "iPhone", "host" to "192.168.1.1")))
    }
}
