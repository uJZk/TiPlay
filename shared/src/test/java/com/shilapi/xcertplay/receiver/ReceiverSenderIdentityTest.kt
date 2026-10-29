package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test

class ReceiverSenderIdentityTest {
    @Test fun opaqueDeviceIdPersistsAcrossConnectionsWithoutRelaxingOtherHeaders() {
        val claim = mapOf("X-Apple-Device-ID" to "A1bc2Def3Gh4ij")
        val first = ReceiverSenderIdentity.identity(null, claim)
        assertNotNull(first)
        assertArrayEquals(first, ReceiverSenderIdentity.identity(null, claim))
        assertFalse(first!!.contentEquals(ReceiverSenderIdentity.identity(null,
            mapOf("X-Apple-Device-ID" to "a1bc2Def3Gh4ij"))))
        assertNull(ReceiverSenderIdentity.identity(null, mapOf("client-instance" to "A1bc2Def3Gh4ij")))
        assertNull(ReceiverSenderIdentity.identity(null, mapOf("DACP-ID" to "A1bc2Def3Gh4ij")))
        val store = object : ReceiverDeviceTrust.Store {
            private val remembered = mutableSetOf<String>()
            override fun contains(fingerprint: String) = fingerprint in remembered
            override fun remember(fingerprint: String) { remembered += fingerprint }
            override fun forgetAll() = remembered.clear()
        }
        val events = mutableListOf<String>()
        val trust = ReceiverDeviceTrust(store, diagnostic = { events.add(it) })
        trust.browserSeen("browser")
        val pending = trust.requestSession("0123456789abcdef-first", first, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, allow = true, remember = true))
        trust.endSession("0123456789abcdef-first")
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession("0123456789abcdef-next", ReceiverSenderIdentity.identity(null, claim), "iPhone"))
        assertEquals(listOf("AirPlay trust: event=prompt-persistent", "AirPlay trust: event=remembered-saved",
            "AirPlay trust: event=remembered-hit"), events)
    }

    @Test fun publicKeysKeepExistingTrustIdentityAndCannotBeMutatedThroughTheResult() {
        val key = ByteArray(32) { it.toByte() }
        val identity = ReceiverSenderIdentity.identity(key, mapOf("X-Apple-Device-ID" to "AB:CD:EF:12:34:56"))!!
        assertArrayEquals(key, identity)
        identity[0] = 99
        assertEquals(0, key[0].toInt())
    }

    @Test fun deviceClaimsSurviveFormattingChangesAndIgnoreNetworkAndDisplayNames() {
        val first = ReceiverSenderIdentity.identity(null, mapOf("X-Apple-Device-ID" to "AB:CD:EF:12:34:56",
            "X-Apple-Client-Name" to "Alice", "Host" to "192.168.1.1"))
        val next = ReceiverSenderIdentity.identity(null, mapOf("x-apple-device-id" to "abcdef123456",
            "x-apple-client-name" to "Bob", "host" to "192.168.2.1"))
        assertNotNull(first)
        assertArrayEquals(first, next)
        assertNull(ReceiverSenderIdentity.identity(null, mapOf("x-apple-client-name" to "Alice",
            "host" to "192.168.1.1", "x-apple-session-id" to "abcdef123456")))
    }

    @Test fun identitiesUseFixedHeaderPriorityAndSeparateIdentifierNamespaces() {
        val id = "1234567890ABCDEF"
        val device = ReceiverSenderIdentity.identity(null, mapOf("x-apple-device-id" to id))!!
        val client = ReceiverSenderIdentity.identity(null, mapOf("client-instance" to id))!!
        val dacp = ReceiverSenderIdentity.identity(null, mapOf("DACP-ID" to id))!!
        assertFalse(device.contentEquals(client))
        assertFalse(client.contentEquals(dacp))
        assertArrayEquals(device, ReceiverSenderIdentity.identity(null, mapOf("dacp-id" to id,
            "client-instance" to id, "x-apple-device-id" to id)))
    }

    @Test fun malformedAndPlaceholderClaimsDoNotCreateSharedTrust() {
        for (id in listOf("", "iPhone", "192.168.1.12", "000000000000", "FFFFFFFFFFFFFFFF",
            "abcd ef123456", "1234567890abcdef\nother", "a".repeat(129))) {
            assertNull(id, ReceiverSenderIdentity.identity(ByteArray(31), mapOf("x-apple-device-id" to id)))
        }
        assertArrayEquals(ReceiverSenderIdentity.identity(null, mapOf("client-instance" to "1234567890abcdef")),
            ReceiverSenderIdentity.identity(null, mapOf("x-apple-device-id" to "invalid", "client-instance" to "0x1234567890ABCDEF")))
        assertNull(ReceiverSenderIdentity.identity(null, mapOf("X-Apple-Device-ID" to "abcdef123456",
            "x-apple-device-id" to "abcdef654321")))
    }
}
