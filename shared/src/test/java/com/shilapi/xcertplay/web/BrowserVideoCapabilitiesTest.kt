package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class BrowserVideoCapabilitiesTest {
    @Test fun capabilitiesUseActualBoundedPixelDimensions() {
        val fields = mapOf("h264" to true, "hevc" to false, "maxWidth" to 1920, "maxHeight" to 1080)
        assertEquals(BrowserVideoCapabilities(true, false, 1920, 1080), BrowserVideoCapabilities.parse(fields))
        for (invalid in listOf(Double.NaN, 99999, 1921, -1, "1920")) {
            assertNull(BrowserVideoCapabilities.parse(fields + ("maxWidth" to invalid)))
        }
        assertNull(BrowserVideoCapabilities.parse(fields - "hevc"))
    }
}
