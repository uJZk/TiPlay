package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Signals a failed legacy handshake that must end its control connection. */
class ReceiverPairingFailure : IllegalArgumentException("invalid legacy pairing")

/** Legacy AirPlay pairing; independent of CarPlay's TLV8 and encrypted control channel. */
class ReceiverPairing(private val identity: AirPlayIdentity) {
    private var peerCurve: ByteArray? = null
    private var peerSigning: ByteArray? = null
    private var ownCurve: ByteArray? = null
    private var exchange: Cipher? = null
    private var pendingSecret: ByteArray? = null
    var sharedSecret: ByteArray? = null
        private set
    private var verifiedSigning: ByteArray? = null
    /** Identity proven by the peer's Ed25519 signature, never by its advertised name or address. */
    val verifiedPublicKey: ByteArray? get() = verifiedSigning?.copyOf()

    fun setup(body: ByteArray): ByteArray {
        clearState()
        if (body.size != 32) throw ReceiverPairingFailure()
        return identity.publicKey.copyOf()
    }

    fun verify(body: ByteArray): ByteArray {
        return try {
            verifyStep(body)
        } catch (_: Exception) {
            clearState()
            throw ReceiverPairingFailure()
        }
    }

    private fun verifyStep(body: ByteArray): ByteArray {
        require(body.size >= 4 && body.sliceArray(1..3).all { it == 0.toByte() })
        if (body[0] == 1.toByte()) {
            clearState()
            require(body.size == 68)
            peerCurve = body.copyOfRange(4, 36)
            peerSigning = body.copyOfRange(36, 68)
            val own = AirPlayCrypto.x25519Generate()
            ownCurve = own.publicKey
            val shared = AirPlayCrypto.x25519Shared(own.privateKey, peerCurve!!)
            pendingSecret = shared
            val cipher = aesCtr(
                AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), shared).copyOf(16),
                AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), shared).copyOf(16),
            )
            exchange = cipher
            val signature = AirPlayCrypto.ed25519Sign(identity.privateKey, own.publicKey + peerCurve!!)
            return own.publicKey + cipher.update(signature)
        }
        require(body[0] == 0.toByte() && body.size == 68)
        val cipher = requireNotNull(exchange)
        val signature = cipher.update(body.copyOfRange(4, 68))
        exchange = null
        require(AirPlayCrypto.ed25519Verify(requireNotNull(peerSigning), requireNotNull(peerCurve) + requireNotNull(ownCurve), signature))
        verifiedSigning = requireNotNull(peerSigning).copyOf()
        sharedSecret = requireNotNull(pendingSecret).copyOf()
        clearEphemeral()
        return ByteArray(0)
    }

    private fun clearState() {
        sharedSecret?.fill(0)
        sharedSecret = null
        verifiedSigning = null
        clearEphemeral()
    }

    private fun clearEphemeral() {
        peerCurve = null
        peerSigning = null
        ownCurve = null
        exchange = null
        pendingSecret?.fill(0)
        pendingSecret = null
    }
}

internal fun aesCtr(key: ByteArray, iv: ByteArray): Cipher = Cipher.getInstance("AES/CTR/NoPadding").apply {
    init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
}

/** Only mirroring transport keys; no FairPlay Streaming content decryption. */
object ReceiverFairPlay {
    init { System.loadLibrary("tiplay_airplay") }
    external fun reply(request: ByteArray): ByteArray?
    external fun decrypt(handshake: ByteArray, encrypted: ByteArray): ByteArray?
}
