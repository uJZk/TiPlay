package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.Srp6a
import com.shilapi.xcertplay.airplay.Srp6aSession
import com.shilapi.xcertplay.airplay.Tlv8Codec
import com.shilapi.xcertplay.airplay.Tlv8Item
import java.io.Closeable

/**
 * AirPlay 2 transient HAP pairing. This proves possession of the current SRP secret,
 * not a persistent device identity: browser authorization must remain connection-scoped.
 * Protocol comparison: Shairport Sync b991d913, pair_ap/pair_homekit.c.
 */
internal class ReceiverAirPlay2Pairing : Closeable {
    private var srp: Srp6aSession? = null
    private var secret: ByteArray? = null
    private var controlTaken = false
    private var eventTaken = false
    private var failed = false

    val complete: Boolean get() = secret != null && !failed

    /** M4 is still plaintext. Install [takeControlCipher] only after writing its response. */
    fun handle(body: ByteArray): ByteArray {
        var responseState = 2
        return try {
            require(!failed && !complete && body.size in 1..1024)
            val fields = strictTlv(body)
            val state = fields[6]?.singleOrNull()?.toInt()
            responseState = if (state == 3) 4 else 2
            when (state) {
                1 -> {
                    require(srp == null)
                    require(fields[0]?.contentEquals(byteArrayOf(0)) == true)
                    require(fields[19]?.contentEquals(byteArrayOf(0x10)) == true)
                    val session = Srp6a.start("Pair-Setup", "3939")
                    srp = session
                    Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(2)),
                        Tlv8Item(2, session.salt), Tlv8Item(3, session.publicKey)))
                }
                3 -> {
                    val session = requireNotNull(srp)
                    val publicKey = requireNotNull(fields[3])
                    val proof = requireNotNull(fields[4])
                    require(publicKey.size in 1..384 && proof.size == 64)
                    val result = session.verify(publicKey, proof)
                    require(result.ok)
                    secret = requireNotNull(result.sessionKey).copyOf()
                    srp = null
                    Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(4)),
                        Tlv8Item(4, requireNotNull(result.serverProof))))
                }
                else -> error("unexpected pairing state")
            }
        } catch (_: Exception) {
            close()
            Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(responseState.toByte())),
                Tlv8Item(7, byteArrayOf(2))))
        }
    }

    fun takeControlCipher(): ReceiverAirPlay2Cipher? {
        val shared = secret ?: return null
        if (failed || controlTaken) return null
        controlTaken = true
        return cipher(shared, "Control", "Write", "Read")
    }

    /** Each event connection needs its own key epoch; never reset counters on a reconnect. */
    fun takeEventCipher(): ReceiverAirPlay2Cipher? {
        val shared = secret ?: return null
        if (failed || eventTaken) return null
        eventTaken = true
        return cipher(shared, "Events", "Read", "Write")
    }

    override fun close() {
        secret?.fill(0)
        secret = null
        srp = null
        failed = true
    }

    private fun cipher(shared: ByteArray, channel: String, read: String, write: String) =
        ReceiverAirPlay2Cipher(
            AirPlayCrypto.hkdfSha512(shared, "$channel-Salt".toByteArray(), "$channel-$read-Encryption-Key".toByteArray()),
            AirPlayCrypto.hkdfSha512(shared, "$channel-Salt".toByteArray(), "$channel-$write-Encryption-Key".toByteArray()),
        )

    /** Reject truncated fields and duplicate scalar fields instead of accepting their prefix. */
    private fun strictTlv(body: ByteArray): Map<Int, ByteArray> {
        val fields = linkedMapOf<Int, ByteArray>()
        var offset = 0
        var lastType = -1
        var lastLength = 0
        while (offset < body.size) {
            require(offset + 2 <= body.size)
            val type = body[offset].toInt() and 255
            val length = body[offset + 1].toInt() and 255
            offset += 2
            require(length > 0 && offset + length <= body.size)
            val part = body.copyOfRange(offset, offset + length)
            val old = fields[type]
            if (old != null) {
                require(lastType == type && lastLength == 255)
                fields[type] = old + part
            } else fields[type] = part
            offset += length
            lastType = type
            lastLength = length
        }
        return fields
    }
}
