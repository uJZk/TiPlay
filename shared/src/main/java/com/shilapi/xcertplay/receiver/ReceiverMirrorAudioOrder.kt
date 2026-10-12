package com.shilapi.xcertplay.receiver

/** Small RTP reorder window: duplicates/late packets drop, missing packets never build a long backlog. */
internal class ReceiverMirrorAudioOrder(private val now: () -> Long = System::nanoTime) {
    private data class Pending(val payload: ByteArray, val arrived: Long)
    private val pending = mutableMapOf<Int, Pending>()
    private var expected: Int? = null

    fun offer(sequence: Int, payload: ByteArray): List<ByteArray> {
        val seq = sequence and 0xffff
        val next = expected ?: seq.also { expected = it }
        val distance = (seq - next) and 0xffff
        if (distance >= 0x8000 || pending.containsKey(seq)) return emptyList()
        val time = now()
        pending[seq] = Pending(payload, time)
        val result = mutableListOf<ByteArray>()
        while (pending.isNotEmpty()) {
            val target = requireNotNull(expected)
            val ready = pending.remove(target)
            if (ready != null) {
                result += ready.payload; expected = (target + 1) and 0xffff
                continue
            }
            val closest = pending.keys.minByOrNull { (it - target) and 0xffff } ?: break
            val oldest = pending.values.minOf { it.arrived }
            if (pending.size < 4 && time - oldest < 30_000_000L) break
            expected = closest
        }
        return result
    }
}
