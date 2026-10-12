package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage

/** Public handshake framing only; cryptographic inputs and failures are never formatted. */
internal object ReceiverHandshake {
    fun pairing(action: () -> ByteArray): RtspMessage.Response = try {
        octets(action())
    } catch (_: ReceiverPairingFailure) {
        RtspMessage.Response(status = 400, headers = mapOf("Connection" to "close"))
    }

    fun fairPlay(body: ByteArray, reply: (ByteArray) -> ByteArray?): RtspMessage.Response {
        if (body.size != 16 && body.size != 164) return malformed()
        if (!body.copyOfRange(0, 4).contentEquals(byteArrayOf(0x46, 0x50, 0x4c, 0x59)) ||
            body[5] != 1.toByte() || body[7] != 0.toByte()) return malformed()
        val sequence = if (body.size == 16) 1 else 3
        if (body[6] != sequence.toByte()) return malformed()
        val length = (8..11).fold(0L) { value, index -> (value shl 8) or (body[index].toLong() and 0xff) }
        if (length != body.size - 12L) return malformed()
        if (body[4] != 3.toByte()) return RtspMessage.Response(status = 501, statusText = "Not Implemented")
        // The reference's setup mode selects one of four replies; the handshake mode later indexes
        // playfair's key tables. Validate both before a native callback can see the request.
        val mode = body[if (sequence == 1) 14 else 12].toInt() and 0xff
        if (mode > 3) return malformed()
        val response = reply(body) ?: return malformed()
        if (response.size != if (sequence == 1) 142 else 32) return malformed()
        return octets(response)
    }

    private fun malformed() = RtspMessage.Response(status = 400)
    private fun octets(body: ByteArray) = RtspMessage.Response(
        status = 200, headers = mapOf("Content-Type" to "application/octet-stream"), body = body,
    )
}
