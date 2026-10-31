package com.shilapi.xcertplay

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.receiver.ReceiverBonjour
import com.shilapi.xcertplay.receiver.ReceiverConfig
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.jmdns.JmDNS
import javax.jmdns.ServiceInfo
import org.junit.Assert.*
import org.junit.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock

class ReceiverBonjourLifecycleTest {
    private class Advertisement {
        val services = mutableListOf<ServiceInfo>()
        var closes = 0
        val dns = mock(JmDNS::class.java).also { dns ->
            doAnswer { call -> services += call.getArgument<ServiceInfo>(0); null }
                .`when`(dns).registerService(any(ServiceInfo::class.java))
            doAnswer { closes++; null }.`when`(dns).close()
        }
    }

    @Test fun aReplacementReceiverCannotAdvertiseWhileTheOldAddressIsStillClosing() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val address = InetAddress.getByName("192.0.2.41") as Inet4Address
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val oldDns = Advertisement().dns
        doAnswer { entered.countDown(); release.await(); null }.`when`(oldDns).close()
        val old = ReceiverBonjour(config, 7000, interfaceAddresses = { listOf("wlan2" to address) },
            createDns = { _, _ -> oldDns })
        val created = AtomicInteger()
        val replacement = ReceiverBonjour(config, 7000, interfaceAddresses = { listOf("wlan2" to address) },
            createDns = { _, _ -> created.incrementAndGet(); Advertisement().dns })
        assertTrue(old.refresh())
        val closer = Thread { old.close() }
        closer.start()
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            assertFalse(replacement.refresh())
            assertEquals(0, created.get())
            release.countDown()
            closer.join(2_000)
            assertFalse(closer.isAlive)
            assertTrue(replacement.refresh())
            assertEquals(1, created.get())
            assertFalse(old.refresh())
        } finally { release.countDown(); closer.join(2_000); replacement.close() }
    }

    @Test fun classicCodecChangesRetireStaleRaopEvenWhenTheAirPlayTxtIsUnchanged() {
        // Both profiles have the PCM feature group; only the CD profile is offered through RAOP.
        val cd = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            audioOutputFormats = 1L shl 11)
        val only48k = cd.copy(audioOutputFormats = 1L shl 15)
        assertEquals(cd.txt, only48k.txt)
        assertEquals("0", cd.raopTxt["cn"])
        assertEquals("", only48k.raopTxt["cn"])
        var current = cd
        val advertisements = mutableListOf<Advertisement>()
        val address = InetAddress.getByName("192.0.2.40") as Inet4Address
        val receiver = ReceiverBonjour(cd, 7000, { current }, interfaceAddresses = { listOf("wlan2" to address) },
            createDns = { _, _ -> Advertisement().also(advertisements::add).dns })
        try {
            assertTrue(receiver.refresh())
            assertEquals(listOf("_airplay._tcp.local.", "_raop._tcp.local."), advertisements[0].services.map { it.type })
            assertEquals("0", advertisements[0].services.last().getPropertyString("cn"))
            receiver.refresh()
            assertEquals("Stable advertisements keep their existing mDNS owner", 1, advertisements.size)

            current = only48k
            assertTrue(receiver.refresh())
            assertEquals(1, advertisements[0].closes)
            assertEquals(listOf("_airplay._tcp.local."), advertisements[1].services.map { it.type })
            receiver.refresh()
            assertEquals(2, advertisements.size)

            current = cd
            assertTrue(receiver.refresh())
            assertEquals(1, advertisements[1].closes)
            assertEquals(listOf("_airplay._tcp.local.", "_raop._tcp.local."), advertisements[2].services.map { it.type })
            assertEquals(cd.raopName, advertisements[2].services.last().name)
        } finally { receiver.close() }
        assertEquals(listOf(1, 1, 1), advertisements.map { it.closes })
    }
}
