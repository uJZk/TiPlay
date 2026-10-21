package com.shilapi.xcertplay.receiver

import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Legacy mirror RTP uses per-packet AES-CBC, with its final partial block left clear (UxPlay raop_buffer).
 * Codec NoData units still occupy source time; only the browser decoder interprets their payload. */
internal object ReceiverMirrorAudioPacket {
    fun decrypt(packet: ByteArray, key: ByteArray, iv: ByteArray): ByteArray? {
        if (key.size != 16 || iv.size != 16 || packet.size < 12 ||
            packet[0].toInt() and 0xc0 != 0x80 || packet[1].toInt() and 0x7f != 0x60) return null
        var offset = 12 + (packet[0].toInt() and 0x0f) * 4
        if (offset > packet.size) return null
        if (packet[0].toInt() and 0x10 != 0) {
            if (offset + 4 > packet.size) return null
            val words = ((packet[offset + 2].toInt() and 0xff) shl 8) or (packet[offset + 3].toInt() and 0xff)
            offset += 4 + words * 4
            if (offset > packet.size) return null
        }
        val bytes = packet.size - offset
        if (bytes <= 0) return null
        val blocks = bytes / 16 * 16
        val output = packet.copyOfRange(offset, packet.size)
        if (blocks > 0) {
            val cipher = Cipher.getInstance("AES/CBC/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
            cipher.doFinal(packet, offset, blocks).copyInto(output)
        }
        if (packet[0].toInt() and 0x20 != 0) {
            val padding = output.last().toInt() and 0xff
            if (padding !in 1..output.size) return null
            return output.copyOf(output.size - padding)
        }
        return output
    }
}
