package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverDiscoveryInfo
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class AirPlayBleDiscoverySocketTest {
    @Test fun firstBtRequestReturnsOrdinaryReceiverInfoAndBothBonjourTxtRecords() {
        val receiver = ReceiverConfig("ordinary-receiver", "02:11:22:33:44:55", AirPlayIdentity.generate(), hevcEnabled = true)
        val lease = ReceiverDiscoveryInfo.register { receiver }
        try {
            withSession { peer, _, _, _ ->
                val response = exchange(peer, "GET", "/info?txtAirPlay&txtRAOP", mapOf("X-Apple-QR" to "BT"))
                assertEquals("200", response.path)
                assertFalse(response.body.isEmpty())
                assertEquals("application/x-apple-binary-plist", response.headers["content-type"])
                assertFalse(response.headers.containsKey("cseq"))
                val info = BplistCodec.decode(response.body) as Map<*, *>
                assertEquals(receiver.deviceId, info["deviceID"])
                assertEquals(receiver.name, info["name"])
                assertArrayEquals(receiver.identity.publicKey, info["pk"] as ByteArray)
                assertEquals(receiver.features, (info["features"] as Number).toLong())
                assertEquals(receiver.txt, decodeTxt(info["txtAirPlay"] as ByteArray))
                assertEquals(receiver.raopTxt, decodeTxt(info["txtRAOP"] as ByteArray))
                assertFalse(info.containsKey("port"))
            }
        } finally { lease.close() }
    }

    @Test fun normalInfoAndPairingKeepTheCarPlayProfileAfterDiscovery() {
        val receiver = ReceiverConfig("ordinary-receiver", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val reads = AtomicInteger()
        val lease = ReceiverDiscoveryInfo.register { reads.incrementAndGet(); receiver }
        try {
            withSession { peer, session, config, identity ->
                assertEquals("200", exchange(peer, "GET", "/info?txtAirPlay&txtRAOP", mapOf("X-Apple-QR" to "BT")).path)
                val response = exchange(peer, "GET", "/info", mapOf("CSeq" to "1"))
                val info = BplistCodec.decode(response.body) as Map<*, *>
                assertEquals(config.deviceId, info["deviceID"])
                assertEquals(config.deviceName, info["name"])
                assertFalse(info.containsKey("txtAirPlay"))
                assertFalse(info.containsKey("txtRAOP"))
                val setup = exchange(peer, "POST", "/pair-setup", mapOf("CSeq" to "2"),
                    Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(1)))))
                assertEquals("application/pairing+tlv8", setup.headers["content-type"])
                val setupTlv = Tlv8Codec.decode(setup.body)
                assertArrayEquals(byteArrayOf(2), setupTlv[6])
                assertTrue(setupTlv.getValue(2).isNotEmpty())
                val ephemeral = AirPlayCrypto.x25519Generate()
                val verify = exchange(peer, "POST", "/pair-verify", mapOf("CSeq" to "3"),
                    Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(1)), Tlv8Item(3, ephemeral.publicKey))))
                assertEquals("application/pairing+tlv8", verify.headers["content-type"])
                val verifyTlv = Tlv8Codec.decode(verify.body)
                val shared = AirPlayCrypto.x25519Shared(ephemeral.privateKey, verifyTlv.getValue(3))
                val key = AirPlayCrypto.hkdfSha512(shared, "Pair-Verify-Encrypt-Salt".asciiBytes(),
                    "Pair-Verify-Encrypt-Info".asciiBytes())
                val accessory = Tlv8Codec.decode(AirPlayCrypto.chachaOpen(key,
                    AirPlayCrypto.nonceLabel("PV-Msg02"), verifyTlv.getValue(5)))
                assertEquals(identity.pairingId, accessory.getValue(1).toString(Charsets.UTF_8))
                assertTrue(AirPlayCrypto.ed25519Verify(identity.publicKey,
                    concatBytes(verifyTlv.getValue(3), accessory.getValue(1), ephemeral.publicKey), accessory.getValue(10)))
                assertFalse(session.pairSetup.complete)
                assertFalse(session.pairVerify.isVerified)
                assertEquals(1, reads.get())
                assertTrue(session.activeStreams.isEmpty())
            }
        } finally { lease.close() }
    }

    @Test fun disabledReceiverDoesNotReturnSuccessfulOrStaleDiscoveryInfo() {
        val lease = ReceiverDiscoveryInfo.register {
            ReceiverConfig("retired", "02:11:22:33:44:55", AirPlayIdentity.generate())
        }
        lease.close()
        withSession { peer, _, _, _ ->
            val response = exchange(peer, "GET", "/info?txtAirPlay&txtRAOP", mapOf("X-Apple-QR" to "BT"))
            assertEquals("503", response.path)
            assertTrue(response.body.isEmpty())
        }
    }

    private fun withSession(block: (Socket, AirPlaySession, AirPlayConfig, AirPlayIdentity) -> Unit) {
        ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { server ->
            Socket(server.inetAddress, server.localPort).use { peer ->
                peer.soTimeout = 2_000
                val config = AirPlayConfig("carplay-accessory", "02:99:88:77:66:55", "02:00:00:00:00:01", "1.0",
                    main = AirPlayDisplayConfig(800, 480))
                val identity = AirPlayIdentity.generate()
                val session = AirPlaySession(server.accept(), config, identity, PairingStore(), null,
                    object : AirPlaySessionListener {}, object : AirPlayMediaHandler {})
                session.start()
                try { block(peer, session, config, identity) } finally { session.close() }
            }
        }
    }

    private fun exchange(peer: Socket, method: String, path: String, headers: Map<String, String>,
        body: ByteArray = byteArrayOf()): RtspMessage.Request {
        val head = buildString {
            append("$method $path RTSP/1.0\r\n")
            for ((key, value) in headers) append("$key: $value\r\n")
            if (body.isNotEmpty()) append("Content-Length: ${body.size}\r\n")
            append("\r\n")
        }
        peer.getOutputStream().apply { write(head.toByteArray(Charsets.US_ASCII) + body); flush() }
        val received = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (true) {
            val count = peer.getInputStream().read(buffer)
            check(count >= 0) { "Control socket closed before response" }
            received.write(buffer, 0, count)
            RtspMessage.parseMessages(received.toByteArray()).messages.firstOrNull()?.let { return it }
        }
    }

    private fun decodeTxt(bytes: ByteArray): Map<String, String> {
        val result = linkedMapOf<String, String>()
        var position = 0
        while (position < bytes.size) {
            val length = bytes[position++].toInt() and 0xff
            assertTrue(length > 0 && position + length <= bytes.size)
            val entry = bytes.copyOfRange(position, position + length).toString(Charsets.UTF_8)
            result[entry.substringBefore('=')] = entry.substringAfter('=')
            position += length
        }
        assertEquals(bytes.size, position)
        return result
    }
}
