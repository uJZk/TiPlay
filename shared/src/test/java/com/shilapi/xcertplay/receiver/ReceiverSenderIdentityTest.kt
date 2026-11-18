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

    @Test fun anExistingClientUuidGrantSurvivesSetupDeviceIdSupport() {
        val headers = mapOf("X-Apple-Client-ID" to "b5bf5f1e-7f23-4aa2-a02d-1133557799aa")
        val setup = mapOf("deviceID" to "12:34:56:78:9a:bc")
        val claim = requireNotNull(ReceiverSenderIdentity.claim(headers, setup))
        assertEquals(ReceiverSenderIdentity.Source.CLIENT_ID, claim.source)
        val originalIdentity = "f623cdf8522b6eb8c1800bea3764c756e868ef84b66edc0e36021514b43cad0a"
            .chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        assertArrayEquals(originalIdentity, claim.identity)
        assertFalse(claim.identity.contentEquals(requireNotNull(ReceiverSenderIdentity.identity(emptyMap(), setup))))
        val store = MemoryStore().apply { remember("77b4776ff214151c361a76ce48c27c5df08c003214572a2d9a8789efa8e2fd1a") }
        val trust = ReceiverDeviceTrust(store)
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession("0123456789abcdef-legacy", claim.identity, "AirPlay"))
    }

    @Test fun setupDeviceIdRemembersAcrossNewCastSessionsAndDifferentInterfaceAddresses() {
        val first = ReceiverSenderIdentity.claim(emptyMap(), mapOf(
            "deviceID" to " 12:34:56:78:9A:BC ", "macAddress" to "20:11:22:33:44:55",
            "sessionUUID" to "11111111-1111-1111-1111-111111111111", "name" to "First name"))
        val next = ReceiverSenderIdentity.claim(emptyMap(), mapOf(
            "deviceID" to "12:34:56:78:9a:bc", "macAddress" to "30:11:22:33:44:55",
            "sessionUUID" to "22222222-2222-2222-2222-222222222222", "name" to "Changed name"))
        assertNotNull(first); assertNotNull(next)
        assertEquals(ReceiverSenderIdentity.Source.SETUP_DEVICE_ID, requireNotNull(first).source)
        val persistedIdentity = "74ad21f8917195433dcf09b82f3b5feb3f48a7c732aa65a1becfdfded2d7d094"
            .chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        assertArrayEquals("The stored SETUP identity namespace must remain stable", persistedIdentity, first.identity)
        assertArrayEquals(first.identity, requireNotNull(next).identity)
        val store = MemoryStore(); val trust = ReceiverDeviceTrust(store)
        trust.browserSeen("browser")
        val pending = trust.requestSession("0123456789abcdef-device-first", first.identity, "First name", "mirror")
            as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, allow = true, remember = true))
        trust.endSession("0123456789abcdef-device-first")
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession("0123456789abcdef-device-next", next.identity, "Changed name", "mirror"))
        val other = ReceiverSenderIdentity.identity(emptyMap(), mapOf("deviceID" to "22:34:56:78:9a:bc"))
        assertNotNull(other); assertFalse(next.identity.contentEquals(requireNotNull(other)))
        assertTrue(trust.requestSession("0123456789abcdef-device-other", other, "Changed name", "mirror")
            is ReceiverDeviceTrust.Decision.Pending)
        trust.close()
    }

    @Test fun explicitInvalidClientIdCannotDowngradeToASetupClaim() {
        val setup = mapOf("deviceID" to "12:34:56:78:9a:bc")
        for (id in listOf("", "bad", "00000000-0000-0000-0000-000000000000",
            "b5bf5f1e-7f23-4aa2-a02d-1133557799aa,b5bf5f1e-7f23-4aa2-a02d-1133557799ab")) {
            assertNull(ReceiverSenderIdentity.claim(mapOf("X-Apple-Client-ID" to id), setup))
        }
        assertNull(ReceiverSenderIdentity.claim(mapOf(
            "X-Apple-Client-ID" to "b5bf5f1e-7f23-4aa2-a02d-1133557799aa",
            "x-apple-client-id" to "b5bf5f1e-7f23-4aa2-a02d-1133557799ab"), setup))
    }

    @Test fun malformedPlaceholderMulticastAndAmbiguousSetupIdsCannotCreateRememberedClaims() {
        for (id in listOf("", "00:00:00:00:00:00", "02:00:00:00:00:00", "ff:ff:ff:ff:ff:ff",
            "01:23:45:67:89:ab", "12:34:56:78:9a", "12:34:56:78:9a:bc:de",
            "123456789abc", "12-34-56-78-9a-bc", "12:34:56:78:9a:gg", "192.168.1.1",
            "b5bf5f1e-7f23-4aa2-a02d-1133557799aa")) {
            assertNull(id, ReceiverSenderIdentity.claim(emptyMap(), mapOf("deviceID" to id)))
        }
        for (id in listOf<Any?>(null, 42, byteArrayOf(0x12, 0x34, 0x56, 0x78, 0x9a.toByte(), 0xbc.toByte()),
            listOf("12:34:56:78:9a:bc", "22:34:56:78:9a:bc"))) {
            assertNull(ReceiverSenderIdentity.claim(emptyMap(), mapOf("deviceID" to id)))
        }
        assertNull(ReceiverSenderIdentity.claim(emptyMap(), mapOf("deviceID" to "12:34:56:78:9a:bc",
            "DeviceID" to "22:34:56:78:9a:bc")))
        assertNull(ReceiverSenderIdentity.claim(emptyMap(), mapOf("deviceid" to "12:34:56:78:9a:bc")))
    }

    @Test fun sessionNameAddressAndDacpDoNotSubstituteForDeviceId() {
        assertNull(ReceiverSenderIdentity.claim(mapOf("DACP-ID" to "1234567890abcdef",
            "X-Apple-Device-ID" to "12:34:56:78:9a:bc", "Host" to "192.168.1.1"), mapOf(
            "macAddress" to "12:34:56:78:9a:bc", "name" to "AirPlay",
            "sessionUUID" to "11111111-1111-1111-1111-111111111111",
            "sessionCorrelationUUID" to "22222222-2222-2222-2222-222222222222")))
    }

    @Test fun callersCannotMutateTheResolvedClaimIdentity() {
        val claim = requireNotNull(ReceiverSenderIdentity.claim(emptyMap(), mapOf("deviceID" to "12:34:56:78:9a:bc")))
        val expected = claim.identity; val exposed = claim.identity
        exposed[0] = (exposed[0].toInt() xor 0xff).toByte()
        assertArrayEquals(expected, claim.identity)
        assertNotSame(exposed, claim.identity)
    }

    private class MemoryStore : ReceiverDeviceTrust.Store {
        private val remembered = mutableSetOf<String>()
        override fun contains(fingerprint: String) = fingerprint in remembered
        override fun remember(fingerprint: String) { remembered += fingerprint }
        override fun forgetAll() = remembered.clear()
    }
}
