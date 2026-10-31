package com.shilapi.xcertplay.network

import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNotNull
import org.junit.Test

class CarPlayBonjourTest {
    @Test fun namedMdnsAddressesCacheTheInstanceNameAndPreserveBindingBytesAndNumericScope() {
        val hostname = "carplay-020000000002"
        val ipv4 = InetAddress.getByAddress("previous-name", byteArrayOf(192.toByte(), 0, 2, 10))
        val named4 = namedMdnsAddress(ipv4, hostname)
        assertTrue(named4 is Inet4Address)
        assertArrayEquals(ipv4.address, named4.address)
        assertEquals(hostname, named4.hostName)
        assertEquals("previous-name", ipv4.hostName)

        val ipv6 = Inet6Address.getByAddress("previous-name", InetAddress.getByName("fe80::1234").address, 7)
        val named6 = namedMdnsAddress(ipv6, hostname) as Inet6Address
        assertArrayEquals(ipv6.address, named6.address)
        assertEquals(ipv6.scopeId, named6.scopeId)
        assertEquals(ipv6.scopedInterface, named6.scopedInterface)
        assertEquals(hostname, named6.hostName)
        assertEquals("previous-name", ipv6.hostName)
    }

    @Test fun namedMdnsIpv6AddressPreservesTheScopedInterface() {
        val loopback = InetAddress.getByName("::1")
        val network = NetworkInterface.getByInetAddress(loopback)
        assumeNotNull(network)
        val scoped = Inet6Address.getByAddress(null, loopback.address, network)
        val named = namedMdnsAddress(scoped, "carplay-020000000002") as Inet6Address
        assertArrayEquals(scoped.address, named.address)
        assertEquals(scoped.scopeId, named.scopeId)
        assertEquals(scoped.scopedInterface, named.scopedInterface)
        assertEquals("carplay-020000000002", named.hostName)
    }

    @Test fun startupPhaseRecordsBeforeTheOperationAndReportsOnlyFamilyStageAndElapsedTime() {
        val records = mutableListOf<String>()
        val result = mdnsStartupPhase(InetAddress.getByName("192.0.2.10"), "create", records::add) {
            assertEquals(listOf("mdns startup family=IPv4 stage=create state=starting"), records)
            "created"
        }
        assertEquals("created", result)
        assertEquals(2, records.size)
        assertTrue(records.last().matches(Regex("mdns startup family=IPv4 stage=create state=ready elapsedMs=\\d+")))
    }

    @Test fun failedStartupPhasePreservesTheFailureAndOmitsItsSensitiveMessage() {
        val records = mutableListOf<String>()
        val failure = IOException("Private phone fe80::1234")
        val thrown = assertThrows(IOException::class.java) {
            mdnsStartupPhase(InetAddress.getByName("fe80::1234"), "register", records::add) { throw failure }
        }
        assertSame(failure, thrown)
        assertEquals("mdns startup family=IPv6 stage=register state=starting", records.first())
        assertTrue(records.last().matches(Regex("mdns startup family=IPv6 stage=register state=failed elapsedMs=\\d+ failureClass=IOException")))
        assertFalse(records.any { "Private phone" in it || "fe80" in it })
    }

    @Test fun startupDiagnosticFailureCannotChangeTheOperationResultOrOriginalFailure() {
        val address = InetAddress.getByName("192.0.2.10")
        val diagnostic: (String) -> Unit = { throw IllegalStateException("log unavailable") }
        assertEquals("registered", mdnsStartupPhase(address, "listener", diagnostic) { "registered" })
        val failure = IOException("register failed")
        val thrown = assertThrows(IOException::class.java) {
            mdnsStartupPhase(address, "register", diagnostic) { throw failure }
        }
        assertSame(failure, thrown)
    }

