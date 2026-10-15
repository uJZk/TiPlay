package com.shilapi.xcertplay.receiver

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/** Small complete SPS records, with escaped RBSP, for protocol tests that inspect colour metadata. */
internal object ReceiverSdrFixtures {
    private class Writer {
        private val bits = mutableListOf<Int>()
        fun put(value: Long, count: Int) { for (bit in count - 1 downTo 0) bits += ((value ushr bit) and 1).toInt() }
        fun flag(value: Boolean) = put(if (value) 1 else 0, 1)
        fun ue(value: Int) {
            val code = value + 1
            val length = 32 - Integer.numberOfLeadingZeros(code)
            put(0, length - 1); put(code.toLong(), length)
        }
        fun bytes(): ByteArray {
            put(1, 1)
            while (bits.size % 8 != 0) put(0, 1)
            val raw = ByteArray(bits.size / 8) { byte ->
                (0..7).fold(0) { value, bit -> (value shl 1) or bits[byte * 8 + bit] }.toByte()
            }
            val escaped = ByteArrayOutputStream()
            var zeros = 0
            for (item in raw) {
                val value = item.toInt() and 255
                if (zeros >= 2 && value <= 3) { escaped.write(3); zeros = 0 }
                escaped.write(value); zeros = if (value == 0) zeros + 1 else 0
            }
            return escaped.toByteArray()
        }
    }

    private fun Writer.colour(transfer: Int) {
        flag(false); flag(false); flag(true)
        put(5, 3); flag(false); flag(true)
        put(1, 8); put(transfer.toLong(), 8); put(1, 8)
    }

    fun avcSps(transfer: Int = 1, profile: Int = 66, depth: Int = 8): ByteArray {
        val bits = Writer()
        bits.put(profile.toLong(), 8); bits.put(0, 8); bits.put(31, 8); bits.ue(0)
        if (profile in setOf(100, 110)) {
            bits.ue(1); bits.ue(depth - 8); bits.ue(depth - 8); bits.flag(false); bits.flag(false)
        }
        bits.ue(0); bits.ue(0); bits.ue(0); bits.ue(1); bits.flag(false)
        bits.ue(44); bits.ue(79); bits.flag(true); bits.flag(true); bits.flag(false); bits.flag(true)
        bits.colour(transfer)
        repeat(6) { bits.flag(false) }
        return byteArrayOf(0x67) + bits.bytes()
    }

    fun avcc(transfer: Int = 1, profile: Int = 66, depth: Int = 8): ByteArray {
        val sps = avcSps(transfer, profile, depth)
        val pps = byteArrayOf(0x68, 0xce.toByte(), 0x38, 0x80.toByte())
        return ByteBuffer.allocate(11 + sps.size + pps.size).put(1).put(profile.toByte()).put(0).put(31)
            .put(0xff.toByte()).put(0xe1.toByte()).putShort(sps.size.toShort()).put(sps)
            .put(1).putShort(pps.size.toShort()).put(pps).array()
    }

    fun hevcSps(transfer: Int = 1, depth: Int = 8): ByteArray {
        val bits = Writer()
        bits.put(0, 4); bits.put(0, 3); bits.flag(true)
        bits.put(1, 8); bits.put(0x60000000, 32); bits.put(0xb00000000000, 48); bits.put(120, 8)
        bits.ue(0); bits.ue(1); bits.ue(720); bits.ue(1280); bits.flag(false)
        bits.ue(depth - 8); bits.ue(depth - 8); bits.ue(0)
        bits.flag(false); bits.ue(1); bits.ue(0); bits.ue(0)
        for (value in listOf(0, 3, 0, 3, 0, 0)) bits.ue(value)
        bits.flag(false); bits.flag(false); bits.flag(true); bits.flag(false)
        bits.ue(0); bits.flag(false); bits.flag(true); bits.flag(true); bits.flag(true)
        bits.colour(transfer)
        repeat(7) { bits.flag(false) }
        bits.flag(false)
        return byteArrayOf(0x42, 1) + bits.bytes()
    }

    fun hvcc(transfer: Int = 1, profile: Int = 1, depth: Int = 8): ByteArray {
        val header = byteArrayOf(1, profile.toByte(), 0x60, 0, 0, 0, 0xb0.toByte(), 0, 0, 0, 0, 0, 120,
            0xf0.toByte(), 0, 0xfc.toByte(), 0xfd.toByte(), (0xf8 + depth - 8).toByte(),
            (0xf8 + depth - 8).toByte(), 0, 0, 0x0f, 3)
        val out = ByteArrayOutputStream(); out.write(header)
        for ((type, nal) in listOf(32 to byteArrayOf(0x40, 1), 33 to hevcSps(transfer, depth), 34 to byteArrayOf(0x44, 1))) {
            out.write(0x80 or type); out.write(0); out.write(1)
            out.write(nal.size ushr 8); out.write(nal.size and 255); out.write(nal)
        }
        return out.toByteArray()
    }
}
