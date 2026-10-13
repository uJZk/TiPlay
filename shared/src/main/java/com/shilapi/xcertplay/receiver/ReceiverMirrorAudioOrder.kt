package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AudioPacketOrder

/** Small RTP reorder window: duplicates/late packets drop, missing packets never build a long backlog. */
internal class ReceiverMirrorAudioOrder(private val now: () -> Long = System::nanoTime) {
    private val order = AudioPacketOrder<ByteArray>(now)
    fun offer(sequence: Int, payload: ByteArray): List<ByteArray> = order.offer(sequence, payload)
}
