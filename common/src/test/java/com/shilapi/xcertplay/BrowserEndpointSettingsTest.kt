package com.shilapi.xcertplay

import java.net.ServerSocket
import java.net.Socket
import java.time.Duration
import android.os.Looper
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BrowserEndpointSettingsTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @After fun cleanup() {
        TeslaBrowserLink.resetForTest()
        TeslaBrowserLink.serverFactory = TiPlayTestApplication.noSocketServers
        context.getSharedPreferences("tiplay_browser_link", 0).edit().clear().commit()
    }

    @Test fun endpointAcceptsBothAddressRangesAndKeepsThePortForLegacyIpOnlyInput() {
        val endpoint = BrowserEndpointSettings.parse(" 100.109.220.253:8181 ", 8080)!!
        assertEquals("100.109.220.253", endpoint.address.hostAddress)
        assertEquals(8181, endpoint.port)
        assertEquals(8888, BrowserEndpointSettings.parse("169.254.1.2", 8888)!!.port)
        for (bad in listOf("10.0.0.1:8080", "100.109.220.253:0", "100.109.220.253:65536",
            "100.109.220.253:1023", "100.109.220.253:1",
            "100.109.220.253:-1", "100.109.220.253:", "100.109.220.253:8080:80", "100.109.220.253:abc")) {
            assertNull(bad, BrowserEndpointSettings.parse(bad, 8080))
        }
        assertEquals(1024, BrowserEndpointSettings.parse("100.109.220.253:1024", 8080)!!.port)
        assertEquals(65535, BrowserEndpointSettings.parse("169.254.1.2:65535", 8080)!!.port)
        assertNull(BrowserEndpointSettings.parse("100.109.220.253", 1023))
    }

    @Test fun savedPortDefaultsTo8080AndUnchangedSavesDoNotRequestARestart() {
        assertEquals(8080, BrowserEndpointSettings.port(context))
        assertFalse(BrowserEndpointSettings.savePort(context, 8080))
        assertTrue(BrowserEndpointSettings.savePort(context, 8181))
        assertEquals(8181, BrowserEndpointSettings.port(context))
        assertFalse(BrowserEndpointSettings.savePort(context, 8181))
    }
    @Test fun selectedRepairMethodRestrictsOnlyExplicitUiParsing() {
        for (method in HotspotAddressMethod.entries) {
            val allowed = if (method == HotspotAddressMethod.VPN) "169.254.1.2" else "100.109.220.253"
            val rejected = if (method == HotspotAddressMethod.VPN) "100.109.220.253" else "169.254.1.2"
            assertEquals(1024, BrowserEndpointSettings.parse("$allowed:1024", 8080, method)!!.port)
            assertEquals(65535, BrowserEndpointSettings.parse("$allowed:65535", 8080, method)!!.port)
            assertEquals(8181, BrowserEndpointSettings.parse(allowed, 8181, method)!!.port)
            if (method == HotspotAddressMethod.VPN) assertNull(BrowserEndpointSettings.parse("$rejected:8080", 8080, method))
            else assertEquals(rejected, BrowserEndpointSettings.parse("$rejected:8080", 8080, method)!!.address.hostAddress)
            assertEquals("169.254.111.111", BrowserEndpointSettings.parse("  ", 8181, method)!!.address.hostAddress)
            assertEquals(8181, BrowserEndpointSettings.parse("", 8181, method)!!.port)
            assertNull(BrowserEndpointSettings.parse("$allowed:1023", 8080, method))
        }
        assertEquals("169.254.1.2", BrowserEndpointSettings.parse("169.254.1.2:8080", 8080)!!.address.hostAddress)
        assertEquals("100.109.220.253", BrowserEndpointSettings.parse("100.109.220.253:8080", 8080)!!.address.hostAddress)
    }

    @Test fun theRealListenerMovesToTheChosenPortAndKeepsThePairingCode() {
        TeslaBrowserLink.resetForTest()
        TeslaBrowserLink.serverFactory = TeslaBrowserLink.appServers
        fun availablePort() = ServerSocket(0).use { it.localPort }
        val first = availablePort()
        BrowserEndpointSettings.savePort(context, first)
        TeslaBrowserLink.start(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(TeslaBrowserLink.State.Listening(first), TeslaBrowserLink.state)
        val code = TeslaBrowserLink.pairingCode(context)
        var second = availablePort()
        while (second == first) second = availablePort()
        BrowserEndpointSettings.savePort(context, second)
        TeslaBrowserLink.onPortChanged()
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(TeslaBrowserLink.State.Listening(second), TeslaBrowserLink.state)
        assertEquals(code, TeslaBrowserLink.pairingCode(context))
        ServerSocket().apply { reuseAddress = true; bind(java.net.InetSocketAddress(first)) }.use { assertTrue(it.isBound) }
        Socket("127.0.0.1", second).use { socket ->
            socket.soTimeout = 3000
            socket.getOutputStream().write("GET /hello HTTP/1.1\r\nHost: 127.0.0.1:$second\r\nConnection: close\r\n\r\n".toByteArray())
            assertTrue(socket.getInputStream().bufferedReader().readText().contains("\"app\":\"TiPlay\""))
        }
    }

    @Test fun endpointChangesAnnounceTheLatestTargetBeforeMovingTheListener() {
        TeslaBrowserLink.resetForTest()
        TeslaBrowserLink.serverFactory = TeslaBrowserLink.appServers
        val oldPort = ServerSocket(0).use { it.localPort }
        BrowserEndpointSettings.savePort(context, oldPort)
        TeslaBrowserLink.start(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        val newPort = ServerSocket(0).use { it.localPort }
        BrowserEndpointSettings.savePort(context, newPort)
        BrowserEndpointChanges.apply(context, portChanged = true)
        assertEquals("169.254.111.111:$newPort", TeslaBrowserLink.status().endpoint)
        assertEquals(TeslaBrowserLink.State.Listening(oldPort), TeslaBrowserLink.state)
        // A second address edit must not lose the pending listener restart.
        BrowserEndpointChanges.apply(context)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1200))
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(TeslaBrowserLink.State.Listening(newPort), TeslaBrowserLink.state)
    }
}
