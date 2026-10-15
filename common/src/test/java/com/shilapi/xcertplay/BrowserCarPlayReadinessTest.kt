package com.shilapi.xcertplay

import com.shilapi.xcertplay.web.BrowserVideoCapabilities
import com.shilapi.xcertplay.web.BrowserViewport
import org.junit.Assert.*
import org.junit.Test

class BrowserCarPlayReadinessTest {
    private var now = 0L
    private val readiness = BrowserCarPlayReadiness { now }
    private val viewport = BrowserViewport(1920, 1080, 960.0, 540.0, 2.0,
        BrowserVideoCapabilities(true, true, 1920, 1080))

    @Test fun requiresLivePageAndSuccessfulDecoderReport() {
        readiness.report(viewport)
        assertNull(readiness.readyViewport())
        readiness.seen("page")
        assertNull(readiness.readyViewport())
        readiness.report(viewport.copy(videoCapabilities = null))
        assertNull(readiness.readyViewport())
        readiness.report(viewport.copy(videoCapabilities = BrowserVideoCapabilities(false, false, 0, 0)))
        assertNull(readiness.readyViewport())
        readiness.report(viewport)
        assertEquals(viewport, readiness.readyViewport())
    }

    @Test fun heartbeatExpiryAndByeBlockFurtherAttempts() {
        readiness.seen("page")
        readiness.report(viewport)
        now = BrowserCarPlayReadiness.TIMEOUT_MILLIS
        assertNull(readiness.readyViewport())
        readiness.seen("page")
        assertEquals(viewport, readiness.readyViewport())
        readiness.gone("other-page")
        assertEquals(viewport, readiness.readyViewport())
        readiness.gone("page")
        assertNull(readiness.readyViewport())
    }

    @Test fun replacementAndServerRestartRequireNewCapabilities() {
        readiness.seen("old")
        readiness.report(viewport)
        readiness.seen("new")
        assertNull(readiness.readyViewport())
        readiness.report(viewport)
        assertEquals(viewport, readiness.readyViewport())
        readiness.clear()
        readiness.seen("new")
        assertNull(readiness.readyViewport())
    }
}
