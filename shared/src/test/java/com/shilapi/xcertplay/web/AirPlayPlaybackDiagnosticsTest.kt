package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayPlaybackDiagnosticsTest {
    @Test fun avPlayerFixtureContainsOnlyUpstreamQueueRenderAndFacadeEvidence() {
        val lines = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { 0L }).event(7, fixture(), true)
        assertEquals(5, lines.size)
        assertTrue(lines.all { it.length <= 600 && it.contains("id=7 revision=3 generation=4 active=true stalled=true") })
        assertTrue(lines[0].contains("engine=libmedia-avplayer renderMode=canvas waitReason=buffering"))
        assertTrue(lines[1].contains("audioPacketQueueLength=2 videoPacketQueueLength=5"))
        assertTrue(lines[2].contains("videoFrameRenderCount=120") && lines[2].contains("videoStutter=1"))
        assertTrue(lines[3].contains("codec=av01.0.08M.08.0.110.01.01.01.0 codedWidth=1920 codedHeight=1080"))
        assertTrue(lines[4].contains("startupPhase=first-samples openElapsedMs=5000"))
        val text = lines.joinToString()
        for (retired in listOf("ENGINE_SCHEDULE", "ENGINE_OWNERSHIP", "ENGINE_PCM", "ENGINE_NETWORK", "actualHardware", "videoBytes"))
            assertFalse(retired, text.contains(retired))
    }

    @Test fun stalledSnapshotsAreBoundedAndHealthyGrowthIsDebugOnlyAfterStartup() {
        val lines = mutableListOf<String>(); var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        val fields = fixture()
        diagnostics.event(7, fields, true)
        now = 4999; diagnostics.event(7, fields, true); assertEquals(5, lines.size)
        now = 5000; diagnostics.event(7, fields, true); assertEquals(10, lines.size)
        val healthy = changed(fields, "running" to true, "waitReason" to "none", "startupPhase" to "playing")
        now = 6000; diagnostics.event(7, healthy, true); assertEquals(15, lines.size)
        assertTrue(lines.takeLast(5).all { it.contains("recovered=true") })
        now = 16000
        diagnostics.event(7, changed(healthy, "videoFrameRenderCount" to 999, "videoPacketQueueLength" to 22), true)
        assertEquals(15, lines.size)
        val debug = mutableListOf<String>()
        val debugDiagnostics = AirPlayPlaybackDiagnostics(debug::add, debug = { true }, nowMillis = { now })
        debugDiagnostics.event(7, healthy, true)
        now += 9999; debugDiagnostics.event(7, healthy, true); assertEquals(5, debug.size)
        now++; debugDiagnostics.event(7, healthy, true); assertEquals(10, debug.size)
    }

    @Test fun recoveryRequiresSamePlaybackRevisionGenerationAndSourceIdentity() {
        val lines = mutableListOf<String>(); var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        val stalled = fixture()
        val healthy = changed(stalled, "running" to true, "waitReason" to "none", "startupPhase" to "playing")
        diagnostics.event(7, stalled, true)
        now = 1000; diagnostics.event(7, healthy + ("revision" to 4), true)
        assertTrue(lines.none { it.contains("recovered=true") })
        now = 2000; diagnostics.event(7, stalled, true)
        now = 3000; diagnostics.event(7, changed(healthy, "generation" to 5), true)
        assertTrue(lines.none { it.contains("recovered=true") })
        now = 4000; diagnostics.event(7, stalled, true)
        diagnostics.event(7, mapOf("event" to "open", "revision" to 3), true)
        now = 5000; diagnostics.event(7, healthy, true)
        assertTrue(lines.none { it.contains("recovered=true") })
        val before = lines.size
        now = 10000; diagnostics.event(7, stalled, false)
        assertEquals(before, lines.size)
    }

    @Test fun failuresAndChangedCleanupBypassSamplingButCannotMasqueradeAsRecovery() {
        val lines = mutableListOf<String>(); var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { now })
        diagnostics.event(7, fixture(), true)
        now = 1; diagnostics.event(7, fixture("failureEvent"), true)
        assertEquals(11, lines.size)
        assertTrue(lines.takeLast(5).all { it.contains("recovered=false") })
        diagnostics.event(7, fixture("cleanupEvent"), true)
        assertEquals(16, lines.size)
        assertTrue(lines.takeLast(5).any { it.contains("videoPacketQueueLength=0") })
        diagnostics.event(7, fixture("cleanupEvent"), true)
        now = 1000; diagnostics.event(7, changed(fixture("cleanupEvent"), "position" to 100), true)
        assertEquals(16, lines.size)
        now = 5001; diagnostics.event(7, fixture("cleanupEvent"), true)
        assertEquals(21, lines.size)
        diagnostics.event(7, fixture("failureEvent"), false)
        assertEquals(22, lines.size)
    }

    @Test fun semanticFailureWithoutErrorWaitStateStillReportsBoundedEvidence() {
        val fields = changed(fixture(), "running" to false, "intentPlaying" to false, "waitReason" to "paused")
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, debug = { false }, nowMillis = { 0L })
        for (event in listOf("error", "open-error", "canvas-error", "play-rejected"))
            diagnostics.event(7, fields + ("event" to event), true)
        assertEquals(24, lines.size)
        assertEquals(4, lines.count { it.contains("stage=ENGINE_CODEC") })
        assertTrue(lines.all { it.length <= 600 })
    }

    @Test fun schemaRejectsUntrustedLabelsRetiredCountersAndInvalidNumbers() {
        val lines = mutableListOf<String>()
        val fields = changed(fixture(), "engine" to "https://private.test/?token=secret", "renderMode" to "video",
            "waitReason" to "password=secret", "videoPacketQueueLength" to 1.5, "audioFrameDecodeCount" to Double.NaN,
            "codedWidth" to 32769, "codedHeight" to -1, "position" to Double.POSITIVE_INFINITY,
            "videoOwnedFrames" to 99, "audioScheduleGapUs" to 22.676, "resourceBackwardRestarts" to 10)
        AirPlayPlaybackDiagnostics(lines::add, debug = { true }, nowMillis = { 0L }).event(7, fields, true)
        val text = lines.joinToString()
        for (invalid in listOf("secret", "https", "videoOwnedFrames", "audioScheduleGapUs", "resourceBackwardRestarts"))
            assertFalse(invalid, text.contains(invalid))
        assertTrue(lines[0].contains("engine=unknown renderMode=unknown waitReason=unknown"))
        assertTrue(lines[0].contains("position=unknown"))
        assertTrue(lines[1].contains("videoPacketQueueLength=unknown audioFrameDecodeCount=unknown"))
        assertTrue(lines[3].contains("codedWidth=unknown codedHeight=unknown"))
        assertTrue(lines.all { it.length <= 600 && !it.contains('\n') })
        val maximum = mutableListOf<String>()
        AirPlayPlaybackDiagnostics(maximum::add, debug = { false }).event(Long.MAX_VALUE, fixture("maximumEvent"), true)
        assertEquals(5, maximum.size)
        assertTrue(maximum.joinToString("\n"), maximum.all { it.length <= 600 })
    }

    @Test fun missingUpstreamCountersStayUnknownInsteadOfZeroAndCodecIsBounded() {
        val lines = mutableListOf<String>()
        val fields = mapOf("revision" to 1, "event" to "engine-state", "engine" to mapOf(
            "generation" to 1, "engine" to "libmedia-avplayer", "renderMode" to "canvas", "startupPhase" to "ready",
            "running" to false, "intentPlaying" to false, "waitReason" to "paused", "codec" to "av01.0.08M.08.0.110.01.01.01.0.0"))
        AirPlayPlaybackDiagnostics(lines::add, debug = { true }).event(7, fields, true)
        assertTrue(lines[1].contains("audioPacketQueueLength=unknown videoPacketQueueLength=unknown"))
        assertTrue(lines[3].contains("codec=unknown"))
    }

    @Test fun rateAndReportTransitionsRemainImmediateWithoutStableReportFlooding() {
        val lines = mutableListOf<String>(); var now = 0L
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add, nowMillis = { now })
        val fields = mapOf("revision" to 0L, "position" to 1.0, "duration" to 10.0,
            "playing" to true, "ready" to true, "buffering" to false, "seekable" to true,
            "ended" to false, "failed" to false, "rate" to 1.0)
        diagnostics.report(1, fields, true)
        now = 400; diagnostics.report(1, fields + ("position" to 2.0), true); assertEquals(1, lines.size)
        diagnostics.report(1, fields + ("rate" to 1.5), true); assertEquals(2, lines.size)
        now = 5400; diagnostics.report(1, fields + mapOf("rate" to 1.5, "position" to 6.0), true)
        assertTrue(lines.last().contains("position=6.0"))
        diagnostics.report(1, fields + ("ended" to true), true)
        diagnostics.report(1, fields + ("ended" to true), false)
        diagnostics.command(1, "rate", 1.5, true)
        assertTrue(lines.last().contains("action=rate target=1.5 accepted=true"))
        diagnostics.report(1, fields + ("rate" to "password=secret"), false)
        assertTrue(lines.last().contains("rate=unknown")); assertFalse(lines.joinToString().contains("secret"))
    }

    @Test fun hostileEventsAndFailureMessagesCannotLeakSecretsOrAddLogLines() {
        val lines = mutableListOf<String>()
        val diagnostics = AirPlayPlaybackDiagnostics(lines::add)
        val hostile = mapOf("revision" to "token=secret", "position" to Double.NaN,
            "duration" to Double.POSITIVE_INFINITY, "paused" to "secret", "readyState" to 100,
            "networkState" to -1, "errorCode" to 1.5, "errorName" to "NotAllowedError\npassword=secret",
            "url" to "https://private.test/secret", "session" to "secret")
        diagnostics.event(1, hostile + ("event" to "play-rejected\nsecret"), true)
        assertTrue(lines.isEmpty())
        diagnostics.event(1, hostile + ("event" to "play-rejected"), true)
        diagnostics.command(1, "stop\nsecret", Double.NaN, false); diagnostics.report(1, hostile, false)
        assertEquals(3, lines.size)
        assertTrue(lines.all { !it.contains("secret") && !it.contains('\n') })
        diagnostics.event(2, mapOf("revision" to 3L, "event" to "play-rejected", "errorName" to "NotAllowedError",
            "errorText" to "play() failed for https://private.test/video?token=hidden"), true)
        assertTrue(lines.last().contains("errorType=NotAllowedError errorText=play() failed for [url]"))
        assertFalse(lines.last().contains("hidden"))
        AirPlayPlaybackDiagnostics({ error("unavailable log sink") }).report(2, emptyMap<String, Any>(), false)
    }

    private fun changed(fields: Map<*, *>, vararg changes: Pair<String, Any>): Map<Any?, Any?> =
        fields + ("engine" to ((fields["engine"] as Map<*, *>) + mapOf(*changes)))

    private fun fixture(key: String = "event"): Map<*, *> {
        val text = checkNotNull(javaClass.classLoader?.getResource("AirPlay-playback-diagnostics-v1.json")).readText()
        return (WebJson.parse(text) as Map<*, *>)[key] as Map<*, *>
    }
}
