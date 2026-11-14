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

    @Test fun unselectedPairIsAnExpectedDiagnosticResult() {
        val raw = IntArray(21)
        raw[0] = 1; raw[1] = 1; raw[4] = 2; raw[5] = 0
        raw[6] = 2; raw[7] = 2; raw[10] = 2; raw[11] = 1; raw[12] = -3
        val details = nativeAudioDiagnostics(raw)
        assertEquals("checking", details["ice"])
        assertEquals("complete", details["gathering"])
        assertEquals("stable", details["signaling"])
        assertEquals("answer", details["localDescriptionType"])
        assertEquals("offer", details["remoteDescriptionType"])
        assertEquals(0, details["remoteDescriptionSetResult"])
        assertEquals(0, details["localDescriptionSetResult"])
        assertEquals("not-selected", details["selectedPair"])
        assertEquals(-3, details["selectedPairResult"])
        assertEquals(false, details["localCandidatePresent"])
        assertEquals(false, details["remoteCandidatePresent"])
    }

    @Test fun selectedPairReportsOnlyFixedCandidateClassifications() {
        val raw = IntArray(21)
        raw[0] = 2; raw[1] = 3; raw[4] = 2
        raw[13] = 1; raw[14] = 1; raw[15] = 1; raw[16] = 1
        raw[17] = 3; raw[18] = 1; raw[19] = 2; raw[20] = 1
        val details = nativeAudioDiagnostics(raw)
        assertEquals("selected", details["selectedPair"])
        assertEquals("host", details["localCandidateType"])
        assertEquals("udp", details["localCandidateProtocol"])
        assertEquals("ipv4", details["localCandidateFamily"])
        assertEquals("prflx", details["remoteCandidateType"])
        assertEquals("ipv6", details["remoteCandidateFamily"])
        assertEquals(true, details["remoteCandidatePresent"])
    }

    @Test fun uncalledDescriptionsAndUnknownStatesRemainExplicit() {
        val raw = IntArray(21) { -1 }
        raw[2] = Int.MAX_VALUE; raw[8] = Int.MIN_VALUE; raw[9] = -2; raw[12] = -4
        val details = nativeAudioDiagnostics(raw)
        assertEquals("unavailable", details["gathering"])
        assertEquals("unavailable", details["signaling"])
        assertEquals(65535, details["connectionChanges"])
        assertEquals(0, details["iceChanges"])
        assertEquals(null, details["remoteDescriptionSetResult"])
        assertEquals(-2, details["localDescriptionSetResult"])
        assertEquals("error", details["selectedPair"])
        assertEquals(-4, details["selectedPairResult"])
        assertEquals("unknown", details["localCandidateFamily"])
        assertEquals(mapOf("available" to false), nativeAudioDiagnostics(IntArray(0)))
    }
}
