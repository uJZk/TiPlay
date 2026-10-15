package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import org.junit.Assert.*
import org.junit.Test

class ReceiverPairingTest {
    @Test fun legacyHandshakeVerifiesBothSignaturesAndReleasesSharedSecretOnlyAfterProof() {
        val identity = AirPlayIdentity.generate()
        val receiver = ReceiverPairing(identity)
        assertArrayEquals(identity.publicKey, receiver.setup(ByteArray(32)))
        val curve = AirPlayCrypto.x25519Generate()
        val signing = AirPlayCrypto.ed25519Generate()
        val reply = receiver.verify(byteArrayOf(1, 0, 0, 0) + curve.publicKey + signing.publicKey)
        assertNull(receiver.sharedSecret)
        assertNull(receiver.verifiedPublicKey)
        val serverCurve = reply.copyOf(32)
        val secret = AirPlayCrypto.x25519Shared(curve.privateKey, serverCurve)
        val cipher = aesCtr(AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), secret).copyOf(16),
            AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), secret).copyOf(16))
        assertTrue(AirPlayCrypto.ed25519Verify(identity.publicKey, serverCurve + curve.publicKey, cipher.update(reply.copyOfRange(32, 96))))
        val clientSignature = AirPlayCrypto.ed25519Sign(signing.privateKey, curve.publicKey + serverCurve)
        assertEquals(0, receiver.verify(ByteArray(4) + cipher.update(clientSignature)).size)
        assertArrayEquals(secret, receiver.sharedSecret)
        assertArrayEquals(signing.publicKey, receiver.verifiedPublicKey)
        receiver.verifiedPublicKey!!.fill(0)
        assertArrayEquals(signing.publicKey, receiver.verifiedPublicKey)
        assertThrows(ReceiverPairingFailure::class.java) { receiver.verify(ByteArray(0)) }
        assertNull(receiver.sharedSecret)
        assertNull(receiver.verifiedPublicKey)
    }

    @Test fun badProofCannotAuthorizeMedia() {
        val receiver = ReceiverPairing(AirPlayIdentity.generate())
        receiver.verify(byteArrayOf(1, 0, 0, 0) + AirPlayCrypto.x25519Generate().publicKey + AirPlayCrypto.ed25519Generate().publicKey)
        assertThrows(IllegalArgumentException::class.java) { receiver.verify(ByteArray(68)) }
        assertNull(receiver.sharedSecret)
        assertNull(receiver.verifiedPublicKey)
        // A failed proof also destroys its cipher/pending state; retrying the old step cannot succeed.
        assertThrows(ReceiverPairingFailure::class.java) { receiver.verify(ByteArray(68)) }
        assertNull(receiver.sharedSecret)
    }

    @Test fun invalidSetupDiscardsAnInProgressVerification() {
        val receiver = ReceiverPairing(AirPlayIdentity.generate())
        receiver.verify(byteArrayOf(1, 0, 0, 0) + AirPlayCrypto.x25519Generate().publicKey + AirPlayCrypto.ed25519Generate().publicKey)
        assertThrows(ReceiverPairingFailure::class.java) { receiver.setup(ByteArray(31)) }
        assertThrows(ReceiverPairingFailure::class.java) { receiver.verify(ByteArray(68)) }
        assertNull(receiver.sharedSecret)
    }

    @Test fun ctrContinuesAcrossNonBlockAlignedPackets() {
        val key = ByteArray(16) { it.toByte() }
        val iv = ByteArray(16) { (it + 20).toByte() }
        val plain = ByteArray(263) { (it * 3).toByte() }
        val ciphertext = aesCtr(key, iv).doFinal(plain)
        val decryptor = aesCtr(key, iv)
        val decrypted = listOf(0..6, 7..25, 26..262).fold(ByteArray(0)) { result, range ->
            result + decryptor.update(ciphertext.sliceArray(range))
        }
        assertArrayEquals(plain, decrypted)
    }
}
