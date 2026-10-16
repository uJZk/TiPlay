package com.shilapi.xcertplay.web

import kotlin.math.abs

data class BrowserSize(val width: Int, val height: Int)

/** Measured WebCodecs support from the current paired browser, bounded before negotiation. */
data class BrowserVideoCapabilities(val h264: Boolean, val hevc: Boolean, val maxWidth: Int, val maxHeight: Int) {
    companion object {
        fun parse(value: Any?): BrowserVideoCapabilities? {
            val fields = value as? Map<*, *> ?: return null
            val h264 = fields["h264"] as? Boolean ?: return null
            val hevc = fields["hevc"] as? Boolean ?: return null
            if (!h264 && !hevc && (fields["maxWidth"] as? Number)?.toDouble() == 0.0 &&
                (fields["maxHeight"] as? Number)?.toDouble() == 0.0) return BrowserVideoCapabilities(false, false, 0, 0)
            fun dimension(key: String): Int? = (fields[key] as? Number)?.toDouble()
                ?.takeIf { it.isFinite() && it in 2.0..4096.0 && it % 2.0 == 0.0 }?.toInt()
            val width = dimension("maxWidth") ?: return null
            val height = dimension("maxHeight") ?: return null
            if (maxOf(width, height) > 3840 || minOf(width, height) > 2160) return null
            return BrowserVideoCapabilities(h264, hevc, width, height)
        }
    }
}

/** Selected AirPlay wire formats measured by this browser; never persist another browser's support. */
data class BrowserAudioCapabilities(val formats: Long) {
    companion object {
        const val FORMAT_MASK = 0x3fffffcL

        fun parse(value: Any?): BrowserAudioCapabilities? {
            val fields = value as? Map<*, *> ?: return null
            val number = (fields["audioFormats"] as? Number)?.toDouble()
                ?.takeIf { it.isFinite() && it >= 0 && it <= FORMAT_MASK && it % 1.0 == 0.0 }
                ?: return null
            val formats = number.toLong()
            if (formats and FORMAT_MASK.inv() != 0L) return null
            return BrowserAudioCapabilities(formats)
        }
    }
}

/** A `vp` event: [width] × [height] device pixels of the page's video area, its CSS size and its pixel ratio. */
data class BrowserViewport(
    val width: Int,
    val height: Int,
    val cssWidth: Double,
    val cssHeight: Double,
    val devicePixelRatio: Double,
    val videoCapabilities: BrowserVideoCapabilities? = null,
    val audioCapabilities: BrowserAudioCapabilities? = null,
) {
    val size: BrowserSize get() = BrowserSize(width, height)

    companion object {
        fun isValid(width: Int, height: Int): Boolean =
            width in 320..4096 && height in 320..4096 && width.toDouble() / height in 0.5..4.0
    }
}

/** What the app reports to the page in every `POST /control` answer. */
data class BrowserLinkStatus(
    val state: State,
    /** The WebCodecs codec string of the current stream ([WebVideoHub.StreamInfo.codec]). */
    val codec: String? = null,
    /** The negotiated CarPlay canvas. */
    val display: BrowserSize? = null,
    /** The last valid viewport the phone has. */
    val viewport: BrowserSize? = null,
    /** False while no CarPlay session can take touches. */
    val touchAvailable: Boolean = false,
    /** Phone-side counters and timings for the page's stats overlay; the server adds the hub's and its own. */
    val phone: Map<String, Any?> = emptyMap(),
    /** Changes when the driver taps the TiPlay icon in CarPlay. */
    val portalRevision: Long = BrowserPortalSignal.revision,
    /** Actual receiver phases; the old state describes only session/video availability. */
    val receivers: Map<String, Any?> = emptyMap(),
    /** The current video producer, independent of CarPlay connection state. */
    val videoSource: String? = null,
) {
    enum class State(val wire: String) { IDLE("idle"), CONNECTING("connecting"), STREAMING("streaming") }

    /**
     * The page offers "Apply and reconnect" while a session runs on a canvas that differs from the viewport
     * by more than 8 px on a side or 1 % in aspect ratio.
     */
    val fit: Boolean get() {
        if (state == State.IDLE) return false
        return differs(display ?: return false, viewport ?: return false)
    }

    companion object {
        /** More than 8 px apart on a side, or more than 1 % apart in aspect ratio. */
        fun differs(display: BrowserSize, viewport: BrowserSize): Boolean {
            val aspect = display.width.toDouble() / display.height
            val wanted = viewport.width.toDouble() / viewport.height
            return abs(display.width - viewport.width) > 8 || abs(display.height - viewport.height) > 8 ||
                abs(aspect - wanted) > 0.01 * wanted
        }
    }
}
