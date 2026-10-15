package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.VideoCodec

/** SDR acceptance boundary, not a sender negotiation flag or an HDR tone mapper. */
internal object ReceiverMirrorSdr {
    fun configuration(codec: VideoCodec, record: ByteArray) {
        var found = false
        if (codec == VideoCodec.H264) {
            require(record.size >= 7 && (record[1].toInt() and 255) in AVC_PROFILES) { "unsupported SDR AVC profile" }
            var cursor = 6
            repeat(record[5].toInt() and 31) {
                val size = length(record, cursor); cursor += 2
                require(size > 0 && size <= record.size - cursor)
                avcSps(record.copyOfRange(cursor, cursor + size)); found = true; cursor += size
            }
        } else {
            require(record.size >= 23 && record[1].toInt() and 31 == 1 &&
                record[17].toInt() and 7 == 0 && record[18].toInt() and 7 == 0) { "only 8-bit HEVC Main is accepted" }
            var cursor = 23
            repeat(record[22].toInt() and 255) {
                require(cursor + 3 <= record.size)
                val type = record[cursor++].toInt() and 63
                val count = length(record, cursor); cursor += 2
                repeat(count) {
                    val size = length(record, cursor); cursor += 2
                    require(size >= 2 && size <= record.size - cursor)
                    val nal = record.copyOfRange(cursor, cursor + size)
                    if (type == 33) { hevcSps(nal); found = true }
                    else inspect(nal, codec)
                    cursor += size
                }
            }
        }
        require(found) { "missing SDR sequence parameter set" }
    }

    fun frame(annexB: ByteArray, codec: VideoCodec) {
        var start = -1
        var cursor = 0
        while (cursor + 3 <= annexB.size) {
            val prefix = when {
                annexB[cursor] != 0.toByte() || annexB[cursor + 1] != 0.toByte() -> 0
                annexB[cursor + 2] == 1.toByte() -> 3
                cursor + 4 <= annexB.size && annexB[cursor + 2] == 0.toByte() && annexB[cursor + 3] == 1.toByte() -> 4
                else -> 0
            }
            if (prefix == 0) { cursor++; continue }
            if (start >= 0) inspectFrameNal(annexB, start, cursor, codec)
            cursor += prefix; start = cursor
        }
        if (start >= 0) inspectFrameNal(annexB, start, annexB.size, codec)
    }

    private fun inspectFrameNal(bytes: ByteArray, start: Int, end: Int, codec: VideoCodec) {
        require(end > start)
        val type = if (codec == VideoCodec.H264) bytes[start].toInt() and 31 else bytes[start].toInt() ushr 1 and 63
        val metadata = if (codec == VideoCodec.H264) type == 6 || type == 7 else type in HEVC_METADATA_TYPES
        // Large VCL picture slices need no allocation; only small parameter sets/SEI are parsed.
        if (metadata) {
            require(end - start <= MAX_METADATA_NAL_BYTES) { "oversized SDR metadata NAL" }
            inspect(bytes.copyOfRange(start, end), codec)
        }
    }

    private fun inspect(nal: ByteArray, codec: VideoCodec) {
        require(nal.isNotEmpty())
        if (codec == VideoCodec.H264) when (nal[0].toInt() and 31) {
            7 -> avcSps(nal)
            6 -> sei(rbsp(nal, 1))
        } else {
            require(nal.size >= 2)
            when (nal[0].toInt() ushr 1 and 63) {
                33 -> hevcSps(nal)
                39, 40 -> sei(rbsp(nal, 2))
                62, 63 -> throw IllegalArgumentException("unsupported enhancement NAL in SDR stream")
            }
        }
    }

