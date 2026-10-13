package com.shilapi.xcertplay

/** MediaCodec surfaces can expose either the media PTS or the scheduled release timestamp. */
internal class AirPlayCastFrameTimes {
    private data class Frame(val mediaNanos: Long, val releaseNanos: Long, val presentationNanos: Long)
    private val frames = ArrayDeque<Frame>()

    @Synchronized fun add(mediaUs: Long, releaseNanos: Long, presentationNanos: Long) {
        frames.addLast(Frame(mediaUs * 1000, releaseNanos, presentationNanos))
        while (frames.size > 120) frames.removeFirst()
    }

    @Synchronized fun take(surfaceNanos: Long): Long? {
        val frame = frames.firstOrNull { it.releaseNanos == surfaceNanos || it.mediaNanos == surfaceNanos }
            ?: return null
        // SurfaceTexture may coalesce outputs. Retire metadata for all superseded pictures.
        while (frames.isNotEmpty()) if (frames.removeFirst() === frame) break
        return frame.presentationNanos
    }

    @Synchronized fun clear() = frames.clear()
}
