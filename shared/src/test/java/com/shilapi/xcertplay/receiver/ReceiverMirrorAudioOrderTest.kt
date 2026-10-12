package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test

class ReceiverMirrorAudioOrderTest {
    @Test fun outOfOrderAndWrappedSequencesRemainOrderedAndDuplicatesDrop() {
        val order = ReceiverMirrorAudioOrder()
        assertEquals(1, order.offer(65534, byteArrayOf(1)).size)
        assertTrue(order.offer(0, byteArrayOf(3)).isEmpty())
        assertEquals(listOf(2, 3), order.offer(65535, byteArrayOf(2)).map { it[0].toInt() })
        assertTrue(order.offer(65535, byteArrayOf(2)).isEmpty())
    }

    @Test fun aLostPacketHasABoundedWaitAndDoesNotBlockFollowingAudio() {
        var now = 0L
        val order = ReceiverMirrorAudioOrder { now }
        order.offer(0, byteArrayOf(0))
        assertTrue(order.offer(2, byteArrayOf(2)).isEmpty())
        now = 31_000_000
        assertEquals(listOf(2, 3), order.offer(3, byteArrayOf(3)).map { it[0].toInt() })
        assertTrue(order.offer(1, byteArrayOf(1)).isEmpty())
    }
}
