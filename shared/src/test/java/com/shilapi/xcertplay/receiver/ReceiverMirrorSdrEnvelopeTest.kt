package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.VideoCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.ByteBuffer

/** ISO sample-entry colour declarations supplement SPS/VUI; they cannot disappear during record extraction. */
class ReceiverMirrorSdrEnvelopeTest {
    @Test fun nclcAndNclxHdrDeclarationsAreRejectedEvenWithAnEightBitSdrParameterSet() {
        for (type in listOf("nclc", "nclx")) for (transfer in listOf(16, 18)) {
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorCodec.config(entry(colour(type, transfer)), true)
            }
        }
    }

    @Test fun normalBt709AndUnspecifiedSampleEntryColourRemainPlayable() {
        assertEquals(VideoCodec.H265, ReceiverMirrorCodec.config(entry(), true).codec)
        for (type in listOf("nclc", "nclx")) for (transfer in listOf(1, 2)) {
            assertEquals(VideoCodec.H265, ReceiverMirrorCodec.config(entry(colour(type, transfer)), true).codec)
        }
    }

    @Test fun incompleteColourBoxesFailWithoutReadingPastTheirOwnBox() {
        for (type in listOf("nclc", "nclx")) {
            val valid = colour(type, 1)
            for (size in listOf(11, valid.size - 1)) {
                val truncated = valid.copyOf(size)
                ByteBuffer.wrap(truncated).putInt(size)
                assertThrows(IllegalArgumentException::class.java) {
                    ReceiverMirrorCodec.config(entry(truncated), true)
                }
            }
        }
    }

    private fun colour(type: String, transfer: Int): ByteArray {
        val buffer = ByteBuffer.allocate(if (type == "nclx") 19 else 18)
        buffer.putInt(buffer.capacity()).put("colr".toByteArray()).put(type.toByteArray())
            .putShort(1).putShort(transfer.toShort()).putShort(1)
        if (type == "nclx") buffer.put(0)
        return buffer.array()
    }

    private fun entry(colour: ByteArray = ByteArray(0)): ByteArray {
        val record = ReceiverSdrFixtures.hvcc()
        val bytes = ByteArray(94) + record + colour
        ByteBuffer.wrap(bytes).putInt(bytes.size)
        "hvc1".toByteArray().copyInto(bytes, 4)
        ByteBuffer.wrap(bytes, 86, 4).putInt(record.size + 8)
        "hvcC".toByteArray().copyInto(bytes, 90)
        return bytes
    }
}
