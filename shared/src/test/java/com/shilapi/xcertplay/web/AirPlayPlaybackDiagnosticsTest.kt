package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayPlaybackDiagnosticsTest {
    @Test fun reportsTransitionsImmediatelyAndStablePlaybackAtMostEveryFiveSeconds() {
        val lines = mutableListOf<String>()
        var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add) { now }
        val fields = mapOf("revision" to 0L, "position" to 1.0, "duration" to 10.0,
            "playing" to true, "ready" to true, "buffering" to false, "seekable" to true,
            "ended" to false, "failed" to false)
        diagnostics.report(1, fields, true)
        now = 400
        diagnostics.report(1, fields + ("position" to 2.0), true)
        assertEquals(1, lines.size)
        now = 5_000
        diagnostics.report(1, fields + ("position" to 6.0), true)
        assertEquals(2, lines.size)
        diagnostics.report(1, fields + ("ended" to true), true)
        diagnostics.report(1, fields + ("ended" to true), false)
        assertEquals(4, lines.size)
        assertTrue(lines[1].contains("position=6.0"))
        assertTrue(lines[2].contains("ended=true"))
        assertTrue(lines[3].contains("accepted=false"))
    }

    @Test fun untrustedBrowserDataCannotAddSecretsOrLinesToDiagnostics() {
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add)
        val hostile = mapOf("revision" to "token=secret", "position" to Double.NaN,
            "duration" to Double.POSITIVE_INFINITY, "paused" to "secret",
            "readyState" to 100, "networkState" to -1, "errorCode" to 1.5,
            "errorName" to "NotAllowedError\npassword=secret", "message" to "secret",
            "url" to "https://private.test/secret", "session" to "secret")
        diagnostics.event(1, hostile + ("event" to "play-rejected\nsecret"), true)
        assertTrue(lines.isEmpty())
        diagnostics.event(1, hostile + ("event" to "play-rejected"), true)
        diagnostics.command(1, "stop\nsecret", Double.NaN, false)
        diagnostics.report(1, hostile, false)
        assertEquals(3, lines.size)
        lines.forEach { assertFalse(it.contains("secret")); assertFalse(it.contains('\n')) }
        assertTrue(lines[0].contains("errorType=OTHER"))
        assertTrue(lines[0].contains("readyState=unknown"))
        assertTrue(lines[1].contains("action=OTHER target=unknown"))
    }

    @Test fun reportsTheActualBrowserFailureClassificationWithoutChangingPlayback() {
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add)
        diagnostics.event(2, mapOf("revision" to 3L, "event" to "play-rejected", "position" to 0.0,
            "duration" to 120.0, "paused" to true, "ended" to false, "seeking" to false,
            "dragging" to false, "readyState" to 4, "networkState" to 1, "errorCode" to 0,
            "errorName" to "NotAllowedError", "errorText" to "play() failed for https://private.test/video?token=hidden"), true)
        assertTrue(lines.single().contains("event=play-rejected active=true"))
        assertTrue(lines.single().contains("errorType=NotAllowedError"))
        assertTrue(lines.single().contains("duration=120.0"))
        assertTrue(lines.single().contains("errorText=play() failed for [url]"))
        assertFalse(lines.single().contains("private.test"))
        assertFalse(lines.single().contains("hidden"))
        AirPlayPlaybackDiagnostics({ error("unavailable log sink") }).report(2, emptyMap<String, Any>(), false)
    }
}