    private fun avcSps(nal: ByteArray) {
        require(nal.size >= 5 && nal[0].toInt() and 0x80 == 0 && nal[0].toInt() and 31 == 7)
        val bits = Bits(rbsp(nal, 1))
        val profile = bits.read(8)
        require(profile in AVC_PROFILES) { "unsupported SDR AVC profile" }
        bits.skip(16); require(bits.ue() <= 31)
        if (profile == 100) {
            require(bits.ue() == 1) { "only 4:2:0 SDR is accepted" }
            require(bits.ue() == 0 && bits.ue() == 0) { "only 8-bit AVC is accepted" }
            bits.skip(1)
            if (bits.flag()) repeat(8) { index ->
                if (bits.flag()) {
                    var last = 8; var next = 8
                    repeat(if (index < 6) 16 else 64) {
                        if (next != 0) next = (last + bits.se() + 256) and 255
                        if (next != 0) last = next
                    }
                }
            }
        }
        require(bits.ue() <= 12)
        when (bits.ue()) {
            0 -> require(bits.ue() <= 12)
            1 -> { bits.skip(1); bits.se(); bits.se(); repeat(bits.ue().also { require(it <= 255) }) { bits.se() } }
            2 -> Unit
            else -> error("invalid AVC picture order")
        }
        require(bits.ue() <= 32); bits.skip(1)
        require(bits.ue() <= 511 && bits.ue() <= 511)
        if (!bits.flag()) bits.skip(1)
        bits.skip(1)
        if (bits.flag()) repeat(4) { bits.ue() }
        if (bits.flag()) vui(bits)
    }

    private fun hevcSps(nal: ByteArray) {
        require(nal.size >= 3 && nal[0].toInt() and 0x80 == 0 && nal[0].toInt() ushr 1 and 63 == 33 && nal[1].toInt() and 7 != 0)
        val bits = Bits(rbsp(nal, 2))
        bits.skip(4); val layers = bits.read(3); require(layers <= 6); bits.skip(1)
        bits.skip(3); require(bits.read(5) == 1) { "only HEVC Main is accepted" }
        bits.skip(88)
        val profiles = BooleanArray(layers); val levels = BooleanArray(layers)
        repeat(layers) { profiles[it] = bits.flag(); levels[it] = bits.flag() }
        if (layers > 0) bits.skip((8 - layers) * 2)
        repeat(layers) { if (profiles[it]) bits.skip(88); if (levels[it]) bits.skip(8) }
        require(bits.ue() <= 15); require(bits.ue() == 1) { "only 4:2:0 SDR is accepted" }
        require(bits.ue() in 1..8192 && bits.ue() in 1..8192)
        if (bits.flag()) repeat(4) { bits.ue() }
        require(bits.ue() == 0 && bits.ue() == 0) { "only 8-bit HEVC is accepted" }
        val pocBits = bits.ue() + 4; require(pocBits <= 16)
        val orderingStart = if (bits.flag()) 0 else layers
        for (layer in orderingStart..layers) repeat(3) { bits.ue() }
        repeat(6) { bits.ue() }
        if (bits.flag() && bits.flag()) {
            for (sizeId in 0..3) {
                val matrices = if (sizeId == 3) 2 else 6
                repeat(matrices) {
                    if (!bits.flag()) bits.ue()
                    else {
                        if (sizeId > 1) bits.se()
                        repeat(minOf(64, 1 shl (4 + 2 * sizeId))) { bits.se() }
                    }
                }
            }
        }
        bits.skip(2)
        if (bits.flag()) { bits.skip(8); bits.ue(); bits.ue(); bits.skip(1) }
        val shortSets = bits.ue(); require(shortSets <= 64)
        val counts = IntArray(shortSets)
        repeat(shortSets) { index ->
            if (index != 0 && bits.flag()) {
                bits.skip(1); bits.ue()
                var count = 0
                repeat(counts[index - 1] + 1) {
                    val used = bits.flag()
                    if (used || bits.flag()) count++
                }
                counts[index] = count
            } else {
                val negatives = bits.ue(); val positives = bits.ue(); require(negatives + positives <= 64)
                repeat(negatives + positives) { bits.ue(); bits.skip(1) }
                counts[index] = negatives + positives
            }
        }
        if (bits.flag()) repeat(bits.ue().also { require(it <= 32) }) { bits.skip(pocBits + 1) }
        bits.skip(2)
        if (bits.flag()) vui(bits)
    }