    @Test fun discoveryDiagnosticsKeepOutcomeWithoutPhoneIdentifiers() {
        val endpoint = CarPlayBonjourEndpoint("Private phone", "192.168.43.25", 7000, "AA:BB:CC:DD:EE:FF")
        assertEquals("control resolved family=IPv4 port=7000", CarPlayBonjourEvent.Resolved(endpoint).diagnosticSummary())
        assertEquals("control probe attempts=2 status=200 error=none",
            CarPlayBonjourEvent.Probed(endpoint, 2, "HTTP/1.1 200 Private phone", null).diagnosticSummary())
        val failed = CarPlayBonjourEvent.Probed(endpoint, 3, null, java.io.IOException("Private phone 192.168.43.25"))
            .diagnosticSummary()
        assertEquals("control probe attempts=3 status=none error=IOException", failed)
        assertFalse(failed.contains("Private phone"))
        assertEquals("control probe stage=TCP_CONNECTED attempt=2 family=IPv6",
            CarPlayBonjourEvent.ProbeProgress(CarPlayBonjourEvent.ProbeProgress.Stage.TCP_CONNECTED, 2, true).diagnosticSummary())
        assertEquals("control probe failed after=REQUEST_SENT attempt=1 failureClass=SocketTimeoutException",
            CarPlayBonjourEvent.ProbeFailed(CarPlayBonjourEvent.ProbeProgress.Stage.REQUEST_SENT, 1,
                java.net.SocketTimeoutException("Private phone secret")).diagnosticSummary())
    }
    private val config = AirPlayConfig(
        deviceName = "xcertplay",
        deviceId = "02:00:00:00:00:02",
        btMac = "02:00:00:00:00:02",
        sourceVersion = "366.0",
        main = AirPlayDisplayConfig(widthPixels = 1280, heightPixels = 720),
        model = "LIVI",
    )
    private val identity = AirPlayIdentity(
        privateKey = ByteArray(32),
        publicKey = byteArrayOf(0x01, 0x23, 0xab.toByte()),
        pairingId = "pairing-1",
    )

    @Test
    fun airPlayTxtRecordsUseCurrentReceiverCapabilities() {
        assertEquals(
            linkedMapOf(
                "deviceid" to "02:00:00:00:00:02",
                "features" to "0x5653aee2,0x61",
                "flags" to "0x4",
                "model" to "LIVI",
                "srcvers" to "366.0",
                "protovers" to "1.1",
                "pi" to "pairing-1",
                "pk" to "0123ab",
            ),
            CarPlayBonjourProtocol.airPlayTxtRecords(config, identity),
        )
    }

    @Test fun discoveryFeaturesAgreeWithInfoForAudioEnabledAndDisabled() {
        for (receiver in listOf(
            config,
            config.copy(audioViaCarBluetooth = true),
            config.copy(disableAudioOutput = true),
            config.copy(audioViaCarBluetooth = true, disableAudioOutput = true),
        )) {
            val parts = CarPlayBonjourProtocol.airPlayTxtRecords(receiver, identity).getValue("features")
                .split(',').map { it.removePrefix("0x").toLong(16) }
            val decoded = parts[0] or ((parts.getOrElse(1) { 0L }) shl 32)
            assertEquals(com.shilapi.xcertplay.airplay.AirPlayInfoPlist.build(receiver)["features"], decoded)
        }
        assertEquals("0xffffffff", CarPlayBonjourProtocol.featuresTxt(0xffffffffL))
        // Car Bluetooth sound keeps the audio feature bits, as Carlinkit's BtAudio=1 does.
        assertEquals("0x5653aee2,0x61",
            CarPlayBonjourProtocol.airPlayTxtRecords(config.copy(audioViaCarBluetooth = true), identity)["features"])
    }

    @Test
    fun connectProbeRequestMatchesExactRequestLineAndHeaders() {
        assertEquals(
            "GET /ctrl-int/1/connect HTTP/1.1\r\n" +
                "Host: [fe80::1]:7000\r\n" +
                "User-Agent: AirPlay/366.0\r\n" +
                "AirPlay-Receiver-Device-ID: 020000000002\r\n" +
                "Connection: close\r\n" +
                "\r\n",
            CarPlayBonjourProtocol.connectProbeRequest(
                host = "fe80::1%wlan0",
                port = 7000,
                sourceVersion = "366.0",
                deviceId = "02:00:00:00:00:02",
            ),
        )
    }
}
