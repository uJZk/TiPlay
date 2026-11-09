package com.shilapi.xcertplay.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeRtcAudioStatesTest {
    @Test fun readinessRequiresBothConnectedTransportStates() {
        assertFalse(nativeAudioTransportConnected(2L or (2L shl 4)))
        assertFalse(nativeAudioTransportConnected(3L or (2L shl 4)))
        assertFalse(nativeAudioTransportConnected(4L or (6L shl 4)))
        assertFalse(nativeAudioTransportConnected(0))
        assertTrue(nativeAudioTransportConnected(3L or (3L shl 4)))
        assertTrue(nativeAudioTransportConnected(3L or (4L shl 4)))
    }
    @Test fun describesBothIceAndConnectionWithoutAddresses() {
        val encoded = 2L or (2L shl 4) or (3L shl 8) or (4L shl 24)
        assertEquals("connection=connecting ice=checking connectionChanges=3 iceChanges=4", formatNativeAudioStates(encoded))
        assertEquals("connection=unavailable ice=unavailable connectionChanges=0 iceChanges=0", formatNativeAudioStates(0))
    }
}
