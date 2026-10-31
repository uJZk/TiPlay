package com.shilapi.xcertplay.network

import com.shilapi.xcertplay.airplay.*
import java.net.InetAddress
import java.util.concurrent.LinkedBlockingQueue
import javax.jmdns.JmDNS
import javax.jmdns.ServiceEvent
import javax.jmdns.ServiceInfo
import javax.jmdns.ServiceListener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BonjourMailboxTest {
    @Test fun floodingCandidatesCannotGrowTheQueueAndRejectedNamesRemainRetryable() {
        val source = InetAddress.getByName("192.0.2.10")
        val target = InetAddress.getByName("192.0.2.20")
        val dns = mock(JmDNS::class.java)
        `when`(dns.inetAddress).thenReturn(source)
        val discovery = CarPlayBonjour(RuntimeEnvironment.getApplication(),
            AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480)),
            AirPlayIdentity(ByteArray(32), ByteArray(32), "test"), source.hostAddress, true)
        val listener = ReflectionHelpers.getField<ServiceListener>(discovery, "interfaceListener")
        fun resolved(name: String) {
            val info = mock(ServiceInfo::class.java)
            `when`(info.inetAddresses).thenReturn(arrayOf(target))
            `when`(info.port).thenReturn(1234)
            `when`(info.getPropertyString("id")).thenReturn(null)
            val event = mock(ServiceEvent::class.java)
            `when`(event.dns).thenReturn(dns)
            `when`(event.info).thenReturn(info)
            `when`(event.name).thenReturn(name)
            listener.serviceResolved(event)
        }
        try {
            repeat(80) { resolved("candidate-$it") }
            val queue = ReflectionHelpers.getField<LinkedBlockingQueue<*>>(discovery, "interfaceServices")
            assertEquals(32, queue.size)
            assertTrue(discovery.diagnosticSnapshot().contains("bonjourRejected=48"))
            queue.poll(); resolved("candidate-79")
            assertEquals("A dropped candidate must be allowed back after capacity returns", 32, queue.size)
        } finally { discovery.close(); assertTrue(discovery.awaitClosed(2_000)) }
    }
}
