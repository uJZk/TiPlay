package com.shilapi.xcertplay.web

/** Keeps a complete, bounded prediction chain while a replacement track is negotiated. */
internal class BrowserRtcPendingVideo(
    private val maxFrames: Int = 120,
    private val maxBytes: Int = WebVideoRecords.MAX_PAYLOAD,
) {
    private val frames = ArrayDeque<WebVideoRecord>()
    private var bytes = 0

    fun clear() { frames.clear(); bytes = 0 }

    fun offer(frame: WebVideoRecord) {
        require(frame.kind == WebVideoRecords.KIND_FRAME)
        if (frame.flags and WebVideoRecords.FLAG_DISCONTINUITY != 0 && !frame.keyFrame) {
            clear()
            return
        }
        if (frame.keyFrame) clear()
        if (frames.isEmpty() && !frame.keyFrame) return
        if (frames.isNotEmpty() && frames.first().epoch != frame.epoch ||
            frames.size >= maxFrames || frame.payloadLength > maxBytes - bytes) {
            clear()
            return
        }
        frames.addLast(frame)
        bytes += frame.payloadLength
    }

    fun poll(epoch: Int): WebVideoRecord? {
        if (frames.firstOrNull()?.epoch != epoch) { clear(); return null }
        return frames.removeFirst().also { bytes -= it.payloadLength }
    }

    fun isNotEmpty(): Boolean = frames.isNotEmpty()
}
