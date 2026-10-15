package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.VideoCodec
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream

/** Real libx264/libx265 parameter sets keep the SDR check independent of its synthetic SPS writer. */
class ReceiverMirrorSdrRealVectorsTest {
    private val prefix = byteArrayOf(0, 0, 0, 1)

    @Test fun ffmpegEightBitSdrConfigurationAndInBandParameterSetsAreAccepted() {
        for (record in listOf(AVC_BASELINE_UNSPECIFIED, AVC_HIGH_BT709)) {
            ReceiverMirrorSdr.configuration(VideoCodec.H264, hex(record))
        }
        for (record in listOf(HEVC_MAIN_UNSPECIFIED, HEVC_MAIN_BT709)) {
            ReceiverMirrorSdr.configuration(VideoCodec.H265, hex(record))
        }
        // Extracted SPS NALs from those records, including emulation-prevention bytes and VUI timing.
        for (sps in listOf(
            "6742c01fd9005005bb0110000003001000000303c0f1832480",
            "6764001facd9405005bb016a02020280000003008000001e078c18cb",
        )) ReceiverMirrorSdr.frame(prefix + hex(sps), VideoCodec.H264)
        for (sps in listOf(
            "42010101600000030090000003000003005da00280802d165959a4932bc05a810100820000030002000003003c10",
            "42010101600000030090000003000003005da00280802d165959a4932bc05a808080820000030002000003003c10",
        )) ReceiverMirrorSdr.frame(prefix + hex(sps), VideoCodec.H265)
    }

    @Test fun aRealEightBitPqParameterSetIsRejectedDespiteItsOrdinaryHighProfile() {
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorSdr.configuration(VideoCodec.H264, hex(AVC_HIGH_PQ))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorSdr.frame(prefix + hex("6764001facd9405005bb016a12201280000003008000001e078c18cb"), VideoCodec.H264)
        }
    }

    @Test fun registeredProviderIdentityAloneDoesNotClassifyOrdinaryUserDataAsHdr() {
        for (codec in listOf(VideoCodec.H264, VideoCodec.H265)) {
            // Manufacturer codes identify Samsung/Dolby; only their HDR application markers are excluded.
            for (ordinary in listOf("b5003c", "b5003b", "b5003c000103010203", "b5003b000009001122", "26000400041122")) {
                ReceiverMirrorSdr.frame(sei(codec, 4 to hex(ordinary)), codec)
            }
            for (hdr in listOf("b5003c00010401", "b5003b000008001122", "260004000501")) {
                assertThrows(IllegalArgumentException::class.java) {
                    ReceiverMirrorSdr.frame(sei(codec, 4 to hex(hdr)), codec)
                }
            }
        }
    }

    @Test fun aType128MessageCannotHideLaterHdrMetadataAndOpaqueSdrUserDataIsNotScannedForMarkers() {
        for (codec in listOf(VideoCodec.H264, VideoCodec.H265)) {
            ReceiverMirrorSdr.frame(sei(codec, 128 to byteArrayOf(0x80.toByte()), 5 to ByteArray(20) { 1 }), codec)
            for (type in listOf(137, 144)) assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorSdr.frame(sei(codec, 128 to byteArrayOf(0x80.toByte()), type to byteArrayOf(1)), codec)
            }
            // A long unregistered message contains HDR-looking bytes as opaque application data.
            ReceiverMirrorSdr.frame(sei(codec, 5 to (ByteArray(300) { 0x55 } + hex("b5003c000104018900"))), codec)
            ReceiverMirrorSdr.frame(sei(codec, 5 to ByteArray(16) { 1 }) + byteArrayOf(0, 0), codec)
        }
    }

    @Test fun malformedMetadataFailsWithABoundedProtocolError() {
        for (codec in listOf(VideoCodec.H264, VideoCodec.H265)) {
            val header = if (codec == VideoCodec.H264) byteArrayOf(6) else byteArrayOf(0x4e, 1)
            for (truncated in listOf(hex("ff"), hex("04ff"), hex("0404b5003c"))) assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorSdr.frame(prefix + header + truncated, codec)
            }
        }
        // A sequence id with more than 20 leading zero bits must stop before an unbounded Exp-Golomb read.
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorSdr.frame(prefix + hex("6742001f0000000080"), VideoCodec.H264)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorSdr.frame(prefix + hex("420101016000"), VideoCodec.H265)
        }
    }

    @Test fun metadataMemoryBudgetDoesNotLimitLargePictureSlices() {
        val large = ByteArray(600 * 1024) { 0x55 }
        for (codec in listOf(VideoCodec.H264, VideoCodec.H265)) {
            val slice = if (codec == VideoCodec.H264) byteArrayOf(0x65) else byteArrayOf(0x26, 1)
            ReceiverMirrorSdr.frame(prefix + slice + large, codec)
            // A structurally valid opaque SEI must fail the metadata budget before copying/unescaping it.
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorSdr.frame(sei(codec, 5 to large), codec)
            }
        }
    }

    private fun sei(codec: VideoCodec, vararg messages: Pair<Int, ByteArray>): ByteArray {
        val rbsp = ByteArrayOutputStream()
        fun extended(value: Int) {
            repeat(value / 255) { rbsp.write(255) }
            rbsp.write(value % 255)
        }
        for ((type, bytes) in messages) { extended(type); extended(bytes.size); rbsp.write(bytes) }
        rbsp.write(0x80)
        val escaped = ByteArrayOutputStream()
        var zeros = 0
        for (byte in rbsp.toByteArray()) {
            val value = byte.toInt() and 255
            if (zeros >= 2 && value <= 3) { escaped.write(3); zeros = 0 }
            escaped.write(value)
            zeros = if (value == 0) zeros + 1 else 0
        }
        val header = if (codec == VideoCodec.H264) byteArrayOf(6) else byteArrayOf(0x4e, 1)
        return prefix + header + escaped.toByteArray()
    }

    private fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    companion object {
        // FFmpeg 7.1.5: colour=black 1280x720/30, yuv420p, one frame; libx264 baseline/high and libx265 Main.
        // AVC BT709/PQ variants set per-frame colour metadata; HEVC BT709 sets x265 colour parameters.
        // These values were checked with trace_headers; output-container colour flags alone do not set the SPS.
        // hvcC retains the generated VPS/SPS/PPS arrays and omits only the encoder-info SEI array.
        private const val AVC_BASELINE_UNSPECIFIED = "0142c01fffe100196742c01fd9005005bb0110000003001000000303c0f183248001000568cb83cb20"
        private const val AVC_HIGH_BT709 = "0164001fffe1001c6764001facd9405005bb016a02020280000003008000001e078c18cb01000668ebe3cb22c0fdf8f800"
        private const val AVC_HIGH_PQ = "0164001fffe1001c6764001facd9405005bb016a12201280000003008000001e078c18cb01000668ebe3cb22c0fdf8f800"
        private const val HEVC_MAIN_UNSPECIFIED = "0101600000009000000000005df000fcfdf8f800000f03200001001840010c01ffff01600000030090000003000003005d959809210001002e42010101600000030090000003000003005da00280802d165959a4932bc05a810100820000030002000003003c1022000100074401c172b42240"
        private const val HEVC_MAIN_BT709 = "0101600000009000000000005df000fcfdf8f800000f03200001001840010c01ffff01600000030090000003000003005d959809210001002e42010101600000030090000003000003005da00280802d165959a4932bc05a808080820000030002000003003c1022000100074401c172b42240"
    }
}
