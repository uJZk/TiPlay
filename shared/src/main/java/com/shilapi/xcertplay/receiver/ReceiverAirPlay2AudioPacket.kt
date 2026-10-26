package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto

/** AirPlay 2 realtime RTP: header, ChaCha20-Poly1305 payload/tag, eight-byte nonce. */
internal object ReceiverAirPlay2AudioPacket {
    fun decrypt(packet: ByteArray, key: ByteArray): ByteArray? {
        // This transport has a fixed RTP header. Do not interpret extension/CSRC bytes as ciphertext.
        if (key.size != 32 || packet.size < 12 + 16 + 8 || packet.size > 65535 ||
            packet[0].toInt() and 255 != 0x80 || packet[1].toInt() and 0x7f != 0x60) return null
        val tail = packet.size - 8
        val nonce = ByteArray(12).also { packet.copyInto(it, 4, tail, packet.size) }
        return try {
            AirPlayCrypto.chachaOpen(key, nonce, packet.copyOfRange(12, tail), packet.copyOfRange(4, 12))
        } catch (_: Exception) { null }
    }
}
