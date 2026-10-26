package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.Srp6a
import com.shilapi.xcertplay.airplay.Tlv8Codec
import com.shilapi.xcertplay.airplay.Tlv8Item
import org.bouncycastle.crypto.agreement.srp.SRP6Client
import org.bouncycastle.crypto.digests.SHA512Digest
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom

class ReceiverAirPlay2Test {
    @Test fun transientSrpProvesThePeerAndDerivesSeparateControlAndEventEpochs() {
        val receiver = ReceiverAirPlay2Pairing()
        assertNull(receiver.takeControlCipher())
        val challenge = Tlv8Codec.decode(receiver.handle(tlv(6 to byteArrayOf(1),
            0 to byteArrayOf(0), 19 to byteArrayOf(0x10))))
        assertEquals(2, challenge[6]!!.single().toInt())
        assertFalse(receiver.complete)
        val salt = challenge[2]!!
        val serverPublic = challenge[3]!!
        // Bouncy Castle independently computes the SRP client exponent/secret.
        val client = SRP6Client().apply {
            init(Srp6a.modulus(), BigInteger.valueOf(5), SHA512Digest(), SecureRandom())
        }
        val publicKey = client.generateClientCredentials(salt, "Pair-Setup".toByteArray(), "3939".toByteArray())
        val shared = hash(unsigned(client.calculateSecret(BigInteger(1, serverPublic))))
        val ng = xor(hash(unsigned(Srp6a.modulus())), hash(byteArrayOf(5)))
        val clientProof = hash(ng, hash("Pair-Setup".toByteArray()), salt, pad(publicKey), serverPublic, shared)
        val reply = Tlv8Codec.decode(receiver.handle(tlv(6 to byteArrayOf(3),
            3 to pad(publicKey), 4 to clientProof)))
        assertEquals(4, reply[6]!!.single().toInt())
        assertArrayEquals(hash(pad(publicKey), clientProof, shared), reply[4])
        assertTrue(receiver.complete)

        val control = receiver.takeControlCipher()!!
        assertNull(receiver.takeControlCipher())
        val clientControl = ReceiverAirPlay2Cipher(derive(shared, "Control", "Read"), derive(shared, "Control", "Write"))
        val request = "SETUP /session RTSP/1.0\r\n\r\n".toByteArray()
        assertArrayEquals(request, control.input(ByteArrayInputStream(clientControl.encrypt(request))).readBytes())
        val response = "RTSP/1.0 200 OK\r\n\r\n".toByteArray()
        assertArrayEquals(response, clientControl.input(ByteArrayInputStream(control.encrypt(response))).readBytes())

        val events = receiver.takeEventCipher()!!
        assertNull(receiver.takeEventCipher())
        val clientEvents = ReceiverAirPlay2Cipher(derive(shared, "Events", "Write"), derive(shared, "Events", "Read"))
        assertArrayEquals(request, events.input(ByteArrayInputStream(clientEvents.encrypt(request))).readBytes())
        assertArrayEquals(response, clientEvents.input(ByteArrayInputStream(events.encrypt(response))).readBytes())
        receiver.close()
        assertFalse(receiver.complete)
    }

    @Test fun invalidProofTruncationAndStateReplayCannotInstallControlKeys() {
        for (first in listOf(
            tlv(6 to byteArrayOf(3), 3 to ByteArray(384), 4 to ByteArray(64)),
            tlv(6 to byteArrayOf(1), 0 to byteArrayOf(0)), // persistent pairing is not transient
            tlv(6 to byteArrayOf(1), 0 to byteArrayOf(0), 19 to byteArrayOf(0x10)) + byteArrayOf(7),
            tlv(6 to byteArrayOf(1), 0 to byteArrayOf(0), 19 to byteArrayOf(0x10)) + tlv(6 to byteArrayOf(1)),
        )) {
            val receiver = ReceiverAirPlay2Pairing()
            assertNotNull(Tlv8Codec.decode(receiver.handle(first))[7])
            assertNull(receiver.takeControlCipher())
            assertFalse(receiver.complete)
        }
        val receiver = ReceiverAirPlay2Pairing()
        val hello = tlv(6 to byteArrayOf(1), 0 to byteArrayOf(0), 19 to byteArrayOf(0x10))
        receiver.handle(hello)
        assertNotNull(Tlv8Codec.decode(receiver.handle(tlv(6 to byteArrayOf(3),
            3 to byteArrayOf(1), 4 to ByteArray(64))))[7])
        assertNull(receiver.takeControlCipher())
        assertNotNull(Tlv8Codec.decode(receiver.handle(hello))[7])
    }

