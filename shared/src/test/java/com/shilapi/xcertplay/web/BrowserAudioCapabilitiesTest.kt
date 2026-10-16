package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class BrowserAudioCapabilitiesTest {
    @Test fun capabilityMaskIsAnExactBoundedWireFormatSetIncludingExplicitNoSupport() {
        for (mask in listOf(0L, 1L shl 18, 1L shl 24, 0x3fffffcL)) {
            assertEquals(BrowserAudioCapabilities(mask), BrowserAudioCapabilities.parse(mapOf("audioFormats" to mask)))
        }
        assertEquals(BrowserAudioCapabilities(4L), BrowserAudioCapabilities.parse(mapOf("audioFormats" to 4.0)))
        for (invalid in listOf(null, "4", true, -4, 1, 2, 1L shl 26, 4.5, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertNull("Invalid format mask: $invalid", BrowserAudioCapabilities.parse(mapOf("audioFormats" to invalid)))
        }
        assertNull(BrowserAudioCapabilities.parse(emptyMap<String, Any?>()))
        assertNull(BrowserAudioCapabilities.parse(null))
    }
}
