package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class BrowserAudioDiagnosticsTest {
    @Test fun separatesDecodedPcmFromRenderedOutputAndTheStreamsClock() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "pageVersion" to "v52", "contextState" to "running", "contextTimeMs" to 5000,
            "pcmFrames" to 120_000, "renderNonzero" to 0, "renderAgeMs" to 2500,
            "decoder.frames" to 120_000, "decoder.stream0.backend" to "webcodecs",
            "stream0.epoch" to 4, "stream0.headMs" to 1_792_120_000_000L,
            "stream0.playbackMs" to 1_792_119_999_900L, "stream0.capacityPackets" to 117,
            "stream0.playedPackets" to 0,
        ))
        assertEquals(4, lines.size)
        assertTrue(lines[0].contains("contextState=running"))
        assertTrue(lines[0].contains("renderNonzero=0"))
        assertTrue(lines[1].contains("stage=DECODE frames=120000"))
        assertTrue(lines[2].contains("stream=0"))
        assertTrue(lines[2].contains("headMs=1792120000000"))
        assertTrue(lines[2].contains("capacityPackets=117"))
        assertTrue(lines[2].contains("playedPackets=0"))
        assertTrue(lines[3].contains("backend=webcodecs"))
    }

    @Test fun unknownFieldsAndUnsafeTextCannotInjectCredentialsOrExtraLogLines() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "code" to "1234", "url" to "https://private.test/secret", "stream7.epoch" to 4,
            "contextState" to "running\nsecret", "stream0.mode" to "https://private.test",
            "clockAgeMs" to Double.NaN, "renderAgeMs" to Double.POSITIVE_INFINITY,
            "renderFrames" to 256,
        ))
        assertEquals(listOf("Browser audio: stage=SNAPSHOT renderFrames=256"), lines)
    }
}