    @Test fun hapFramesAreBoundedAuthenticatedAndCountersNeverRestartAfterFailure() {
        val read = ByteArray(32) { it.toByte() }
        val write = ByteArray(32) { (it + 32).toByte() }
        val sender = ReceiverAirPlay2Cipher(write, read)
        val receiver = ReceiverAirPlay2Cipher(read, write)
        val plain = ByteArray(2049) { (it * 11).toByte() }
        val sealed = sender.encrypt(plain)
        assertEquals(2049 + 3 * 18, sealed.size)
        assertArrayEquals(plain, receiver.input(ByteArrayInputStream(sealed)).readBytes())
        // Replaying nonce zero after consuming three frames fails authentication.
        assertThrows(IOException::class.java) { receiver.read(ByteArrayInputStream(sealed)) }
        assertThrows(IllegalStateException::class.java) { receiver.encrypt(byteArrayOf(1)) }
        for (invalid in listOf(byteArrayOf(1), byteArrayOf(0, 0), byteArrayOf(1, 4), sealed.copyOf(10),
            sealed.copyOf().also { it[18] = (it[18].toInt() xor 1).toByte() })) {
            assertThrows(IOException::class.java) { ReceiverAirPlay2Cipher(read, write).read(ByteArrayInputStream(invalid)) }
        }
    }

    @Test fun realtimeAudioAuthenticatesTimestampSsrcAndNonceBeforeReturningPayload() {
        val key = ByteArray(32) { (it * 3).toByte() }
        val header = byteArrayOf(0x80.toByte(), 0xe0.toByte(), 0x12, 0x34, 0, 1, 2, 3, 4, 5, 6, 7)
        val nonce = byteArrayOf(7, 6, 5, 4, 3, 2, 1, 0)
        val plain = ByteArray(117) { (it * 7).toByte() }
        val wire = header + AirPlayCrypto.chachaSeal(key, ByteArray(4) + nonce, plain, header.copyOfRange(4, 12)) + nonce
        assertArrayEquals(plain, ReceiverAirPlay2AudioPacket.decrypt(wire, key))
        for (index in listOf(4, 8, 12, wire.lastIndex)) {
            assertNull(ReceiverAirPlay2AudioPacket.decrypt(wire.copyOf().also { it[index] = (it[index].toInt() xor 1).toByte() }, key))
        }
        assertNull(ReceiverAirPlay2AudioPacket.decrypt(wire.copyOf(20), key))
        assertNull(ReceiverAirPlay2AudioPacket.decrypt(wire, ByteArray(16)))
        assertNull(ReceiverAirPlay2AudioPacket.decrypt(wire.copyOf().also { it[0] = 0x90.toByte() }, key))
    }

    private fun tlv(vararg fields: Pair<Int, ByteArray>) = Tlv8Codec.encode(fields.map { Tlv8Item(it.first, it.second) })
    private fun derive(secret: ByteArray, channel: String, direction: String) =
        AirPlayCrypto.hkdfSha512(secret, "$channel-Salt".toByteArray(), "$channel-$direction-Encryption-Key".toByteArray())
    private fun hash(vararg values: ByteArray): ByteArray = MessageDigest.getInstance("SHA-512").run {
        values.forEach(::update)
        digest()
    }
    private fun xor(a: ByteArray, b: ByteArray) = ByteArray(a.size) { (a[it].toInt() xor b[it].toInt()).toByte() }
    private fun unsigned(value: BigInteger): ByteArray = value.toByteArray().let {
        if (it.size > 1 && it[0] == 0.toByte()) it.copyOfRange(1, it.size) else it
    }
    private fun pad(value: BigInteger) = ByteArray(384).also { unsigned(value).copyInto(it, 384 - unsigned(value).size) }
}
