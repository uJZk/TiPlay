package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class ReceiverMirrorAudioPacketTest {
    private val key = ByteArray(16) { it.toByte() }
    private val iv = ByteArray(16) { (it + 20).toByte() }

    private fun packet(payload: ByteArray, header: ByteArray = ByteArray(12).apply { this[0] = 0x80.toByte(); this[1] = 0x60 }): ByteArray {
        val length = payload.size / 16 * 16
        val cipher = Cipher.getInstance("AES/CBC/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        return header + cipher.doFinal(payload.copyOf(length)) + payload.copyOfRange(length, payload.size)
    }

    @Test fun independentPacketsResetIvAndRetainClearPartialBlocks() {
        val clear = ByteArray(35) { (it + 2).toByte() }
        val encrypted = packet(clear)
        repeat(2) { assertArrayEquals(clear, ReceiverMirrorAudioPacket.decrypt(encrypted, key, iv)) }
        assertNull(ReceiverMirrorAudioPacket.decrypt(encrypted.copyOf(5), key, iv))
        assertNull(ReceiverMirrorAudioPacket.decrypt(encrypted.copyOf().apply { this[1] = 0x55 }, key, iv))
    }

    @Test fun csrcAndExtensionHeadersAreExcludedAndPaddingValidated() {
        val header = ByteArray(24).apply {
            this[0] = 0xb1.toByte(); this[1] = 0x60; this[19] = 1 // one CSRC and one extension word
        }
        val clear = ByteArray(20) { it.toByte() }.apply { this[19] = 2 }
        assertArrayEquals(clear.copyOf(18), ReceiverMirrorAudioPacket.decrypt(packet(clear, header), key, iv))
        val bad = clear.copyOf().apply { this[19] = 30 }
        assertNull(ReceiverMirrorAudioPacket.decrypt(packet(bad, header), key, iv))
    }

    @Test fun noDataAacMarkerIsDiscardedIncludingRtpPadding() {
        assertNull(ReceiverMirrorAudioPacket.decrypt(packet(byteArrayOf(0, 0x68, 0x34, 0)), key, iv))
        assertArrayEquals(byteArrayOf(0, 0x68, 0x34, 0), ReceiverMirrorAudioPacket.decrypt(
            packet(byteArrayOf(0, 0x68, 0x34, 0)), key, iv, filterNoData = false))
        val header = ByteArray(12).apply { this[0] = 0xa0.toByte(); this[1] = 0x60 }
        assertNull(ReceiverMirrorAudioPacket.decrypt(packet(byteArrayOf(0, 0x68, 0x34, 0, 1), header), key, iv))
    }

    @Test fun negotiatedCodecsAreNeverTreatedAsAacEld() {
        assertEquals(2, ReceiverMirrorAudioFormat.parse(mapOf("ct" to 2))?.codec)
        assertNull(ReceiverMirrorAudioFormat.parse(emptyMap<String, Any>()))
        assertEquals(ReceiverMirrorAudioFormat(8, 44100, 2), ReceiverMirrorAudioFormat.parse(mapOf("ct" to 8)))
    }
}
