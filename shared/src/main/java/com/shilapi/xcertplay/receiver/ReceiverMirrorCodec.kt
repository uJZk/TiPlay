package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.ScreenCodec
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.web.WebVideoCodecs

/** Ordinary mirror configuration, including UxPlay's hvc1 sample-entry envelope. */
internal object ReceiverMirrorCodec {
    private val START_CODE = byteArrayOf(0, 0, 0, 1)

    data class Config(val codec: VideoCodec, val record: ByteArray, val lengthBytes: Int,
                      val sampleEntryBytes: Int? = null, val paddingBytes: Int = 0)

    enum class Reason {
        SAMPLE_ENTRY_SIZE, TRUNCATED_BOX_HEADER, INVALID_BOX_SIZE, INVALID_PADDING,
        MISSING_HEVC_RECORD, DOLBY_VISION, TRUNCATED_COLOUR, HDR_COLOUR,
        HEVC_NOT_OFFERED, INVALID_CODEC_RECORD, SDR_REJECTED, INVALID_GEOMETRY,
    }
    class ConfigurationException(val reason: Reason, val offset: Int? = null, val boxBytes: Int? = null) :
        IllegalArgumentException(reason.name)

    fun config(payload: ByteArray, hevcEnabled: Boolean): Config {
        val hevcEntry = payload.size >= 8 && payload.copyOfRange(4, 8).contentEquals("hvc1".toByteArray())
        val described = ScreenCodec.describeConfig(payload)
        val codec = if (hevcEntry) VideoCodec.H265 else described.codec
        var paddingBytes = 0
        val record = if (hevcEntry) {
            checkConfig(payload.size >= 117 && unsignedLength(payload, 0, 4) == payload.size, Reason.SAMPLE_ENTRY_SIZE)
            var box = 86
            while (box < payload.size) {
                val remaining = payload.size - box
                // Some senders align the complete hvc1 entry with one final zero word, after
                // its validated child boxes. Never trim arbitrary bytes from a codec record.
                if (remaining == 4) {
                    checkConfig(payload.copyOfRange(box, payload.size).all { it == 0.toByte() }, Reason.INVALID_PADDING, box)
                    paddingBytes = 4
                    box += 4
                    break
                }
                checkConfig(remaining >= 8, Reason.TRUNCATED_BOX_HEADER, box)
                val boxSize = unsignedLength(payload, box, 4)
                checkConfig(boxSize >= 8 && boxSize <= remaining, Reason.INVALID_BOX_SIZE, box, boxSize)
                val kind = payload.copyOfRange(box + 4, box + 8).toString(Charsets.US_ASCII)
                checkConfig(kind !in setOf("dvcC", "dvvC", "dvwC"), Reason.DOLBY_VISION, box, boxSize)
                if (kind == "colr") {
                    checkConfig(boxSize >= 12, Reason.TRUNCATED_COLOUR, box, boxSize)
                    val colourType = payload.copyOfRange(box + 8, box + 12).toString(Charsets.US_ASCII)
                    if (colourType in setOf("nclx", "nclc")) {
                        checkConfig(boxSize >= if (colourType == "nclx") 19 else 18, Reason.TRUNCATED_COLOUR, box, boxSize)
                        val transfer = ((payload[box + 14].toInt() and 255) shl 8) or (payload[box + 15].toInt() and 255)
                        checkConfig(transfer != 16 && transfer != 18, Reason.HDR_COLOUR, box, boxSize)
                    }
                }
                box += boxSize
            }
            checkConfig(box == payload.size, Reason.INVALID_PADDING, box)
            // An ISO visual sample entry has 78 bytes after its 8-byte box header. The next box is
            // hvcC; its 23-byte header ends at 0x75, where the pinned UxPlay reads its NAL arrays.
            checkConfig(payload.copyOfRange(90, 94).contentEquals("hvcC".toByteArray()), Reason.MISSING_HEVC_RECORD, 86)
            val size = unsignedLength(payload, 86, 4)
            checkConfig(size >= 31 && size <= payload.size - 86 - paddingBytes, Reason.INVALID_BOX_SIZE, 86, size)
            payload.copyOfRange(94, 86 + size)
        } else described.record
        checkConfig(codec != VideoCodec.H265 || hevcEnabled, Reason.HEVC_NOT_OFFERED)
        checkConfig(WebVideoCodecs.codecString(codec, record) != null, Reason.INVALID_CODEC_RECORD)
        try { ReceiverMirrorSdr.configuration(codec, record) }
        catch (_: IllegalArgumentException) { throw ConfigurationException(Reason.SDR_REJECTED) }
        val lengthBytes = ScreenCodec.nalLengthBytes(codec, record)
            ?: throw ConfigurationException(Reason.INVALID_CODEC_RECORD)
        return Config(codec, record, lengthBytes, payload.size.takeIf { hevcEntry }, paddingBytes)
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
        if (value > Int.MAX_VALUE) throw ConfigurationException(Reason.INVALID_BOX_SIZE, offset)
        return value.toInt()
    }

    private fun checkConfig(valid: Boolean, reason: Reason, offset: Int? = null, bytes: Int? = null) {
        if (!valid) throw ConfigurationException(reason, offset, bytes)
    }
}