    /** AVC and HEVC VUI share this prefix through colour_description_present_flag. */
    private fun vui(bits: Bits) {
        if (bits.flag() && bits.read(8) == 255) bits.skip(32)
        if (bits.flag()) bits.skip(1)
        if (bits.flag()) {
            bits.skip(4)
            if (bits.flag()) {
                val primaries = bits.read(8); val transfer = bits.read(8); bits.read(8)
                // SDR transfer functions: BT.709, unspecified, gamma2.2/2.8, SMPTE170M/240M,
                // linear, IEC61966-2-4, BT1361, sRGB, BT2020 10/12-bit. PQ/HLG are excluded.
                require(transfer in SDR_TRANSFERS) { "HDR transfer is not accepted" }
                require(primaries in 1..12 || primaries == 22) { "unsupported colour primaries" }
            }
        }
    }

    private fun sei(bytes: ByteArray) {
        var cursor = 0
        while (cursor < bytes.size) {
            // Payload type 128 is valid. Only a final stop bit plus zero padding ends the RBSP.
            if (bytes[cursor] == 0x80.toByte() && (cursor + 1 until bytes.size).all { bytes[it] == 0.toByte() }) break
            var type = 0; var size = 0; var value: Int
            do { require(cursor < bytes.size); value = bytes[cursor++].toInt() and 255; type += value } while (value == 255)
            do { require(cursor < bytes.size); value = bytes[cursor++].toInt() and 255; size += value } while (value == 255)
            require(size <= bytes.size - cursor)
            require(type != 137 && type != 144) { "HDR mastering metadata is not accepted" }
            if (type == 4 && size >= 3) {
                val country = bytes[cursor].toInt() and 255
                val provider = ((bytes[cursor + 1].toInt() and 255) shl 8) or (bytes[cursor + 2].toInt() and 255)
                val dolby = country == 0xb5 && provider == 0x003b && size >= 7 &&
                    bytes[cursor + 3] == 0.toByte() && bytes[cursor + 4] == 0.toByte() &&
                    bytes[cursor + 5] == 8.toByte() && bytes[cursor + 6] == 0.toByte()
                val hdr10Plus = country == 0xb5 && provider == 0x003c && size >= 6 &&
                    bytes[cursor + 3] == 0.toByte() && bytes[cursor + 4] == 1.toByte() && bytes[cursor + 5] == 4.toByte()
                val hdrVivid = country == 0x26 && provider == 0x0004 && size >= 5 &&
                    bytes[cursor + 3] == 0.toByte() && bytes[cursor + 4] == 5.toByte()
                require(!dolby && !hdr10Plus && !hdrVivid) { "HDR dynamic metadata is not accepted" }
            }
            cursor += size
        }
    }

    private fun rbsp(nal: ByteArray, offset: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(nal.size)
        var zeros = 0
        for (index in offset until nal.size) {
            val value = nal[index].toInt() and 255
            if (zeros >= 2 && value == 3) { zeros = 0; continue }
            out.write(value); zeros = if (value == 0) zeros + 1 else 0
        }
        return out.toByteArray()
    }

    private fun length(bytes: ByteArray, offset: Int): Int {
        require(offset + 2 <= bytes.size)
        return ((bytes[offset].toInt() and 255) shl 8) or (bytes[offset + 1].toInt() and 255)
    }

    private class Bits(private val bytes: ByteArray) {
        private var cursor = 0
        fun read(count: Int): Int {
            require(count in 0..24 && cursor + count <= bytes.size * 8) { "truncated SDR sequence parameter set" }
            var result = 0
            repeat(count) { result = (result shl 1) or ((bytes[cursor / 8].toInt() ushr (7 - cursor % 8)) and 1); cursor++ }
            return result
        }
        fun skip(count: Int) { require(count >= 0 && cursor + count <= bytes.size * 8); cursor += count }
        fun flag(): Boolean = read(1) != 0
        fun ue(): Int {
            var zeros = 0
            while (!flag()) { zeros++; require(zeros <= 20) { "invalid SPS Exp-Golomb value" } }
            return ((1 shl zeros) - 1) + read(zeros)
        }
        fun se(): Int = ue().let { if (it and 1 == 0) -(it / 2) else (it + 1) / 2 }
    }

    private const val MAX_METADATA_NAL_BYTES = 512 * 1024
    private val AVC_PROFILES = setOf(66, 77, 88, 100)
    private val HEVC_METADATA_TYPES = setOf(33, 39, 40, 62, 63)
    private val SDR_TRANSFERS = setOf(1, 2, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15)
}
