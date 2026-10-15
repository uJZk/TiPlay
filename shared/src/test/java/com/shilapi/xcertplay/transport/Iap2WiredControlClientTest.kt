package com.shilapi.xcertplay.transport

import com.shilapi.xcertplay.iap2.body.Iap2BodyReader
import com.shilapi.xcertplay.iap2.wire.Iap2ParameterList
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class Iap2WiredControlClientTest {
    @Test fun phoneBrowserSubscriptionsRequestOnlyDurationStatusAndElapsedTime() {
        val frame = Iap2WiredControlClient.subscriptions(includeArtwork = false, includeText = false).first()
        val groups = Iap2BodyReader.of(frame).list()
        val media = Iap2ParameterList.parse(groups.single { it.id == 0 }.payload).asList().map { it.id }
        val playback = Iap2ParameterList.parse(groups.single { it.id == 1 }.payload).asList().map { it.id }
        assertEquals(listOf(4), media)
        assertEquals(listOf(0, 1), playback)
    }

    @Test fun browserSubscriptionsKeepTextAndPlaybackFieldsWithoutRequestingArtwork() {
        val browser = Iap2WiredControlClient.subscriptions(includeArtwork = false).first()
        val upstream = Iap2WiredControlClient.subscriptions().first()
        fun mediaFields(frame: com.shilapi.xcertplay.iap2.wire.Iap2Frame): List<Int> =
            Iap2ParameterList.parse(Iap2BodyReader.of(frame).list().single { it.id == 0 }.payload).asList().map { it.id }
        assertEquals(listOf(1, 4, 6, 12), mediaFields(browser))
        assertEquals(listOf(1, 4, 6, 12, 26), mediaFields(upstream))
        val browserPlayback = Iap2BodyReader.of(browser).list().single { it.id == 1 }.payload
        val upstreamPlayback = Iap2BodyReader.of(upstream).list().single { it.id == 1 }.payload
        assertArrayEquals(upstreamPlayback, browserPlayback)
    }

    @Test
    fun carPlayStartSessionNestsAddressesInsideWiredAttributes() {
        val frame = Iap2WiredControlClient.carPlayStartSession(
            Iap2WiredCarPlayEndpoint(
                ipv6Addresses = listOf("fe80::2"),
                airPlayPort = 7000,
                deviceIdentifier = "02:00:00:00:00:02",
                publicKey = "abcd",
                sourceVersion = "1.0",
            ),
        )

        assertEquals(0x4301, frame.messageId)
        val outer = Iap2BodyReader.of(frame).list()
        val wired = outer.single { it.id == 0 }
        val addresses = Iap2ParameterList.parse(wired.payload).asList()
        assertEquals(1, addresses.size)
        assertEquals(0, addresses.single().id)
        assertArrayEquals("fe80::2\u0000".encodeToByteArray(), addresses.single().payload)
    }

    @Test
    fun powerSourceUpdateOffersTheConfiguredChargingCurrent() {
        listOf(2400, 1500, 500).forEach { milliAmps ->
            val frame = Iap2WiredControlClient.powerSourceUpdate(milliAmps)

            assertEquals(0xae03, frame.messageId)
            val current = Iap2BodyReader.of(frame).list().single { it.id == 0 }.payload
            assertArrayEquals(byteArrayOf((milliAmps shr 8).toByte(), milliAmps.toByte()), current)
        }
    }
}
