package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.airplay.Srp6a
import com.shilapi.xcertplay.airplay.Tlv8Codec
import com.shilapi.xcertplay.airplay.Tlv8Item
import com.shilapi.xcertplay.web.WebMediaSink
import org.bouncycastle.crypto.agreement.srp.SRP6Client
import org.bouncycastle.crypto.digests.SHA512Digest
import org.junit.Assert.*
import org.junit.Test
import java.io.InputStream
import java.math.BigInteger
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ReceiverAirPlay2ServerTest {
    private class Listener : ReceiverServer.Listener {
        val payloads = CopyOnWriteArrayList<ByteArray>()
        val types = CopyOnWriteArrayList<String>()
        val received = CountDownLatch(1)
        var screenLoans = 0
        override fun authorizeConnection(sessionToken: String, deviceName: String, mediaType: String): Boolean {
            types.add(mediaType)
            return true
        }
        override fun prepareMirror() { screenLoans++ }
        override fun mirrorSink(): WebMediaSink = error("audio must not open a canvas")
        override fun mirrorAudioTimed(format: ReceiverMirrorAudioFormat, payload: ByteArray, sample: Long, presentationNanos: Long?) {
            payloads.add(payload)
            received.countDown()
        }
        override fun play(item: ReceiverPlay) = error("audio must not open URL playback")
        override fun stopPlayback() {}
        override fun seek(seconds: Double) {}
        override fun rate(value: Double) {}
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) {}
    }

    @Test fun transientPairingNtpAndEncryptedRealtimeAudioKeepTheCarPlayScreenAvailable() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS), listener)
        receiver.start()
        try {
            Peer(receiver.port).use { peer ->
                val secret = peer.pair()
                val ntp = peer.request("SETUP", "/session", BplistCodec.encode(mapOf(
                    "timingProtocol" to "NTP", "timingPort" to 0L,
                )))
                assertEquals("200", ntp.path)
                val session = BplistCodec.decode(ntp.body) as Map<*, *>
                assertTrue((session["timingPort"] as Number).toInt() in 1..65535)
                val eventPort = (session["eventPort"] as Number).toInt()
                assertTrue(eventPort in 1..65535)
                // The event channel has different keys and independently starts at counter zero.
                Socket().apply { connect(InetSocketAddress("127.0.0.1", eventPort)); soTimeout = 2000 }.use { event ->
                    val cipher = ReceiverAirPlay2Cipher(derive(secret, "Events", "Write"), derive(secret, "Events", "Read"))
                    event.getOutputStream().write(cipher.encrypt("POST /feedback RTSP/1.0\r\nCSeq: 1\r\nContent-Length: 0\r\n\r\n".toByteArray()))
                    assertEquals("200", readReceiverRequest(cipher.input(event.getInputStream()))!!.path)
                }
                val key = ByteArray(32) { (it + 20).toByte() }
                val response = peer.request("SETUP", "/stream", BplistCodec.encode(mapOf("streams" to listOf(mapOf(
                    "type" to 96L, "ct" to 1L, "sr" to 44100L, "ch" to 2L, "spf" to 352L,
                    "shk" to key, "controlPort" to 0L,
                )))))
                assertEquals("200", response.path)
                val streams = (BplistCodec.decode(response.body) as Map<*, *>)["streams"] as List<*>
                val dataPort = ((streams.single() as Map<*, *>)["dataPort"] as Number).toInt()
                val header = byteArrayOf(0x80.toByte(), 0xe0.toByte(), 0, 1, 0, 0, 1, 0, 1, 2, 3, 4)
                val nonce = byteArrayOf(1, 0, 0, 0, 0, 0, 0, 0)
                val pcm = byteArrayOf(0x01, 0x23, 0x45, 0x67)
                val packet = header + AirPlayCrypto.chachaSeal(key, ByteArray(4) + nonce, pcm, header.copyOfRange(4, 12)) + nonce
                DatagramSocket().use { udp ->
                    val corrupt = packet.copyOf().also { it[12] = (it[12].toInt() xor 1).toByte() }
                    udp.send(DatagramPacket(corrupt, corrupt.size, InetAddress.getByName("127.0.0.1"), dataPort))
                    udp.send(DatagramPacket(packet, packet.size, InetAddress.getByName("127.0.0.1"), dataPort))
                }
                assertTrue("authenticated RTP reaches the browser producer", listener.received.await(2, TimeUnit.SECONDS))
                assertEquals(1, listener.payloads.size)
                assertArrayEquals(pcm, listener.payloads.single())
                assertEquals(listOf("audio"), listener.types)
                assertEquals(0, listener.screenLoans)
                assertEquals("200", peer.request("FLUSH", "/stream").path)
                assertEquals("200", peer.request("TEARDOWN", "/stream").path)
            }
        } finally { receiver.close() }
    }

    @Test fun unsupportedPtpDoesNotStartAnAudioOrDisplayProducer() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS), listener)
        receiver.start()
        try {
            Peer(receiver.port).use { peer ->
                peer.pair()
                assertEquals("461", peer.request("SETUP", "/session", BplistCodec.encode(mapOf("timingProtocol" to "PTP"))).path)
                assertEquals(0, listener.screenLoans)
                assertTrue(listener.types.isEmpty())
                assertTrue(listener.payloads.isEmpty())
            }
        } finally { receiver.close() }
    }

    private class Peer(port: Int) : java.io.Closeable {
        private val socket = Socket().apply { connect(InetSocketAddress("127.0.0.1", port)); soTimeout = 3000 }
        private var input: InputStream = socket.getInputStream()
        private var cipher: ReceiverAirPlay2Cipher? = null
        private var sequence = 0
        fun request(method: String, path: String, body: ByteArray = ByteArray(0), pairing: Boolean = false): RtspMessage.Request {
            val headers = if (pairing) "Content-Type: application/octet-stream\r\nX-Apple-HKP: 4\r\n" else
                "Content-Type: application/x-apple-binary-plist\r\n"
            val message = ("$method $path RTSP/1.0\r\nCSeq: ${++sequence}\r\n${headers}Content-Length: ${body.size}\r\n\r\n").toByteArray() + body
            socket.getOutputStream().write(cipher?.encrypt(message) ?: message)
            return requireNotNull(readReceiverRequest(input))
        }
        fun pair(): ByteArray {
            val hello = request("POST", "/pair-setup", tlv(6 to byteArrayOf(1), 0 to byteArrayOf(0),
                19 to byteArrayOf(0x10)), pairing = true)
            assertEquals("200", hello.path)
            val fields = Tlv8Codec.decode(hello.body)
            val salt = requireNotNull(fields[2])
            val serverPublic = requireNotNull(fields[3])
            val client = SRP6Client().apply { init(Srp6a.modulus(), BigInteger.valueOf(5), SHA512Digest(), SecureRandom()) }
            val publicKey = client.generateClientCredentials(salt, "Pair-Setup".toByteArray(), "3939".toByteArray())
            val shared = hash(unsigned(client.calculateSecret(BigInteger(1, serverPublic))))
            val hashN = hash(unsigned(Srp6a.modulus()))
            val hashG = hash(byteArrayOf(5))
            val xor = ByteArray(64) { (hashN[it].toInt() xor hashG[it].toInt()).toByte() }
            val proof = hash(xor, hash("Pair-Setup".toByteArray()), salt, pad(publicKey), serverPublic, shared)
            val reply = request("POST", "/pair-setup", tlv(6 to byteArrayOf(3), 3 to pad(publicKey), 4 to proof), pairing = true)
            assertEquals("200", reply.path)
            assertArrayEquals(hash(pad(publicKey), proof, shared), Tlv8Codec.decode(reply.body)[4])
            cipher = ReceiverAirPlay2Cipher(derive(shared, "Control", "Read"), derive(shared, "Control", "Write"))
            input = cipher!!.input(input)
            return shared
        }
        override fun close() { socket.close(); cipher?.close() }
    }

    companion object {
        private fun tlv(vararg fields: Pair<Int, ByteArray>) = Tlv8Codec.encode(fields.map { Tlv8Item(it.first, it.second) })
        private fun derive(secret: ByteArray, channel: String, direction: String) =
            AirPlayCrypto.hkdfSha512(secret, "$channel-Salt".toByteArray(), "$channel-$direction-Encryption-Key".toByteArray())
        private fun hash(vararg values: ByteArray): ByteArray = MessageDigest.getInstance("SHA-512").run {
            values.forEach(::update)
            digest()
        }
        private fun unsigned(value: BigInteger): ByteArray = value.toByteArray().let {
            if (it.size > 1 && it[0] == 0.toByte()) it.copyOfRange(1, it.size) else it
        }
        private fun pad(value: BigInteger) = ByteArray(384).also { unsigned(value).copyInto(it, 384 - unsigned(value).size) }
    }
}
