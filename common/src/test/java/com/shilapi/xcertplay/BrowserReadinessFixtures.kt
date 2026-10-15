package com.shilapi.xcertplay

import com.shilapi.xcertplay.web.BrowserVideoCapabilities
import com.shilapi.xcertplay.web.BrowserViewport

internal fun browserReadiness() = TeslaBrowserLink::class.java.getDeclaredField("carPlayReadiness")
    .apply { isAccessible = true }.get(TeslaBrowserLink) as BrowserCarPlayReadiness

internal fun reportReadyBrowser(
    viewport: BrowserViewport = BrowserViewport(1280, 720, 1280.0, 720.0, 1.0),
    hevc: Boolean = false,
) {
    val report = viewport.copy(videoCapabilities = viewport.videoCapabilities
        ?: BrowserVideoCapabilities(true, hevc, 3840, 2160))
    browserReadiness().seen("test-browser")
    browserReadiness().report(report)
    TeslaBrowserLink::class.java.getDeclaredField("viewport").apply { isAccessible = true }
        .set(TeslaBrowserLink, report)
    TeslaBrowserLink::class.java.getDeclaredField("viewportLoaded").apply { isAccessible = true }
        .setBoolean(TeslaBrowserLink, true)
}
