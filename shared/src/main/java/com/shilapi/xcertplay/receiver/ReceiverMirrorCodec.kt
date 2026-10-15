package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.ScreenCodec
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.web.WebVideoCodecs

/** Ordinary mirror configuration, including UxPlay's hvc1 sample-entry envelope. */
internal object ReceiverMirrorCodec {
    private val START_CODE = byteArrayOf(0, 0, 0, 1)

    data class Config(val codec: VideoCodec, val record: ByteArray, val lengthBytes: Int)

    fun config(payload: ByteArray, hevcEnabled: Boolean): Config {
        val hevcEntry = payload.size >= 8 && payload.copyOfRange(4, 8).contentEquals("hvc1".toByteArray())
        val described = ScreenCodec.describeConfig(payload)
        val codec = if (hevcEntry) VideoCodec.H265 else described.codec
        val record = if (hevcEntry) {
            var box = 86
            while (box + 8 <= payload.size) {
                val boxSize = unsignedLength(payload, box, 4)
                require(boxSize >= 8 && boxSize <= payload.size - box)
                val kind = payload.copyOfRange(box + 4, box + 8).toString(Charsets.US_ASCII)
                require(kind !in setOf("dvcC", "dvvC", "dvwC")) { "Dolby Vision configuration is not SDR" }
                if (kind == "colr") {
                    require(boxSize >= 12) { "truncated colour metadata" }
                    val colourType = payload.copyOfRange(box + 8, box + 12).toString(Charsets.US_ASCII)
                    if (colourType in setOf("nclx", "nclc")) {
                        require(boxSize >= if (colourType == "nclx") 19 else 18)
                        val transfer = ((payload[box + 14].toInt() and 255) shl 8) or (payload[box + 15].toInt() and 255)
                        require(transfer != 16 && transfer != 18) { "HDR sample-entry colour transfer is not accepted" }
                    }
                }
                box += boxSize
            }
            require(box == payload.size)
            // An ISO visual sample entry has 78 bytes after its 8-byte box header. The next box is
            // hvcC; its 23-byte header ends at 0x75, where the pinned UxPlay reads its NAL arrays.
            require(payload.size >= 94 + 23)
            require(payload.copyOfRange(90, 94).contentEquals("hvcC".toByteArray()))
            val size = unsignedLength(payload, 86, 4)
            require(size >= 31 && size <= payload.size - 86)
            payload.copyOfRange(94, 86 + size)
        } else described.record
        require(codec != VideoCodec.H265 || hevcEnabled) { "HEVC not offered" }
        require(WebVideoCodecs.codecString(codec, record) != null) { "Invalid mirror configuration" }
        ReceiverMirrorSdr.configuration(codec, record)
        val lengthBytes = requireNotNull(ScreenCodec.nalLengthBytes(codec, record))
        return Config(codec, record, lengthBytes)
    }

    fun requireSdrFrame(annexB: ByteArray, codec: VideoCodec) = ReceiverMirrorSdr.frame(annexB, codec)

    fun annexB(payload: ByteArray, lengthBytes: Int): ByteArray {
        require(lengthBytes in 1..4)
        val output = java.io.ByteArrayOutputStream(payload.size)
        var cursor = 0
        while (cursor < payload.size) {
            require(payload.size - cursor >= lengthBytes)
            val size = unsignedLength(payload, cursor, lengthBytes)
            cursor += lengthBytes
            require(size > 0 && size <= payload.size - cursor)
            require(output.size() <= 8 * 1024 * 1024 - size - 4)
            output.write(START_CODE)
            output.write(payload, cursor, size)
            cursor += size
        }
        return output.toByteArray()
    }

    fun suspended(flag: Int, current: Boolean): Boolean = when (flag) {
        0x56, 0x5e -> true
        0x16, 0x1e -> false
        else -> current
    }

    private fun unsignedLength(data: ByteArray, offset: Int, size: Int): Int {
        var value = 0L
        for (index in offset until offset + size) value = (value shl 8) or (data[index].toLong() and 255)
        require(value <= Int.MAX_VALUE)
        return value.toInt()
    }
}
