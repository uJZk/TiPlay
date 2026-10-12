package com.shilapi.xcertplay.receiver

/** MediaCodec's Annex-B parameter sets to the avcC record consumed by the browser. */
object ReceiverAvc {
    fun record(vararg buffers: ByteArray): ByteArray {
        val nals = buffers.flatMap(::split)
        val sps = nals.firstOrNull { it.isNotEmpty() && it[0].toInt() and 31 == 7 } ?: error("missing SPS")
        val pps = nals.firstOrNull { it.isNotEmpty() && it[0].toInt() and 31 == 8 } ?: error("missing PPS")
        require(sps.size in 4..65535 && pps.size in 1..65535)
        return byteArrayOf(1, sps[1], sps[2], sps[3], -1, -31,
            (sps.size shr 8).toByte(), sps.size.toByte()) + sps + byteArrayOf(1,
            (pps.size shr 8).toByte(), pps.size.toByte()) + pps
    }

    private fun split(bytes: ByteArray): List<ByteArray> {
        val starts = mutableListOf<Pair<Int, Int>>()
        var index = 0
        while (index + 3 <= bytes.size) {
            val length = when {
                index + 4 <= bytes.size && bytes[index] == 0.toByte() && bytes[index + 1] == 0.toByte() && bytes[index + 2] == 0.toByte() && bytes[index + 3] == 1.toByte() -> 4
                bytes[index] == 0.toByte() && bytes[index + 1] == 0.toByte() && bytes[index + 2] == 1.toByte() -> 3
                else -> 0
            }
            if (length > 0) { starts.add(index to length); index += length } else index++
        }
        if (starts.isEmpty()) return listOf(bytes)
        return starts.mapIndexed { i, (start, length) -> bytes.copyOfRange(start + length, starts.getOrNull(i + 1)?.first ?: bytes.size) }
    }
}
